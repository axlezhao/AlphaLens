import { getD1 } from "../../db";

/**
 * Account deletion: request → background execution, with controlling-owner
 * protection, cancellation, idempotency and soft-delete (tombstone + PII
 * anonymization) semantics. Audit rows are retained; the user row is
 * anonymized and marked deleted so they can no longer authenticate, but
 * referential integrity of audit/workspace history is preserved.
 */

export const DELETION_CONFIRMATION_TEXT = "DELETE";

export class DeletionBlockedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "DeletionBlockedError";
  }
}

export async function findBlockingOwnership(userId: string): Promise<{ workspaceId: string; name: string; memberCount: number } | null> {
  // A controlling owner must transfer ownership before deleting their account,
  // regardless of member count — this keeps the shared-workspace invariant
  // simple and matches the migration trigger that forbids removing a
  // controlling owner's membership row.
  const row = await getD1().prepare("SELECT w.id AS workspaceId,w.name,(SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id=w.id) AS memberCount FROM workspaces w WHERE w.owner_user_id=? LIMIT 1").bind(userId).first<{ workspaceId: string; name: string; memberCount: number }>();
  return row ?? null;
}

export async function requestDeletion(userId: string, input: { confirmation: string; reason?: string }) {
  if (input.confirmation !== DELETION_CONFIRMATION_TEXT) {
    throw new DeletionBlockedError("CONFIRMATION_REQUIRED", "请输入确认文本 DELETE 以确认删除账户");
  }
  const blocking = await findBlockingOwnership(userId);
  if (blocking) {
    throw new DeletionBlockedError("CONTROLLING_OWNER_MUST_TRANSFER", `您仍是 Workspace「${blocking.name}」的控制性 Owner，请先转移所有权或移除其他成员`);
  }

  const db = getD1();
  // Idempotency: a repeated submission while an open request exists returns the
  // existing request instead of creating a second one.
  const existing = await db.prepare("SELECT id FROM deletion_requests WHERE user_id=? AND status='requested'").bind(userId).first<{ id: string }>();
  if (existing) return { id: existing.id, status: "requested" as const };

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const scheduledFor = new Date(Date.now() + 60_000).toISOString(); // one-minute grace for cancellation

  await db.batch([
    db.prepare("INSERT INTO deletion_requests (id,user_id,status,requested_at,scheduled_for,idempotency_key,confirmation_text,reason) VALUES (?,?,'requested',?,?,?,?,?)").bind(id, userId, now, scheduledFor, idempotencyKey, DELETION_CONFIRMATION_TEXT, input.reason ?? null),
    db.prepare("UPDATE users SET deletion_requested_at=?,updated_at=? WHERE id=?").bind(now, now, userId),
  ]);
  return { id, status: "requested" as const, scheduledFor };
}

export async function cancelDeletion(userId: string) {
  const db = getD1();
  const now = new Date().toISOString();
  const result = await db.prepare("UPDATE deletion_requests SET status='cancelled',cancelled_at=?,completed_at=NULL WHERE user_id=? AND status='requested'").bind(now, userId).run();
  if (result.meta.changes) {
    await db.prepare("UPDATE users SET deletion_requested_at=NULL,updated_at=? WHERE id=?").bind(now, userId).run();
    return { status: "cancelled" };
  }
  return null;
}

export type DeletionClaim = { id: string; userId: string };

/** Atomically claims the next due deletion request for background execution. */
export async function claimNextDeletion(): Promise<DeletionClaim | null> {
  const db = getD1(); const now = new Date().toISOString();
  const candidate = await db.prepare("SELECT id,user_id AS userId FROM deletion_requests WHERE status='requested' AND scheduled_for<=? ORDER BY requested_at LIMIT 1").bind(now).first<DeletionClaim>();
  if (!candidate) return null;
  const result = await db.prepare("UPDATE deletion_requests SET status='processing',started_at=?,attempts=attempts+1 WHERE id=? AND status='requested'").bind(now, candidate.id).run();
  if (!result.meta.changes) return null;
  return candidate;
}

/**
 * Executes the soft delete for a claimed request. Idempotent: re-running it
 * against an already-anonymized user is a no-op for the PII fields. The email
 * is deliberately retained as a stable identifier so the deleted account
 * cannot silently re-register with the same address; display name is cleared
 * and membership is removed without touching shared workspace data or audit.
 */
export async function executeDeletion(userId: string) {
  const db = getD1(); const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE users SET deleted_at=?,display_name=NULL,updated_at=? WHERE id=?").bind(now, now, userId),
    db.prepare("DELETE FROM workspace_members WHERE user_id=?").bind(userId),
  ]);
}

export async function completeDeletion(id: string) {
  const now = new Date().toISOString();
  await getD1().prepare("UPDATE deletion_requests SET status='completed',completed_at=? WHERE id=?").bind(now, id).run();
}

export async function failDeletion(id: string, error: unknown) {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  await getD1().prepare("UPDATE deletion_requests SET status='rejected',error_code='DELETION_FAILED',error_message=?,completed_at=? WHERE id=?").bind(message.slice(0, 1000), now, id).run();
}
