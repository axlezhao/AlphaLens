import { getD1 } from "../../db";
import { contentHash, stableId } from "../core/ids";
import { summarizeDeliveryError } from "./webhook-safety";

/**
 * Reliable outbox. Business events are written in the same transaction as the
 * triggering change; a background worker then claims, delivers and retries them
 * with at-least-once semantics (never exactly-once). Idempotency keys let
 * consumers deduplicate. All reads and writes are scoped to a workspace so a
 * message can never be read, delivered or retried by another tenant.
 */

const LEASE_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;

export function backoffMs(attempt: number): number {
  return 1000 * 2 ** Math.max(0, attempt - 1);
}

type WebhookEnqueue = {
  workspaceId: string;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  idempotencyKey?: string;
  maxAttempts?: number;
};

/** A statement callers can drop into their own batch for transactional coupling. */
export async function webhookDeliveryInsert(input: WebhookEnqueue) {
  const now = new Date().toISOString();
  const id = await stableId("whdel", `${input.subscriptionId}:${input.eventId}`);
  const idempotencyKey = input.idempotencyKey ?? await contentHash({ subscriptionId: input.subscriptionId, eventId: input.eventId });
  return getD1().prepare("INSERT OR IGNORE INTO webhook_deliveries (id,workspace_id,subscription_id,event_id,event_type,payload_json,status,attempts,max_attempts,next_attempt_at,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,'queued',0,?,?,?,?,?)")
    .bind(id, input.workspaceId, input.subscriptionId, input.eventId, input.eventType, JSON.stringify(input.payload), input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, now, idempotencyKey, now, now);
}

export async function enqueueWebhookDelivery(input: WebhookEnqueue) {
  await getD1().batch([await webhookDeliveryInsert(input)]);
}

type NotificationEnqueue = {
  workspaceId: string;
  channelId: string;
  eventKey: string;
  title: string;
  body: string;
  payload?: unknown;
  idempotencyKey?: string;
  maxAttempts?: number;
};

export async function notificationOutboxInsert(input: NotificationEnqueue) {
  const now = new Date().toISOString();
  const id = await stableId("ntfout", `${input.channelId}:${input.eventKey}`);
  const idempotencyKey = input.idempotencyKey ?? await contentHash({ channelId: input.channelId, eventKey: input.eventKey });
  return getD1().prepare("INSERT OR IGNORE INTO notification_outbox (id,workspace_id,channel_id,event_key,title,body,payload_json,status,attempts,max_attempts,next_attempt_at,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'queued',0,?,?,?,?,?)")
    .bind(id, input.workspaceId, input.channelId, input.eventKey, input.title, input.body, JSON.stringify(input.payload ?? {}), input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, now, idempotencyKey, now, now);
}

export async function enqueueNotification(input: NotificationEnqueue) {
  await getD1().batch([await notificationOutboxInsert(input)]);
}

export type WebhookDeliveryRow = {
  id: string; workspaceId: string; subscriptionId: string; eventId: string; eventType: string; payloadJson: string; attempts: number; maxAttempts: number; endpointUrl: string;
};

/**
 * Atomically claims the next due webhook delivery. The `UPDATE ... WHERE
 * status='queued'` is the concurrency guard — two workers racing for one row
 * see a single `changes` count.
 */
export async function claimNextWebhook(workerId: string): Promise<WebhookDeliveryRow | null> {
  const db = getD1(); const now = new Date().toISOString();
  const candidate = await db.prepare("SELECT d.id,d.workspace_id AS workspaceId,d.subscription_id AS subscriptionId,d.event_id AS eventId,d.event_type AS eventType,d.payload_json AS payloadJson,d.attempts,d.max_attempts AS maxAttempts,s.endpoint_url AS endpointUrl FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id=d.subscription_id WHERE d.status='queued' AND d.next_attempt_at<=? AND s.enabled=1 ORDER BY d.created_at LIMIT 1").bind(now).first<WebhookDeliveryRow>();
  if (!candidate) return null;
  const leaseExpires = new Date(Date.now() + LEASE_MS).toISOString();
  const result = await db.prepare("UPDATE webhook_deliveries SET status='sending',lease_owner=?,lease_expires_at=?,attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'").bind(workerId, leaseExpires, now, candidate.id).run();
  if (!result.meta.changes) return null;
  return { ...candidate, attempts: candidate.attempts + 1 };
}

export async function completeWebhook(id: string, responseStatus: number, responseBody?: string) {
  const now = new Date().toISOString();
  await getD1().prepare("UPDATE webhook_deliveries SET status='delivered',response_status=?,response_body=?,delivered_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?").bind(responseStatus, responseBody ?? null, now, now, id).run();
}

export async function failWebhook(id: string, error: unknown, retryable: boolean) {
  const db = getD1(); const now = new Date().toISOString();
  const summary = summarizeDeliveryError(error);
  const row = await db.prepare("SELECT attempts,max_attempts AS maxAttempts FROM webhook_deliveries WHERE id=?").bind(id).first<{ attempts: number; maxAttempts: number }>();
  if (!row) return;
  if (retryable && row.attempts < row.maxAttempts) {
    const next = new Date(Date.now() + backoffMs(row.attempts)).toISOString();
    await db.prepare("UPDATE webhook_deliveries SET status='queued',next_attempt_at=?,lease_owner=NULL,lease_expires_at=NULL,error_code='RETRYABLE',error_message=?,updated_at=? WHERE id=?").bind(next, summary, now, id).run();
  } else {
    await db.prepare("UPDATE webhook_deliveries SET status='dead_letter',error_code=?,error_message=?,dead_lettered_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?").bind(retryable ? "ATTEMPTS_EXHAUSTED" : "NON_RETRYABLE", summary, now, now, id).run();
  }
}

/** Requeues a dead-lettered delivery back to queued (bounded to the workspace). */
export async function requeueWebhookDeadLetter(workspaceId: string, id: string) {
  const now = new Date().toISOString();
  const result = await getD1().prepare("UPDATE webhook_deliveries SET status='queued',attempts=0,next_attempt_at=?,error_code=NULL,error_message=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND workspace_id=? AND status='dead_letter'").bind(now, now, id, workspaceId).run();
  return (result.meta.changes ?? 0) > 0;
}

/** Recovers deliveries orphaned by a crashed worker. */
export async function recoverExpiredWebhooks() {
  const now = new Date().toISOString();
  await getD1().prepare("UPDATE webhook_deliveries SET status='queued',lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=?,updated_at=? WHERE status='sending' AND lease_expires_at<?").bind(now, now, now).run();
}

export function webhookPayloadEvent(delivery: WebhookDeliveryRow) {
  return { id: delivery.eventId, type: delivery.eventType, payload: JSON.parse(delivery.payloadJson) };
}
