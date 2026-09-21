import { getD1 } from "../../db";

/**
 * Account deletion: request → background execution, with controlling-owner
 * protection, cancellation, idempotency and soft-delete (tombstone + PII
 * anonymization) semantics. Audit rows are retained; the user row is
 * anonymized and marked deleted so they can no longer authenticate, but
 * referential integrity of audit/workspace history is preserved.
 *
 * The deletion worker is recoverable: each claim writes a lease token, every
 * transition is a compare-and-set against it, and an expired lease can be
 * reclaimed. A worker that lost its lease cannot overwrite a newer worker's
 * outcome. Retries are bounded with backoff and end in a terminal rejected
 * state; repeated execution is idempotent.
 */

export const DELETION_CONFIRMATION_TEXT = "DELETE";

const LEASE_MS = 60_000;

export class DeletionBlockedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "DeletionBlockedError";
  }
}

/**
 * Returns the workspace the user controls as a *controlling owner* that still
 * has other members. A personal workspace (no other members) is not a blocker:
 * it is safe to delete alongside the account. A shared workspace with other
 * members must be transferred first so its data and the other members survive.
 */
export async function findBlockingOwnership(userId: string): Promise<{ workspaceId: string; name: string; memberCount: number } | null> {
  const row = await getD1().prepare("SELECT w.id AS workspaceId,w.name,(SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id=w.id) AS memberCount FROM workspaces w WHERE w.owner_user_id=? AND (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id=w.id) > 1 LIMIT 1").bind(userId).first<{ workspaceId: string; name: string; memberCount: number }>();
  return row ?? null;
}

/** A workspace is personal when the user is its controlling owner and sole member. */
export async function hasSharedControllingOwnership(userId: string): Promise<boolean> {
  return (await findBlockingOwnership(userId)) !== null;
}

/** Best-effort audit write scoped to a resource, never including email/reason. */
export async function auditDeletion(action: string, resourceId: string | null, metadata: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  await getD1().prepare("INSERT INTO audit_logs (id,workspace_id,actor_user_id,action,resource_type,resource_id,request_id,ip_hash,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), null, null, action, "deletion_request", resourceId, crypto.randomUUID(), null, JSON.stringify(metadata), now).run();
}

export async function requestDeletion(userId: string, input: { confirmation: string; reason?: string }) {
  if (input.confirmation !== DELETION_CONFIRMATION_TEXT) {
    throw new DeletionBlockedError("CONFIRMATION_REQUIRED", "请输入确认文本 DELETE 以确认删除账户");
  }
  // A controlling owner of a *shared* workspace must transfer ownership first.
  const blocking = await findBlockingOwnership(userId);
  if (blocking) {
    throw new DeletionBlockedError("CONTROLLING_OWNER_MUST_TRANSFER", `您仍是 Workspace「${blocking.name}」的控制性 Owner，请先转移所有权或移除其他成员`);
  }

  const db = getD1();
  const now = new Date().toISOString();
  // Idempotency: a repeated submission while any open request (requested or
  // processing) exists returns that same request instead of creating a second
  // one or tripping the unique index into a 500.
  const existing = await db.prepare("SELECT id,status FROM deletion_requests WHERE user_id=? AND status IN ('requested','processing')").bind(userId).first<{ id: string; status: string }>();
  if (existing) return { id: existing.id, status: existing.status as "requested" | "processing" };

  const id = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const scheduledFor = new Date(Date.now() + 60_000).toISOString(); // one-minute grace for cancellation

  await db.batch([
    db.prepare("INSERT INTO deletion_requests (id,user_id,status,requested_at,scheduled_for,next_attempt_at,idempotency_key,confirmation_text,reason) VALUES (?,?,'requested',?,?,?,?,?,?)").bind(id, userId, now, scheduledFor, scheduledFor, idempotencyKey, DELETION_CONFIRMATION_TEXT, input.reason ?? null),
    db.prepare("UPDATE users SET deletion_requested_at=?,updated_at=? WHERE id=?").bind(now, now, userId),
  ]);
  return { id, status: "requested" as const, scheduledFor };
}

export async function cancelDeletion(userId: string): Promise<{ status: "cancelled" } | { status: "processing" } | null> {
  const db = getD1();
  const now = new Date().toISOString();
  // Only `requested` deletions are cancellable. A `processing` request is
  // already being executed by a worker and must not be cancelled (the worker
  // owns the lease until it completes or fails). We return the current status
  // so callers can distinguish the two cases.
  const alreadyProcessing = await db.prepare("SELECT id FROM deletion_requests WHERE user_id=? AND status='processing' LIMIT 1").bind(userId).first<{ id: string }>();
  if (alreadyProcessing) return { status: "processing" };
  const result = await db.prepare("UPDATE deletion_requests SET status='cancelled',cancelled_at=?,completed_at=NULL WHERE user_id=? AND status='requested'").bind(now, userId).run();
  if (result.meta.changes) {
    await db.prepare("UPDATE users SET deletion_requested_at=NULL,updated_at=? WHERE id=?").bind(now, userId).run();
    return { status: "cancelled" };
  }
  return null;
}

export type DeletionClaim = { id: string; userId: string; leaseToken: string; attempts: number; maxAttempts: number };

/**
 * Atomically claims the next due deletion request. The claim writes a unique
 * lease token and flips `requested`/`retrying` → `processing`; the token is
 * required for every later transition, so a worker whose lease expired cannot
 * overwrite a newer worker's outcome.
 */
export async function claimNextDeletion(workerId: string): Promise<DeletionClaim | null> {
  const db = getD1(); const now = new Date().toISOString();
  const candidate = await db.prepare("SELECT id,user_id AS userId,attempts,max_attempts AS maxAttempts FROM deletion_requests WHERE status='requested' AND scheduled_for<=? ORDER BY requested_at LIMIT 1").bind(now).first<{ id: string; userId: string; attempts: number; maxAttempts: number }>();
  if (!candidate) return null;
  const leaseExpires = new Date(Date.now() + LEASE_MS).toISOString();
  const leaseToken = crypto.randomUUID();
  const result = await db.prepare("UPDATE deletion_requests SET status='processing',started_at=?,attempts=attempts+1,lease_owner=?,lease_token=?,lease_expires_at=? WHERE id=? AND status='requested'").bind(now, workerId, leaseToken, leaseExpires, candidate.id).run();
  if (!result.meta.changes) return null;
  await auditDeletion("account.deletion.worker_started", candidate.id, { attempt: candidate.attempts + 1 });
  return { ...candidate, attempts: candidate.attempts + 1, leaseToken };
}

/**
 * Executes the soft delete for a claimed request. Every side effect is fenced
 * by the SAME atomic condition (request `processing` + matching unexpired lease
 * token + belongs to the target user + user has no shared controlling
 * ownership), so there is no select-then-write TOCTOU window: if the fence fails
 * at the moment of execution, all statements affect zero rows and no
 * user/membership/workspace mutation lands. Idempotent: re-running against an
 * already-anonymized user is a no-op for the PII fields.
 *
 * A personal workspace (sole member) is tombstoned alongside the account; a
 * shared workspace is left intact for its other members.
 */
export async function executeDeletion(claim: DeletionClaim): Promise<boolean> {
  const db = getD1(); const now = new Date().toISOString();
  // Single fence fragment reused by every side-effect statement. It verifies the
  // request id, the target user, the processing status, an unexpired lease token
  // held by this worker, and that the user does not (still) own a shared
  // workspace with other members. Because each mutation carries this guard
  // directly in its WHERE clause, no side effect can outrun the fence.
  const fence = "EXISTS (SELECT 1 FROM deletion_requests dr WHERE dr.id = ? AND dr.user_id = ? AND dr.status = 'processing' AND dr.lease_token = ? AND dr.lease_expires_at > ? AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_user_id = dr.user_id AND (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = w.id) > 1))";
  const fenceBind: (string | number | null)[] = [claim.id, claim.userId, claim.leaseToken, now];

  const results = await db.batch([
    db.prepare(`UPDATE users SET deleted_at = ?, display_name = NULL, updated_at = ? WHERE id = ? AND ${fence}`).bind(now, now, claim.userId, ...fenceBind),
    // Delete only memberships the user does NOT own: a controlling-owner
    // membership is immutable at the DB boundary (trigger guard) and its
    // personal workspace is tombstoned below instead. This keeps shared
    // workspaces and their other members intact while the user is removed.
    db.prepare(`DELETE FROM workspace_members WHERE user_id = ? AND workspace_id NOT IN (SELECT id FROM workspaces WHERE owner_user_id = ?) AND ${fence}`).bind(claim.userId, claim.userId, ...fenceBind),
    db.prepare(`UPDATE workspaces SET deleted_at = ? WHERE owner_user_id = ? AND (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = workspaces.id) = 1 AND ${fence}`).bind(now, claim.userId, ...fenceBind),
  ]);

  // The user tombstone only lands when the fence held; it is the leading
  // indicator of whether execution had any effect.
  return (results[0].meta.changes ?? 0) > 0;
}

/** Terminal transition guarded by the lease token and unexpired lease (compare-and-set). */
export async function completeDeletion(id: string, leaseToken: string): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await getD1().prepare("UPDATE deletion_requests SET status='completed',completed_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND status='processing' AND lease_token=? AND lease_expires_at>?").bind(now, id, leaseToken, now).run();
  if ((result.meta.changes ?? 0) > 0) {
    await auditDeletion("account.deletion.completed", id, {});
    return true;
  }
  return false;
}

/**
 * Fails a claim with bounded retries and backoff. A retryable failure releases
 * the lease and schedules the next attempt; once attempts are exhausted the
 * request reaches a terminal rejected state. All transitions are guarded by
 * the lease token so a stale worker cannot overwrite the current one.
 */
export async function failDeletion(id: string, leaseToken: string, error: unknown, retryable: boolean): Promise<"retrying" | "rejected" | "stale"> {
  const db = getD1(); const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  const summary = message.slice(0, 1000);
  const row = await db.prepare("SELECT attempts,max_attempts AS maxAttempts FROM deletion_requests WHERE id=? AND status='processing' AND lease_token=? AND lease_expires_at>?").bind(id, leaseToken, now).first<{ attempts: number; maxAttempts: number }>();
  if (!row) return "stale";
  if (retryable && row.attempts < row.maxAttempts) {
    const next = new Date(Date.now() + 1000 * 2 ** Math.max(0, row.attempts - 1)).toISOString();
    await db.prepare("UPDATE deletion_requests SET status='requested',next_attempt_at=?,scheduled_for=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,error_code='RETRYABLE',error_message=? WHERE id=? AND status='processing' AND lease_token=? AND lease_expires_at>?").bind(next, next, summary, id, leaseToken, now).run();
    await auditDeletion("account.deletion.retried", id, { attempt: row.attempts });
    return "retrying";
  }
  const finalCode = retryable ? "ATTEMPTS_EXHAUSTED" : "DELETION_FAILED";
  await db.prepare("UPDATE deletion_requests SET status='rejected',error_code=?,error_message=?,completed_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND status='processing' AND lease_token=? AND lease_expires_at>?").bind(finalCode, summary, now, id, leaseToken, now).run();
  await auditDeletion("account.deletion.rejected", id, { errorCode: finalCode });
  return "rejected";
}

/**
 * Recovers deletion requests orphaned by a crashed worker: a `processing` row
 * whose lease expired returns to `requested` (or `rejected` if attempts are
 * exhausted) so another worker can claim it.
 */
export async function recoverExpiredDeletions() {
  const db = getD1(); const now = new Date().toISOString();
  await db.prepare("UPDATE deletion_requests SET status=CASE WHEN attempts>=max_attempts THEN 'rejected' ELSE 'requested' END,next_attempt_at=?,scheduled_for=?,error_code=COALESCE(error_code,'LEASE_EXPIRED'),error_message=COALESCE(error_message,'Worker lease expired; deletion recovered'),lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE status='processing' AND lease_expires_at<?").bind(now, now, now).run();
}
