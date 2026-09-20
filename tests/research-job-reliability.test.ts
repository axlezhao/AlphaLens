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
});
