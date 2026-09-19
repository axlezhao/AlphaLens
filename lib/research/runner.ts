import { getD1 } from "../../db";
import { consensusEstimates, marketQuote } from "../providers/alpha-vantage";
import { issuerIrEvents } from "../providers/issuer-ir";
import { secCompany } from "../providers/sec-edgar";
import type { ProviderEnvelope } from "../providers/types";
import { resolveProviderPlan } from "../platform/provider-routing";
import { saveSource, saveVersionedEvidence } from "./evidence-repository";
import { fixtureProviderSnapshots } from "./fixture-provider";
import { appendEvent } from "./queue";
import { isLocalFixtureMode } from "../runtime/local-fixture";

type ClaimedJob = { id: string; workspaceId: string; securityId: string; ticker: string; question: string; asOf: string; attempts: number; maxAttempts: number; irBaseUrl: string | null; irFeedUrl: string | null };

export async function runNextJobs(workerId: string, limit = 3) {
  const results: Array<{ id: string; status: string }> = [];
  await recoverExpiredJobs();
  for (let index = 0; index < Math.min(limit, 10); index++) {
    const job = await claimNextJob(workerId);
    if (!job) break;
    results.push(await executeJob(job));
  }
  return results;
}

async function claimNextJob(workerId: string): Promise<ClaimedJob | null> {
  const db = getD1(); const now = new Date().toISOString();
  const candidate = await db.prepare("SELECT j.id,j.workspace_id AS workspaceId,j.security_id AS securityId,j.question,j.as_of AS asOf,j.attempts,j.max_attempts AS maxAttempts,s.ticker,s.ir_base_url AS irBaseUrl,s.ir_feed_url AS irFeedUrl FROM research_jobs j JOIN securities s ON s.id=j.security_id WHERE j.status='queued' AND j.next_run_at<=? AND j.cancel_requested_at IS NULL ORDER BY j.created_at LIMIT 1").bind(now).first<ClaimedJob>();
  if (!candidate) return null;
  const leaseExpires = new Date(Date.now() + 90_000).toISOString();
  const result = await db.prepare("UPDATE research_jobs SET status='running',lease_owner=?,lease_expires_at=?,started_at=COALESCE(started_at,?),attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'").bind(workerId, leaseExpires, now, now, candidate.id).run();
  if (!result.meta.changes) return null;
  candidate.attempts += 1;
  await appendEvent(candidate.id, "running", { attempt: candidate.attempts, workerId });
  return candidate;
}

async function executeJob(job: ClaimedJob) {
  const db = getD1();
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
  try {
    const settled = fixtureMode
      ? fixtureProviderSnapshots(job.ticker, job.asOf).map((value) => ({ status: "fulfilled" as const, value }))
      : await Promise.allSettled(calls);
    if ((await db.prepare("SELECT cancel_requested_at AS cancelled FROM research_jobs WHERE id=?").bind(job.id).first<{ cancelled: string | null }>())?.cancelled) {
      await finish(job.id, "cancelled", null); return { id: job.id, status: "cancelled" };
    }
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
    await db.prepare("UPDATE research_jobs SET status='succeeded',snapshot_json=?,completed_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?").bind(JSON.stringify(snapshot), new Date().toISOString(), new Date().toISOString(), job.id).run();
    await appendEvent(job.id, "succeeded", { sources: fulfilled.length, warnings: failures });
    return { id: job.id, status: "succeeded" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (job.attempts < job.maxAttempts) {
      const next = new Date(Date.now() + 1000 * 2 ** job.attempts).toISOString();
      await db.prepare("UPDATE research_jobs SET status='queued',next_run_at=?,lease_owner=NULL,lease_expires_at=NULL,error_code='RETRYABLE',error_message=?,updated_at=? WHERE id=?").bind(next, message.slice(0, 1000), new Date().toISOString(), job.id).run();
      await appendEvent(job.id, "retry_scheduled", { attempt: job.attempts, nextRunAt: next, error: message });
      return { id: job.id, status: "queued" };
    }
    await db.prepare("UPDATE research_jobs SET status='failed',error_code='PROVIDERS_FAILED',error_message=?,completed_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?").bind(message.slice(0, 1000), new Date().toISOString(), new Date().toISOString(), job.id).run();
    await appendEvent(job.id, "failed", { error: message });
    return { id: job.id, status: "failed" };
  }
}

async function recoverExpiredJobs() {
  const now = new Date().toISOString();
  await getD1().prepare("UPDATE research_jobs SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,error_code='LEASE_EXPIRED',error_message='Worker lease expired; job recovered',lease_owner=NULL,lease_expires_at=NULL,next_run_at=?,updated_at=? WHERE status='running' AND lease_expires_at<?").bind(now, now, now).run();
  await getD1().prepare("UPDATE research_jobs SET status='failed',error_code='TIMEOUT',error_message='Research job exceeded deadline',completed_at=?,updated_at=? WHERE status IN ('queued','running') AND timeout_at<?").bind(now, now, now).run();
}

async function finish(jobId: string, status: string, snapshot: unknown) { const now = new Date().toISOString(); await getD1().prepare("UPDATE research_jobs SET status=?,snapshot_json=?,completed_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?").bind(status, snapshot ? JSON.stringify(snapshot) : null, now, now, jobId).run(); await appendEvent(jobId, status, {}); }
function compactEnvelope(envelope: ProviderEnvelope<unknown>) { return { provider: envelope.provider, asOf: envelope.asOf, fetchedAt: envelope.fetchedAt, staleAt: envelope.staleAt, freshness: envelope.freshness, cache: envelope.cache, sourceUrl: envelope.sourceUrl, licenseScope: envelope.licenseScope, data: envelope.data }; }
