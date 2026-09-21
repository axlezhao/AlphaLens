import { getD1 } from "../../db";
import { consensusEstimates, marketQuote } from "../providers/alpha-vantage";
import { issuerIrEvents } from "../providers/issuer-ir";
import { secCompany } from "../providers/sec-edgar";
import type { ProviderEnvelope } from "../providers/types";
import { resolveProviderPlan } from "../platform/provider-routing";
import { saveSource, saveVersionedEvidence } from "./evidence-repository";
import { fixtureProviderSnapshots } from "./fixture-provider";
import { isLocalFixtureMode } from "../runtime/local-fixture";
import { backoffDelayMs, classifyJobError, summarizeError } from "./job-state";
import { buildResearchOutboxDeliveries } from "../outbox/events";

export type ClaimedJob = { id: string; workspaceId: string; securityId: string; ticker: string; question: string; asOf: string; attempts: number; maxAttempts: number; irBaseUrl: string | null; irFeedUrl: string | null; leaseToken: string };

/** How long a worker's lease on a running job lasts before it is recoverable. */
const LEASE_MS = 90_000;

/** Signalled when a job was finalised as cancelled (a cancel flag was observed). */
class CancelledDuringExecution extends Error {
  constructor() { super("Research job cancelled during provider execution"); this.name = "CancelledDuringExecution"; }
}

/** Signalled when this worker lost the lease and must not write any state/event. */
class LeaseLost extends Error {
  constructor() { super("Research job lease lost"); this.name = "LeaseLost"; }
}

export type JobOutcome = { id: string; status: "succeeded" | "failed" | "retrying" | "cancelled" | "stale" };

export async function runNextJobs(workerId: string, limit = 3) {
  const results: JobOutcome[] = [];
  await recoverExpiredJobs();
  for (let index = 0; index < Math.min(limit, 10); index++) {
    const job = await claimNextJob(workerId);
    if (!job) break;
    results.push(await executeJob(job));
  }
  return results;
}

/**
 * Atomically claims the next due, uncancelled, claimable job and returns a
 * lease token unique to this claim. The claim transition and the matching
 * `running` event are written in a single batch so a crash cannot leave a
 * running job without its event. The claim excludes cancelled jobs, so a cancel
 * that lands before claim can never be claimed.
 */
export async function claimNextJob(workerId: string): Promise<ClaimedJob | null> {
  const db = getD1(); const now = new Date().toISOString();
  const candidate = await db.prepare("SELECT j.id,j.workspace_id AS workspaceId,j.security_id AS securityId,j.question,j.as_of AS asOf,j.attempts,j.max_attempts AS maxAttempts,s.ticker,s.ir_base_url AS irBaseUrl,s.ir_feed_url AS irFeedUrl FROM research_jobs j JOIN securities s ON s.id=j.security_id WHERE j.status IN ('queued','retrying') AND j.next_run_at<=? AND j.cancel_requested_at IS NULL ORDER BY j.created_at LIMIT 1").bind(now).first<Omit<ClaimedJob, "leaseToken">>();
  if (!candidate) return null;
  const leaseExpires = new Date(Date.now() + LEASE_MS).toISOString();
  const leaseToken = crypto.randomUUID();
  const attempts = candidate.attempts + 1;
  const [claimResult] = await db.batch([
    db.prepare("UPDATE research_jobs SET status='running',lease_owner=?,lease_token=?,lease_expires_at=?,started_at=COALESCE(started_at,?),attempts=attempts+1,event_seq=event_seq+1,updated_at=? WHERE id=? AND status IN ('queued','retrying') AND cancel_requested_at IS NULL").bind(workerId, leaseToken, leaseExpires, now, now, candidate.id),
    db.prepare("INSERT OR IGNORE INTO research_job_events (id,job_id,sequence,event_type,payload_json,created_at) SELECT ?,?,event_seq,'running',?,? FROM research_jobs WHERE id=? AND status='running'").bind(crypto.randomUUID(), candidate.id, JSON.stringify({ attempt: attempts, workerId }), now, candidate.id),
  ]);
  if (!claimResult.meta.changes) return null;
  return { ...candidate, attempts, leaseToken };
}

/**
 * Atomically finalises a job as cancelled, but only when a cancel has actually
 * been requested and this worker still holds an unexpired lease. The status
 * change and the `cancelled` event land in one batch; a lost lease returns
 * false without touching state or events.
 */
async function finalizeCancelled(job: ClaimedJob): Promise<boolean> {
  const db = getD1(); const now = new Date().toISOString();
  const [result] = await db.batch([
    db.prepare("UPDATE research_jobs SET status='cancelled',completed_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,event_seq=event_seq+1,updated_at=? WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>? AND cancel_requested_at IS NOT NULL").bind(now, now, job.id, job.leaseToken, now),
    db.prepare("INSERT OR IGNORE INTO research_job_events (id,job_id,sequence,event_type,payload_json,created_at) SELECT ?,?,event_seq,'cancelled',?,? FROM research_jobs WHERE id=? AND status='cancelled'").bind(crypto.randomUUID(), job.id, JSON.stringify({}), now, job.id),
  ]);
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Atomically finalises a job as succeeded: the guarded state transition, the
 * `succeeded` event, and the webhook delivery fan-out all land in one batch.
 * If the transition does not land, no event and no delivery are written, and
 * the caller falls back to cancelled/stale.
 */
async function finalizeSucceeded(job: ClaimedJob, snapshotJson: string, eventPayload: unknown): Promise<"succeeded" | "cancelled" | "stale"> {
  const db = getD1(); const now = new Date().toISOString();
  const deliveries = await buildResearchOutboxDeliveries(job.workspaceId, job.id, job.ticker, "succeeded");
  const [result] = await db.batch([
    db.prepare("UPDATE research_jobs SET status='succeeded',snapshot_json=?,completed_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,event_seq=event_seq+1,updated_at=? WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>? AND cancel_requested_at IS NULL").bind(snapshotJson, now, now, job.id, job.leaseToken, now),
    db.prepare("INSERT OR IGNORE INTO research_job_events (id,job_id,sequence,event_type,payload_json,created_at) SELECT ?,?,event_seq,'succeeded',?,? FROM research_jobs WHERE id=? AND status='succeeded'").bind(crypto.randomUUID(), job.id, JSON.stringify(eventPayload), now, job.id),
    ...deliveries,
  ]);
  if ((result.meta.changes ?? 0) > 0) return "succeeded";
  return (await finalizeCancelled(job)) ? "cancelled" : "stale";
}

/**
 * Atomically finalises a job as failed: the guarded state transition and the
 * `failed` event land in one batch. On a failed transition, falls back to
 * cancelled (if a cancel flag appeared) or stale (lease lost).
 */
async function finalizeFailed(job: ClaimedJob, errorCode: string, summary: string): Promise<"failed" | "cancelled" | "stale"> {
  const db = getD1(); const now = new Date().toISOString();
  const [result] = await db.batch([
    db.prepare("UPDATE research_jobs SET status='failed',error_code=?,error_message=?,completed_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,event_seq=event_seq+1,updated_at=? WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>? AND cancel_requested_at IS NULL").bind(errorCode, summary, now, now, job.id, job.leaseToken, now),
    db.prepare("INSERT OR IGNORE INTO research_job_events (id,job_id,sequence,event_type,payload_json,created_at) SELECT ?,?,event_seq,'failed',?,? FROM research_jobs WHERE id=? AND status='failed'").bind(crypto.randomUUID(), job.id, JSON.stringify({ errorCode, error: summary }), now, job.id),
  ]);
  if ((result.meta.changes ?? 0) > 0) return "failed";
  return (await finalizeCancelled(job)) ? "cancelled" : "stale";
}

/**
 * Atomically releases a job back to retrying: the guarded state transition and
 * the `retry_scheduled` event land in one batch. Falls back to cancelled/stale
 * when the transition does not land.
 */
async function finalizeRetrying(job: ClaimedJob, next: string, errorCode: string, summary: string): Promise<"retrying" | "cancelled" | "stale"> {
  const db = getD1(); const now = new Date().toISOString();
  const [result] = await db.batch([
    db.prepare("UPDATE research_jobs SET status='retrying',next_run_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,error_code=?,error_message=?,event_seq=event_seq+1,updated_at=? WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>? AND cancel_requested_at IS NULL").bind(next, errorCode, summary, now, job.id, job.leaseToken, now),
    db.prepare("INSERT OR IGNORE INTO research_job_events (id,job_id,sequence,event_type,payload_json,created_at) SELECT ?,?,event_seq,'retry_scheduled',?,? FROM research_jobs WHERE id=? AND status='retrying'").bind(crypto.randomUUID(), job.id, JSON.stringify({ attempt: job.attempts, nextRunAt: next, errorCode, error: summary }), now, job.id),
  ]);
  if ((result.meta.changes ?? 0) > 0) return "retrying";
  return (await finalizeCancelled(job)) ? "cancelled" : "stale";
}

export async function executeJob(job: ClaimedJob): Promise<JobOutcome> {
  try {
    await collectAndPersist(job);
    return { id: job.id, status: "succeeded" };
  } catch (error) {
    if (error instanceof CancelledDuringExecution) return { id: job.id, status: "cancelled" };
    if (error instanceof LeaseLost) return { id: job.id, status: "stale" };
    const { retryable, code, message } = classifyJobError(error);
    const summary = summarizeError(message);
    if (retryable && job.attempts < job.maxAttempts) {
      const next = new Date(Date.now() + backoffDelayMs(job.attempts)).toISOString();
      const outcome = await finalizeRetrying(job, next, code, summary);
      return { id: job.id, status: outcome };
    }
    const finalCode = retryable ? "ATTEMPTS_EXHAUSTED" : code;
    const outcome = await finalizeFailed(job, finalCode, summary);
    return { id: job.id, status: outcome };
  }
}

async function collectAndPersist(job: ClaimedJob) {
  const fixtureMode = isLocalFixtureMode();
  const plan = await resolveProviderPlan(job.workspaceId, [
    { capability: "filings", use: "research", requireFreshnessSeconds: 86400 },
    { capability: "market-quote", use: "research", requireFreshnessSeconds: 3600 },
    { capability: "consensus", use: "research", requireFreshnessSeconds: 86400 },
    { capability: "issuer-events", use: "research", requireFreshnessSeconds: 86400 },
  ]);
  const selected = new Set(plan.map((item) => item.selected?.provider).filter(Boolean));
  const calls: Array<Promise<ProviderEnvelope<unknown>>> = [];
  if (!fixtureMode) {
    if (selected.has("sec-edgar")) calls.push(secCompany(job.ticker).then((value) => value.filings as ProviderEnvelope<unknown>));
    if (selected.has("alpha-vantage-market")) calls.push(marketQuote(job.ticker));
    if (selected.has("alpha-vantage-consensus")) calls.push(consensusEstimates(job.ticker));
    if (selected.has("issuer-ir") && job.irBaseUrl && job.irFeedUrl) calls.push(issuerIrEvents(job.irFeedUrl, job.irBaseUrl));
  }

  const settled = fixtureMode
    ? fixtureProviderSnapshots(job.ticker, job.asOf).map((value) => ({ status: "fulfilled" as const, value }))
    : await Promise.allSettled(calls);

  const fulfilled = settled.filter((item): item is PromiseFulfilledResult<ProviderEnvelope<unknown>> => item.status === "fulfilled").map((item) => item.value);
  const failures = settled.filter((item): item is PromiseRejectedResult => item.status === "rejected").map((item) => item.reason instanceof Error ? item.reason.message : String(item.reason));
  const secEnvelope = fulfilled.find((item) => item.provider === "sec-edgar");
  if (!secEnvelope) throw new Error(`Required SEC source failed: ${failures.join("; ")}`);

  for (const envelope of fulfilled) {
    const sourceType = envelope.provider === "sec-edgar" ? "sec" : envelope.provider === "issuer-ir" ? "ir" : envelope.provider.includes("consensus") ? "consensus" : "market";
    const sourceId = await saveSource(job.workspaceId, envelope, `${job.ticker} ${envelope.provider} snapshot`, envelope.provider === "sec-edgar" ? "U.S. SEC" : envelope.provider === "issuer-ir" ? `${job.ticker} Investor Relations` : "Alpha Vantage", sourceType);
    if (envelope.provider === "alpha-vantage-market") await saveVersionedEvidence({ workspaceId: job.workspaceId, securityId: job.securityId, sourceId, naturalKey: "market-quote", kind: "FACT", claim: `${job.ticker} market quote snapshot`, value: envelope.data, observedAt: envelope.fetchedAt, asOf: job.asOf, confidence: envelope.freshness === "fresh" ? 0.9 : 0.65 });
    if (envelope.provider === "alpha-vantage-consensus") await saveVersionedEvidence({ workspaceId: job.workspaceId, securityId: job.securityId, sourceId, naturalKey: "consensus-estimates", kind: "EXPECTATION", claim: `${job.ticker} analyst EPS and revenue consensus snapshot`, value: envelope.data, observedAt: envelope.fetchedAt, asOf: job.asOf, confidence: envelope.freshness === "fresh" ? 0.85 : 0.6 });
  }
  const snapshot = { schemaVersion: 1, sourceMode: fixtureMode ? "fixture" : "live", ticker: job.ticker, question: job.question, asOf: job.asOf, generatedAt: new Date().toISOString(), providerPlan: plan.map((item) => ({ capability: item.request.capability, selected: item.selected?.provider ?? null, fallbacks: item.fallbacks.map((route) => route.provider), rejected: item.rejected, explanation: item.explanation })), sources: fulfilled.map(compactEnvelope), warnings: failures };

  // The final succeeded transition, its event, and its outbox deliveries are
  // atomic. A cancel that lands after the providers return but before the
  // transition is observed by the `cancel_requested_at IS NULL` guard, and the
  // job is finalised cancelled (never succeeded) with a single cancelled event.
  const outcome = await finalizeSucceeded(job, JSON.stringify(snapshot), { sources: fulfilled.length, warnings: failures });
  if (outcome === "succeeded") return;
  if (outcome === "cancelled") throw new CancelledDuringExecution();
  throw new LeaseLost();
}

/**
 * Recovers work orphaned by a crashed worker and enforces deadlines.
 *  - A running job with a pending cancel becomes cancelled (with event).
 *  - A running job whose lease expired becomes retrying (or failed if its
 *    attempts are exhausted).
 *  - Any non-terminal, non-cancelled job past its timeout becomes failed.
 */
export async function recoverExpiredJobs() {
  const db = getD1(); const now = new Date().toISOString();
  // 1. Cancelled running jobs whose lease expired → cancelled (atomic + event).
  const cancelRows = await db.prepare("SELECT id FROM research_jobs WHERE status='running' AND lease_expires_at<? AND cancel_requested_at IS NOT NULL").bind(now).all<{ id: string }>();
  for (const row of cancelRows.results) {
    await db.batch([
      db.prepare("UPDATE research_jobs SET status='cancelled',completed_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,event_seq=event_seq+1,updated_at=? WHERE id=? AND status='running' AND cancel_requested_at IS NOT NULL").bind(now, now, row.id),
      db.prepare("INSERT OR IGNORE INTO research_job_events (id,job_id,sequence,event_type,payload_json,created_at) SELECT ?,?,event_seq,'cancelled',?,? FROM research_jobs WHERE id=? AND status='cancelled'").bind(crypto.randomUUID(), row.id, JSON.stringify({ reason: "lease_expired" }), now, row.id),
    ]);
  }
  // 2. Expired running jobs without a cancel → retrying/failed.
  await db.prepare("UPDATE research_jobs SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'retrying' END,error_code='LEASE_EXPIRED',error_message='Worker lease expired; job recovered',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,next_run_at=?,updated_at=? WHERE status='running' AND lease_expires_at<? AND cancel_requested_at IS NULL").bind(now, now, now).run();
  // 3. Timeout (non-cancelled) → failed.
  await db.prepare("UPDATE research_jobs SET status='failed',error_code='TIMEOUT',error_message='Research job exceeded deadline',completed_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE status IN ('queued','retrying','running') AND timeout_at<? AND cancel_requested_at IS NULL").bind(now, now, now).run();
}

function compactEnvelope(envelope: ProviderEnvelope<unknown>) { return { provider: envelope.provider, asOf: envelope.asOf, fetchedAt: envelope.fetchedAt, staleAt: envelope.staleAt, freshness: envelope.freshness, cache: envelope.cache, sourceUrl: envelope.sourceUrl, licenseScope: envelope.licenseScope, data: envelope.data }; }
