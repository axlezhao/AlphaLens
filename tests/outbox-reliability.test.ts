import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  claimNextWebhook, completeWebhook, enqueueWebhookDelivery, failWebhook,
  recoverExpiredWebhooks, requeueWebhookDeadLetter,
} from "../lib/outbox/service";
import { summarizeDeliveryError, validateWebhookUrl } from "../lib/outbox/webhook-safety";
import {
  OWNER_A, OWNER_B, getDb, installHarness, provisionTenant, teardownHarness,
} from "./helpers/tenant-harness";

async function seedSubscription(workspaceId: string, endpointUrl: string, eventTypes: string[]) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO webhook_subscriptions (id,workspace_id,name,endpoint_url,event_types_json,secret_ciphertext,secret_iv,enabled,verification_status,consecutive_failures,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,'verified',0,?,?)").bind(id, workspaceId, "test-sub", endpointUrl, JSON.stringify(eventTypes), "cipher", "iv", now, now).run();
  return id;
}

async function clearClaimableDeliveries(workspaceId: string) {
  await getDb().prepare("DELETE FROM webhook_deliveries WHERE workspace_id=? AND status IN ('queued','sending')").bind(workspaceId).run();
}

describe("outbox reliability (A3.3)", () => {
  let tenantA: { userId: string; workspaceId: string };
  let tenantB: { userId: string; workspaceId: string };

  before(async () => {
    installHarness();
    tenantA = await provisionTenant(OWNER_A);
    tenantB = await provisionTenant(OWNER_B);
  });
  after(() => teardownHarness());

  beforeEach(async () => {
    await clearClaimableDeliveries(tenantA.workspaceId);
    await clearClaimableDeliveries(tenantB.workspaceId);
  });

  it("validates webhook URLs against unsafe schemes and hosts", () => {
    assert.equal(validateWebhookUrl("https://example.com/hook").ok, true);
    assert.equal((validateWebhookUrl("http://example.com/hook") as { reason: string }).reason, "UNSAFE_SCHEME");
    assert.equal((validateWebhookUrl("https://127.0.0.1/hook") as { reason: string }).reason, "UNSAFE_HOST");
    assert.equal((validateWebhookUrl("https://10.0.0.1/hook") as { reason: string }).reason, "UNSAFE_HOST");
    assert.equal((validateWebhookUrl("https://192.168.1.10/hook") as { reason: string }).reason, "UNSAFE_HOST");
    assert.equal((validateWebhookUrl("https://169.254.169.254/latest/meta-data") as { reason: string }).reason, "UNSAFE_HOST");
    assert.equal((validateWebhookUrl("https://localhost/hook") as { reason: string }).reason, "UNSAFE_HOST");
    assert.equal((validateWebhookUrl("https://metadata.google.internal/hook") as { reason: string }).reason, "UNSAFE_HOST");
    assert.equal((validateWebhookUrl("not a url") as { reason: string }).reason, "INVALID_URL");
    // local development explicitly allows loopback http
    assert.equal(validateWebhookUrl("http://127.0.0.1:8788/hook", true).ok, true);
    assert.equal(validateWebhookUrl("https://10.0.0.1/hook", true).ok, false);
  });

  it("redacts secrets from delivery error summaries", () => {
    const summary = summarizeDeliveryError(new Error("failed with secret=abc123 bearer token=xyz"));
    assert.ok(!summary.includes("abc123"));
    assert.ok(!summary.includes("xyz"));
    assert.ok(!/secret|token|bearer/i.test(summary));
  });

  it("persists an outbox delivery when a business event is enqueued", async () => {
    const subId = await seedSubscription(tenantA.workspaceId, "https://example.com/hook", ["research.completed"]);
    await enqueueWebhookDelivery({ workspaceId: tenantA.workspaceId, subscriptionId: subId, eventId: "job-1:research.completed", eventType: "research.completed", payload: { jobId: "job-1" }, idempotencyKey: "job-1:research.completed" });
    const row = await getDb().prepare("SELECT status,idempotency_key AS idempotencyKey FROM webhook_deliveries WHERE subscription_id=?").bind(subId).first<{ status: string; idempotencyKey: string }>();
    assert.equal(row?.status, "queued");
    assert.equal(row?.idempotencyKey, "job-1:research.completed");
  });

  it("deduplicates deliveries for the same subscription and event", async () => {
    const subId = await seedSubscription(tenantA.workspaceId, "https://example.com/hook", ["research.completed"]);
    await enqueueWebhookDelivery({ workspaceId: tenantA.workspaceId, subscriptionId: subId, eventId: "dup-event", eventType: "research.completed", payload: {}, idempotencyKey: "dup-key" });
    await enqueueWebhookDelivery({ workspaceId: tenantA.workspaceId, subscriptionId: subId, eventId: "dup-event", eventType: "research.completed", payload: {}, idempotencyKey: "dup-key" });
    const count = await getDb().prepare("SELECT COUNT(*) AS c FROM webhook_deliveries WHERE subscription_id=?").bind(subId).first<{ c: number }>();
    assert.equal(count?.c, 1);
  });

  it("lets at most one worker claim a delivery concurrently", async () => {
    const subId = await seedSubscription(tenantA.workspaceId, "https://example.com/hook", ["research.completed"]);
    await enqueueWebhookDelivery({ workspaceId: tenantA.workspaceId, subscriptionId: subId, eventId: "claim-event", eventType: "research.completed", payload: {}, idempotencyKey: "claim-key" });
    const [first, second] = await Promise.all([claimNextWebhook("w1"), claimNextWebhook("w2")]);
    assert.equal([first, second].filter(Boolean).length, 1);
    const row = await getDb().prepare("SELECT status,lease_owner AS leaseOwner FROM webhook_deliveries WHERE subscription_id=?").bind(subId).first<{ status: string; leaseOwner: string }>();
    assert.equal(row?.status, "sending");
  });

  it("retries a failed delivery and dead-letters after max attempts", async () => {
    const subId = await seedSubscription(tenantA.workspaceId, "https://example.com/hook", ["research.completed"]);
    await enqueueWebhookDelivery({ workspaceId: tenantA.workspaceId, subscriptionId: subId, eventId: "retry-event", eventType: "research.completed", payload: {}, idempotencyKey: "retry-key", maxAttempts: 2 });
    const claimed = await claimNextWebhook("w1");
    assert.ok(claimed);
    await failWebhook(claimed!.id, claimed!.leaseToken, new Error("transient"), true);
    let row = await getDb().prepare("SELECT status,error_code AS errorCode FROM webhook_deliveries WHERE id=?").bind(claimed!.id).first<{ status: string; errorCode: string | null }>();
    assert.equal(row?.status, "queued");

    // advance the backoff so the next attempt is immediately due
    await getDb().prepare("UPDATE webhook_deliveries SET next_attempt_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), claimed!.id).run();
    const claimed2 = await claimNextWebhook("w1");
    assert.ok(claimed2);
    await failWebhook(claimed2!.id, claimed2!.leaseToken, new Error("still failing"), true);
    row = await getDb().prepare("SELECT status,error_code AS errorCode FROM webhook_deliveries WHERE id=?").bind(claimed!.id).first<{ status: string; errorCode: string | null }>();
    assert.equal(row?.status, "dead_letter");
    assert.equal(row?.errorCode, "ATTEMPTS_EXHAUSTED");
  });

  it("does not persist secrets into delivery failure rows", async () => {
    const subId = await seedSubscription(tenantA.workspaceId, "https://example.com/hook", ["research.completed"]);
    await enqueueWebhookDelivery({ workspaceId: tenantA.workspaceId, subscriptionId: subId, eventId: "secret-event", eventType: "research.completed", payload: {}, idempotencyKey: "secret-key" });
    const claimed = await claimNextWebhook("w1");
    await failWebhook(claimed!.id, claimed!.leaseToken, new Error("delivery failed, signing secret=supersecret token=abc123"), true);
    const row = await getDb().prepare("SELECT error_message AS errorMessage FROM webhook_deliveries WHERE id=?").bind(claimed!.id).first<{ errorMessage: string }>();
    assert.ok(!row!.errorMessage.includes("supersecret"));
    assert.ok(!row!.errorMessage.includes("abc123"));
  });

  it("requeues a dead-lettered delivery only within its own workspace", async () => {
    const subId = await seedSubscription(tenantA.workspaceId, "https://example.com/hook", ["research.completed"]);
    await enqueueWebhookDelivery({ workspaceId: tenantA.workspaceId, subscriptionId: subId, eventId: "dlq-event", eventType: "research.completed", payload: {}, idempotencyKey: "dlq-key", maxAttempts: 1 });
    const claimed = await claimNextWebhook("w1");
    await failWebhook(claimed!.id, claimed!.leaseToken, new Error("boom"), true);
    // A different workspace cannot requeue it.
    const crossTenant = await requeueWebhookDeadLetter(tenantB.workspaceId, claimed!.id);
    assert.equal(crossTenant, false);
    // The owning workspace can.
    const sameTenant = await requeueWebhookDeadLetter(tenantA.workspaceId, claimed!.id);
    assert.equal(sameTenant, true);
    const row = await getDb().prepare("SELECT status FROM webhook_deliveries WHERE id=?").bind(claimed!.id).first<{ status: string }>();
    assert.equal(row?.status, "queued");
  });

  it("recovers an expired webhook lease back to queued", async () => {
    const subId = await seedSubscription(tenantA.workspaceId, "https://example.com/hook", ["research.completed"]);
    await enqueueWebhookDelivery({ workspaceId: tenantA.workspaceId, subscriptionId: subId, eventId: "lease-event", eventType: "research.completed", payload: {}, idempotencyKey: "lease-key" });
    const claimed = await claimNextWebhook("w1");
    await getDb().prepare("UPDATE webhook_deliveries SET lease_expires_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), claimed!.id).run();
    await recoverExpiredWebhooks();
    const row = await getDb().prepare("SELECT status,lease_owner AS leaseOwner FROM webhook_deliveries WHERE id=?").bind(claimed!.id).first<{ status: string; leaseOwner: string | null }>();
    assert.equal(row?.status, "queued");
    assert.equal(row?.leaseOwner, null);
  });

  it("marks a delivered webhook as delivered", async () => {
    const subId = await seedSubscription(tenantA.workspaceId, "https://example.com/hook", ["research.completed"]);
    await enqueueWebhookDelivery({ workspaceId: tenantA.workspaceId, subscriptionId: subId, eventId: "done-event", eventType: "research.completed", payload: {}, idempotencyKey: "done-key" });
    const claimed = await claimNextWebhook("w1");
    await completeWebhook(claimed!.id, claimed!.leaseToken, { status: 200, bytes: 2, hash: "ab" });
    const row = await getDb().prepare("SELECT status,response_status AS responseStatus,response_bytes AS responseBytes FROM webhook_deliveries WHERE id=?").bind(claimed!.id).first<{ status: string; responseStatus: number; responseBytes: number | null }>();
    assert.equal(row?.status, "delivered");
    assert.equal(row?.responseStatus, 200);
  });

  it("a stale worker's complete cannot overwrite a newer worker's sending state", async () => {
    const subId = await seedSubscription(tenantA.workspaceId, "https://example.com/hook", ["research.completed"]);
    await enqueueWebhookDelivery({ workspaceId: tenantA.workspaceId, subscriptionId: subId, eventId: "stale-complete", eventType: "research.completed", payload: {}, idempotencyKey: "stale-complete" });
    // Worker A claims, then its lease expires and is reclaimed by worker B.
    const a = await claimNextWebhook("worker-a");
    assert.ok(a);
    await getDb().prepare("UPDATE webhook_deliveries SET lease_expires_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), a!.id).run();
    await recoverExpiredWebhooks();
    const b = await claimNextWebhook("worker-b");
    assert.ok(b);
    assert.equal(b!.id, a!.id);
    // A's late complete (with A's stale token) must not change B's sending state.
    const changed = await completeWebhook(a!.id, a!.leaseToken, { status: 200 });
    assert.equal(changed, false);
    const row = await getDb().prepare("SELECT status,lease_owner AS leaseOwner FROM webhook_deliveries WHERE id=?").bind(a!.id).first<{ status: string; leaseOwner: string | null }>();
    assert.equal(row?.status, "sending");
    assert.equal(row?.leaseOwner, "worker-b");
  });

  it("a stale worker's fail cannot overwrite a delivered state", async () => {
    const subId = await seedSubscription(tenantA.workspaceId, "https://example.com/hook", ["research.completed"]);
    await enqueueWebhookDelivery({ workspaceId: tenantA.workspaceId, subscriptionId: subId, eventId: "stale-fail", eventType: "research.completed", payload: {}, idempotencyKey: "stale-fail" });
    const a = await claimNextWebhook("worker-a");
    assert.ok(a);
    // B reclaims after A's lease expires, then B delivers successfully.
    await getDb().prepare("UPDATE webhook_deliveries SET lease_expires_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), a!.id).run();
    await recoverExpiredWebhooks();
    const b = await claimNextWebhook("worker-b");
    assert.ok(b);
    await completeWebhook(b!.id, b!.leaseToken, { status: 200 });
    // A's late fail (stale token) must not overwrite B's delivered state.
    const changed = await failWebhook(a!.id, a!.leaseToken, new Error("late failure"), true);
    assert.equal(changed, false);
    const row = await getDb().prepare("SELECT status FROM webhook_deliveries WHERE id=?").bind(a!.id).first<{ status: string }>();
    assert.equal(row?.status, "delivered");
  });

  it("a stale worker's requeue cannot move a delivered delivery", async () => {
    const subId = await seedSubscription(tenantA.workspaceId, "https://example.com/hook", ["research.completed"]);
    await enqueueWebhookDelivery({ workspaceId: tenantA.workspaceId, subscriptionId: subId, eventId: "stale-requeue", eventType: "research.completed", payload: {}, idempotencyKey: "stale-requeue", maxAttempts: 1 });
    const a = await claimNextWebhook("worker-a");
    assert.ok(a);
    await getDb().prepare("UPDATE webhook_deliveries SET lease_expires_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), a!.id).run();
    await recoverExpiredWebhooks();
    const b = await claimNextWebhook("worker-b");
    assert.ok(b);
    await completeWebhook(b!.id, b!.leaseToken, { status: 200 });
    // A's stale requeue path: failWebhook with a stale token cannot touch delivered.
    const changed = await failWebhook(a!.id, a!.leaseToken, new Error("boom"), true);
    assert.equal(changed, false);
    const row = await getDb().prepare("SELECT status FROM webhook_deliveries WHERE id=?").bind(a!.id).first<{ status: string }>();
    assert.equal(row?.status, "delivered");
  });
});
