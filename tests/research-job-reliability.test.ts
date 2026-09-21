import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cancelJob, enqueueResearch } from "../lib/research/queue";
import { claimNextJob, executeJob, recoverExpiredJobs } from "../lib/research/runner";
import { backoffDelayMs, classifyJobError, NonRetryableJobError } from "../lib/research/job-state";
import {
  OWNER_A, OWNER_B, asUser, getDb, installHarness, provisionTenant, teardownHarness,
} from "./helpers/tenant-harness";

async function seedJob(workspaceId: string, userId: string, ticker: string, overrides: Record<string, unknown> = {}) {
  const db = getDb();
  // Isolate each claim test from jobs left by earlier cases in the shared DB.
  await db.prepare("DELETE FROM research_jobs WHERE workspace_id=? AND status IN ('queued','retrying')").bind(workspaceId).run();
  const securityId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare("INSERT OR IGNORE INTO securities (id,workspace_id,ticker,exchange,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(securityId, workspaceId, ticker, "US", now, now).run();
  const realSecurity = await db.prepare("SELECT id FROM securities WHERE workspace_id=? AND ticker=? AND exchange='US'").bind(workspaceId, ticker).first<{ id: string }>();
  const fields: Record<string, unknown> = {
    id: jobId, workspace_id: workspaceId, requested_by_user_id: userId, security_id: realSecurity!.id, question: "test question",
    status: "queued", as_of: now, idempotency_key: crypto.randomUUID(), trace_id: crypto.randomUUID(),
    model_version: "test", prompt_version: "test", attempts: 0, max_attempts: 3, next_run_at: now, timeout_at: new Date(Date.now() + 600_000).toISOString(), created_at: now, updated_at: now, ...overrides,
  };
  const cols = Object.keys(fields).join(",");
  const placeholders = Object.keys(fields).map(() => "?").join(",");
  await db.prepare(`INSERT INTO research_jobs (${cols}) VALUES (${placeholders})`).bind(...(Object.values(fields) as (string | number | null)[])).run();
  return jobId;
}

describe("research job reliability (A3.3)", () => {
  let tenantA: { userId: string; workspaceId: string };
  let tenantB: { userId: string; workspaceId: string };

  before(async () => {
    installHarness();
    tenantA = await provisionTenant(OWNER_A);
    tenantB = await provisionTenant(OWNER_B);
  });
  after(() => teardownHarness());

  it("applies exponential backoff without jitter", () => {
    assert.equal(backoffDelayMs(1), 1000);
    assert.equal(backoffDelayMs(2), 2000);
    assert.equal(backoffDelayMs(3), 4000);
    assert.equal(backoffDelayMs(4), 8000);
  });

  it("classifies non-retryable errors distinctly", () => {
    assert.equal(classifyJobError(new NonRetryableJobError("BAD_INPUT", "boom")).retryable, false);
    assert.equal(classifyJobError(new Error("transient")).retryable, true);
  });

  it("does not create duplicate jobs for the same idempotency key", async () => {
    asUser(OWNER_A);
    const context = { userId: tenantA.userId, email: OWNER_A, workspaceId: tenantA.workspaceId, role: "owner" as const };
    const key = "fixed-idempotency-key";
    await enqueueResearch(context, { ticker: "NVDA", question: "q", asOf: "2026-07-01T00:00:00.000Z", idempotencyKey: key });
    await enqueueResearch(context, { ticker: "NVDA", question: "q", asOf: "2026-07-01T00:00:00.000Z", idempotencyKey: key });
    const count = await getDb().prepare("SELECT COUNT(*) AS c FROM research_jobs WHERE workspace_id=? AND idempotency_key=?").bind(tenantA.workspaceId, key).first<{ c: number }>();
    assert.equal(count?.c, 1);
  });

  it("lets at most one worker claim a given job concurrently", async () => {
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD");
    const [first, second] = await Promise.all([claimNextJob("worker-1"), claimNextJob("worker-2")]);
    const claimed = [first, second].filter(Boolean);
    assert.equal(claimed.length, 1, "exactly one worker must win the claim");
    const row = await getDb().prepare("SELECT lease_owner AS leaseOwner,status,attempts FROM research_jobs WHERE id=?").bind(jobId).first<{ leaseOwner: string; status: string; attempts: number }>();
    assert.equal(row?.status, "running");
    assert.equal(row?.attempts, 1);
  });

  it("recovers an expired lease back to retrying", async () => {
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD", { status: "running", attempts: 1, lease_owner: "crashed", lease_expires_at: new Date(Date.now() - 1000).toISOString() });
    await recoverExpiredJobs();
    const row = await getDb().prepare("SELECT status,error_code AS errorCode,lease_owner AS leaseOwner FROM research_jobs WHERE id=?").bind(jobId).first<{ status: string; errorCode: string; leaseOwner: string | null }>();
    assert.equal(row?.status, "retrying");
    assert.equal(row?.errorCode, "LEASE_EXPIRED");
    assert.equal(row?.leaseOwner, null);
  });

  it("fails a job whose attempts are exhausted when its lease expires", async () => {
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD", { status: "running", attempts: 3, max_attempts: 3, lease_expires_at: new Date(Date.now() - 1000).toISOString() });
    await recoverExpiredJobs();
    const row = await getDb().prepare("SELECT status FROM research_jobs WHERE id=?").bind(jobId).first<{ status: string }>();
    assert.equal(row?.status, "failed");
  });

  it("does not claim a terminal (succeeded) job", async () => {
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD", { status: "succeeded", completed_at: new Date().toISOString() });
    const claimed = await claimNextJob("worker-1");
    assert.equal(claimed, null);
    const row = await getDb().prepare("SELECT status FROM research_jobs WHERE id=?").bind(jobId).first<{ status: string }>();
    assert.equal(row?.status, "succeeded");
  });

  it("finalises a cancelled running job as cancelled, never succeeded", async () => {
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD", { status: "running", attempts: 1, cancel_requested_at: new Date().toISOString(), lease_token: "tok-cancel", lease_expires_at: new Date(Date.now() + 60_000).toISOString() });
    const sec = await getDb().prepare("SELECT id FROM securities WHERE workspace_id=? LIMIT 1").bind(tenantA.workspaceId).first<{ id: string }>();
    const job = { id: jobId, workspaceId: tenantA.workspaceId, securityId: sec!.id, ticker: "AMD", question: "q", asOf: new Date().toISOString(), attempts: 1, maxAttempts: 3, irBaseUrl: null, irFeedUrl: null, leaseToken: "tok-cancel" };
    const result = await executeJob(job);
    assert.equal(result.status, "cancelled");
    const row = await getDb().prepare("SELECT status FROM research_jobs WHERE id=?").bind(jobId).first<{ status: string }>();
    assert.equal(row?.status, "cancelled");
  });

  it("prevents a cancelled job from being claimed", async () => {
    await seedJob(tenantA.workspaceId, tenantA.userId, "AMD", { status: "queued", cancel_requested_at: new Date().toISOString() });
    const claimed = await claimNextJob("worker-1");
    assert.equal(claimed, null);
  });

  it("scopes cancellation to the owning workspace", async () => {
    asUser(OWNER_A);
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD");
    // A user from workspace B cannot cancel A's job.
    const result = await cancelJob(tenantB.workspaceId, jobId);
    assert.equal(result, null);
    const row = await getDb().prepare("SELECT status FROM research_jobs WHERE id=?").bind(jobId).first<{ status: string }>();
    assert.equal(row?.status, "queued");
  });

  it("a worker whose lease expired cannot write a final result after reclaim", async () => {
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD");
    const a = await claimNextJob("worker-a");
    assert.ok(a);
    // A's lease expires; B reclaims the job.
    await getDb().prepare("UPDATE research_jobs SET lease_expires_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), jobId).run();
    await recoverExpiredJobs();
    const b = await claimNextJob("worker-b");
    assert.ok(b);
    assert.equal(b!.id, jobId);
    // A's stale final write (old lease token) must not land.
    const stale = { ...a!, leaseToken: a!.leaseToken };
    const result = await executeJob(stale);
    assert.notEqual(result.status, "succeeded");
    // The job is still held by B (running), not finalised by A.
    const row = await getDb().prepare("SELECT status,lease_owner AS leaseOwner FROM research_jobs WHERE id=?").bind(jobId).first<{ status: string; leaseOwner: string | null }>();
    assert.equal(row?.status, "running");
    assert.equal(row?.leaseOwner, "worker-b");
  });

  it("a cancelled job creates no research.completed outbox delivery", async () => {
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD", { status: "running", attempts: 1, cancel_requested_at: new Date().toISOString(), lease_token: "tok-cancel2", lease_expires_at: new Date(Date.now() + 60_000).toISOString() });
    const sec = await getDb().prepare("SELECT id FROM securities WHERE workspace_id=? LIMIT 1").bind(tenantA.workspaceId).first<{ id: string }>();
    const job = { id: jobId, workspaceId: tenantA.workspaceId, securityId: sec!.id, ticker: "AMD", question: "q", asOf: new Date().toISOString(), attempts: 1, maxAttempts: 3, irBaseUrl: null, irFeedUrl: null, leaseToken: "tok-cancel2" };
    await executeJob(job);
    const deliveries = await getDb().prepare("SELECT COUNT(*) AS c FROM webhook_deliveries WHERE event_id=?").bind(`${jobId}:research.completed`).first<{ c: number }>();
    assert.equal(deliveries?.c, 0, "a cancelled job must not enqueue research.completed");
  });

  it("appends events with a contiguous, gap-free sequence", async () => {
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD");
    await import("../lib/research/queue").then(({ appendEvent }) => Promise.all([
      appendEvent(jobId, "a", {}),
      appendEvent(jobId, "b", {}),
      appendEvent(jobId, "c", {}),
    ]));
    const rows = await getDb().prepare("SELECT sequence FROM research_job_events WHERE job_id=? ORDER BY sequence").bind(jobId).all<{ sequence: number }>();
    const seqs = rows.results.map((r) => r.sequence);
    assert.equal(seqs.length, 3);
    // Strictly monotonic with no gaps.
    for (let i = 1; i < seqs.length; i++) assert.equal(seqs[i], seqs[i - 1] + 1);
  });

  it("a cancel after provider returns but before the final succeeded UPDATE prevents succeeded status", async () => {
    // This test inspects the SQL directly: the final UPDATE includes
    // `cancel_requested_at IS NULL`. If we manually insert a running job with
    // a lease token and then set cancel_requested_at, executeJob should hit the
    // CAS guard and return stale/cancelled — never succeeded.
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD");
    // Manually set up a running job with a known lease token.
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    await getDb().prepare("UPDATE research_jobs SET status='running',lease_token='tok-p02',lease_expires_at=?,cancel_requested_at=? WHERE id=?").bind(future, now, jobId).run();
    const sec = await getDb().prepare("SELECT id FROM securities WHERE workspace_id=? LIMIT 1").bind(tenantA.workspaceId).first<{ id: string }>();
    const job = { id: jobId, workspaceId: tenantA.workspaceId, securityId: sec!.id, ticker: "AMD", question: "q", asOf: now, attempts: 1, maxAttempts: 3, irBaseUrl: null, irFeedUrl: null, leaseToken: "tok-p02" };
    const result = await executeJob(job);
    // The job is not succeeded; because cancel_requested_at is set, the CAS
    // update fails and collectAndPersist throws CancelledDuringExecution.
    assert.notEqual(result.status, "succeeded");
    const row = await getDb().prepare("SELECT status FROM research_jobs WHERE id=?").bind(jobId).first<{ status: string }>();
    assert.notEqual(row?.status, "succeeded", "job must not be finalised as succeeded when cancelled");
  });

  it("successful job emits a contiguous event sequence in the same batch as succeeded", async () => {
    // Use claimNextJob so the `running` event is emitted, then executeJob to
    // emit the `succeeded` event inside the same atomic batch.
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD");
    const claim = await claimNextJob("worker-1");
    assert.ok(claim);
    assert.equal(claim!.id, jobId);
    await executeJob(claim!);
    const row = await getDb().prepare("SELECT status,event_seq AS eventSeq FROM research_jobs WHERE id=?").bind(jobId).first<{ status: string; eventSeq: number }>();
    assert.equal(row?.status, "succeeded");
    // At minimum the running event (from claim) + succeeded event (from collectAndPersist)
    assert.ok(row!.eventSeq >= 2, `expected at least 2 events but got event_seq=${row!.eventSeq}`);
    const eventCount = await getDb().prepare("SELECT COUNT(*) AS c FROM research_job_events WHERE job_id=?").bind(jobId).first<{ c: number }>();
    assert.equal(eventCount?.c, row!.eventSeq, "every incremented event_seq must have a matching event row");
  });

  it("finalizes a mid-flight cancel to cancelled with exactly one cancelled event", async () => {
    // A running job whose cancel flag is set must land in cancelled, with one
    // cancelled event and no succeeded event.
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD", { status: "running", attempts: 1, cancel_requested_at: new Date().toISOString(), lease_token: "tok-c3", lease_expires_at: new Date(Date.now() + 60_000).toISOString() });
    const sec = await getDb().prepare("SELECT id FROM securities WHERE workspace_id=? LIMIT 1").bind(tenantA.workspaceId).first<{ id: string }>();
    const job = { id: jobId, workspaceId: tenantA.workspaceId, securityId: sec!.id, ticker: "AMD", question: "q", asOf: new Date().toISOString(), attempts: 1, maxAttempts: 3, irBaseUrl: null, irFeedUrl: null, leaseToken: "tok-c3" };
    const result = await executeJob(job);
    assert.equal(result.status, "cancelled");
    const row = await getDb().prepare("SELECT status FROM research_jobs WHERE id=?").bind(jobId).first<{ status: string }>();
    assert.equal(row?.status, "cancelled");
    const cancelledEvents = await getDb().prepare("SELECT COUNT(*) AS c FROM research_job_events WHERE job_id=? AND event_type='cancelled'").bind(jobId).first<{ c: number }>();
    assert.equal(cancelledEvents?.c, 1, "exactly one cancelled event");
    const succeededEvents = await getDb().prepare("SELECT COUNT(*) AS c FROM research_job_events WHERE job_id=? AND event_type='succeeded'").bind(jobId).first<{ c: number }>();
    assert.equal(succeededEvents?.c, 0, "no succeeded event");
  });

  it("recovers an expired lease of a cancelled running job as cancelled", async () => {
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD", { status: "running", attempts: 1, cancel_requested_at: new Date().toISOString(), lease_expires_at: new Date(Date.now() - 1000).toISOString() });
    await recoverExpiredJobs();
    const row = await getDb().prepare("SELECT status FROM research_jobs WHERE id=?").bind(jobId).first<{ status: string }>();
    assert.equal(row?.status, "cancelled");
    const cancelledEvents = await getDb().prepare("SELECT COUNT(*) AS c FROM research_job_events WHERE job_id=? AND event_type='cancelled'").bind(jobId).first<{ c: number }>();
    assert.equal(cancelledEvents?.c, 1);
  });

  it("re-running completion does not create duplicate succeeded events or deliveries", async () => {
    // Seed a subscription so the succeeded fan-out creates one delivery.
    const subId = crypto.randomUUID();
    const now = new Date().toISOString();
    await getDb().prepare("INSERT INTO webhook_subscriptions (id,workspace_id,name,endpoint_url,event_types_json,secret_ciphertext,secret_iv,enabled,verification_status,consecutive_failures,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,'verified',0,?,?)").bind(subId, tenantA.workspaceId, "sub", "https://example.com/hook", JSON.stringify(["research.completed"]), "c", "i", now, now).run();
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD");
    const claim = await claimNextJob("worker-1");
    assert.ok(claim);
    const first = await executeJob(claim!);
    assert.equal(first.status, "succeeded");
    // Already terminal: a second execution must not duplicate anything.
    const second = await executeJob(claim!);
    assert.equal(second.status, "stale");
    const succeededEvents = await getDb().prepare("SELECT COUNT(*) AS c FROM research_job_events WHERE job_id=? AND event_type='succeeded'").bind(jobId).first<{ c: number }>();
    assert.equal(succeededEvents?.c, 1, "exactly one succeeded event");
    const deliveries = await getDb().prepare("SELECT COUNT(*) AS c FROM webhook_deliveries WHERE event_id=?").bind(`${jobId}:research.completed`).first<{ c: number }>();
    assert.equal(deliveries?.c, 1, "exactly one outbox delivery");
  });

  it("a lease-lost worker returns stale, not cancelled", async () => {
    const jobId = await seedJob(tenantA.workspaceId, tenantA.userId, "AMD");
    const a = await claimNextJob("worker-a");
    assert.ok(a);
    // A's lease expires; B reclaims.
    await getDb().prepare("UPDATE research_jobs SET lease_expires_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), jobId).run();
    await recoverExpiredJobs();
    const b = await claimNextJob("worker-b");
    assert.ok(b);
    // A's stale finalize must be stale (not cancelled, not succeeded).
    const result = await executeJob({ ...a!, leaseToken: a!.leaseToken });
    assert.equal(result.status, "stale");
    const cancelledEvents = await getDb().prepare("SELECT COUNT(*) AS c FROM research_job_events WHERE job_id=? AND event_type='cancelled'").bind(jobId).first<{ c: number }>();
    assert.equal(cancelledEvents?.c, 0, "a lease-lost worker must not write a cancelled event");
  });
});
