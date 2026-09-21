import { getD1 } from "../../db";
import { contentHash, stableId } from "../core/ids";

/**
 * Business-event coupling. When a research job finalises, the corresponding
 * webhook deliveries are prepared here and appended to the *same* batch as the
 * job's status update, so the business change and the notification cannot
 * diverge (the outbox survives a crash that follows a successful commit).
 */

export const RESEARCH_COMPLETED_EVENT = "research.completed";
export const RESEARCH_FAILED_EVENT = "research.failed";

const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Builds idempotent, conditionally-gated webhook delivery inserts for a
 * research terminal transition. Each INSERT is guarded by the job already being
 * in the target terminal status, so if the guarded state transition in the same
 * batch did NOT land (cancelled, lease lost, already terminal), no delivery row
 * is created. The deterministic id (subscription + event) plus `INSERT OR
 * IGNORE` keeps the fan-out idempotent across retries.
 */
export async function buildResearchOutboxDeliveries(workspaceId: string, jobId: string, ticker: string, status: "succeeded" | "failed") {
  const eventType = status === "succeeded" ? RESEARCH_COMPLETED_EVENT : RESEARCH_FAILED_EVENT;
  const eventId = `${jobId}:${eventType}`;
  const subs = await getD1().prepare("SELECT id FROM webhook_subscriptions WHERE workspace_id=? AND enabled=1 AND event_types_json LIKE ?").bind(workspaceId, `%"${eventType}"%`).all<{ id: string }>();
  const now = new Date().toISOString();
  const payload = JSON.stringify({ jobId, ticker, status });
  return Promise.all(subs.results.map(async (sub) => {
    const id = await stableId("whdel", `${sub.id}:${eventId}`);
    const idempotencyKey = await contentHash({ subscriptionId: sub.id, eventId });
    // The `WHERE EXISTS (... status = ?)` guard ties the delivery insert to the
    // same-transaction status transition: a delivery is only created when the
    // job reached the terminal status inside this batch.
    return getD1().prepare("INSERT OR IGNORE INTO webhook_deliveries (id,workspace_id,subscription_id,event_id,event_type,payload_json,status,attempts,max_attempts,next_attempt_at,idempotency_key,created_at,updated_at) SELECT ?,?,?,?,?,?,'queued',0,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM research_jobs WHERE id=? AND status=?)")
      .bind(id, workspaceId, sub.id, eventId, eventType, payload, DEFAULT_MAX_ATTEMPTS, now, idempotencyKey, now, now, jobId, status);
  }));
}
