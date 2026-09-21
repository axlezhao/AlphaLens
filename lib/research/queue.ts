import { getD1 } from "../../db";
import type { AuthContext } from "../auth/context";
import { contentHash, stableId } from "../core/ids";

export const MODEL_VERSION = process.env.RESEARCH_MODEL_VERSION ?? "deterministic-beta-0.5";
export const PROMPT_VERSION = process.env.RESEARCH_PROMPT_VERSION ?? "equity-research-v1";

export async function enqueueResearch(context: AuthContext, input: { ticker: string; question: string; asOf: string; idempotencyKey?: string }) {
  const db = getD1();
  const now = new Date().toISOString();
  const ticker = input.ticker.toUpperCase();
  const securityId = await stableId("sec", `${context.workspaceId}:US:${ticker}`);
  const idempotencyKey = input.idempotencyKey ?? await contentHash({ workspaceId: context.workspaceId, ticker, question: input.question, asOf: input.asOf.slice(0, 10) });
  const jobId = await stableId("job", `${context.workspaceId}:${idempotencyKey}`);
  const traceId = crypto.randomUUID();
  // The queued job row and its `queued` event are written atomically. The event
  // only fires when the job is newly created (event_seq advances from 0), so a
  // repeated enqueue of the same idempotency key never emits a second event.
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO securities (id,workspace_id,ticker,exchange,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(securityId, context.workspaceId, ticker, "US", now, now),
    db.prepare("INSERT OR IGNORE INTO research_jobs (id,workspace_id,requested_by_user_id,security_id,question,status,as_of,idempotency_key,trace_id,model_version,prompt_version,attempts,max_attempts,next_run_at,timeout_at,event_seq,created_at,updated_at) VALUES (?,?,?,?,?,'queued',?,?,?,?,?,0,3,?,?,0,?,?)")
      .bind(jobId, context.workspaceId, context.userId, securityId, input.question, input.asOf, idempotencyKey, traceId, MODEL_VERSION, PROMPT_VERSION, now, new Date(Date.now() + 10 * 60_000).toISOString(), now, now),
    db.prepare("UPDATE research_jobs SET event_seq = event_seq + 1, updated_at=? WHERE id=? AND status='queued' AND event_seq = 0").bind(now, jobId),
    db.prepare("INSERT OR IGNORE INTO research_job_events (id,job_id,sequence,event_type,payload_json,created_at) SELECT ?,?,event_seq,'queued',?,? FROM research_jobs WHERE id=? AND status='queued' AND event_seq = 1").bind(crypto.randomUUID(), jobId, JSON.stringify({ ticker, asOf: input.asOf }), now, jobId),
  ]);
  return getJob(context.workspaceId, jobId);
}

export async function getJob(workspaceId: string, jobId: string) {
  return getD1().prepare("SELECT j.id,j.status,j.question,j.as_of AS asOf,j.trace_id AS traceId,j.model_version AS modelVersion,j.prompt_version AS promptVersion,j.attempts,j.max_attempts AS maxAttempts,j.next_run_at AS nextRunAt,j.snapshot_json AS snapshotJson,j.error_code AS errorCode,j.error_message AS errorMessage,j.cancel_requested_at AS cancelRequestedAt,j.created_at AS createdAt,j.updated_at AS updatedAt,s.ticker FROM research_jobs j JOIN securities s ON s.id=j.security_id WHERE j.id=? AND j.workspace_id=?").bind(jobId, workspaceId).first<Record<string, unknown>>();
}

export async function cancelJob(workspaceId: string, jobId: string) {
  const db = getD1(); const now = new Date().toISOString();
  // Cancellation is atomic with its event, and terminal jobs are untouched.
  //  - queued/retrying flip to cancelled immediately (with a `cancelled` event);
  //  - running records cancel_requested_at (with a `cancel_requested` event),
  //    and the owning worker later finalises `cancelled`.
  const [cancelResult] = await db.batch([
    db.prepare("UPDATE research_jobs SET cancel_requested_at=?,status='cancelled',completed_at=?,event_seq=event_seq+1,updated_at=? WHERE id=? AND workspace_id=? AND status IN ('queued','retrying')").bind(now, now, now, jobId, workspaceId),
    db.prepare("INSERT OR IGNORE INTO research_job_events (id,job_id,sequence,event_type,payload_json,created_at) SELECT ?,?,event_seq,'cancelled',?,? FROM research_jobs WHERE id=? AND status='cancelled'").bind(crypto.randomUUID(), jobId, JSON.stringify({}), now, jobId),
  ]);
  if ((cancelResult.meta.changes ?? 0) > 0) return getJob(workspaceId, jobId);

  const [flagResult] = await db.batch([
    db.prepare("UPDATE research_jobs SET cancel_requested_at=?,event_seq=event_seq+1,updated_at=? WHERE id=? AND workspace_id=? AND status='running' AND cancel_requested_at IS NULL").bind(now, now, jobId, workspaceId),
    db.prepare("INSERT OR IGNORE INTO research_job_events (id,job_id,sequence,event_type,payload_json,created_at) SELECT ?,?,event_seq,'cancel_requested',?,? FROM research_jobs WHERE id=? AND status='running' AND cancel_requested_at IS NOT NULL").bind(crypto.randomUUID(), jobId, JSON.stringify({}), now, jobId),
  ]);
  if ((flagResult.meta.changes ?? 0) > 0) return getJob(workspaceId, jobId);
  return null;
}

/**
 * Appends an immutable job event with a collision-free, in-order sequence.
 * The increment and the insert run in a single database transaction, so a
 * crash between them cannot leave a sequence gap. The sequence comes from the
 * parent job's atomic counter, never a racy `SELECT MAX(...)`.
 */
export async function appendEvent(jobId: string, type: string, payload: unknown) {
  const db = getD1(); const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE research_jobs SET event_seq = event_seq + 1 WHERE id=?").bind(jobId),
    db.prepare("INSERT INTO research_job_events (id,job_id,sequence,event_type,payload_json,created_at) SELECT ?,?,event_seq,?,?,? FROM research_jobs WHERE id=?").bind(crypto.randomUUID(), jobId, type, JSON.stringify(payload), now, jobId),
  ]);
}

export async function listEvents(workspaceId: string, jobId: string, after = 0) {
  return getD1().prepare("SELECT e.sequence,e.event_type AS eventType,e.payload_json AS payloadJson,e.created_at AS createdAt FROM research_job_events e JOIN research_jobs j ON j.id=e.job_id WHERE e.job_id=? AND j.workspace_id=? AND e.sequence>? ORDER BY e.sequence LIMIT 100").bind(jobId, workspaceId, after).all();
}
