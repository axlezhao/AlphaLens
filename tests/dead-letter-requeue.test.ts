import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { POST as requeueDelivery } from "../app/api/v1/webhooks/deliveries/[deliveryId]/requeue/route";
import { claimNextWebhook, enqueueWebhookDelivery, failWebhook } from "../lib/outbox/service";
import {
  EDITOR_A, OWNER_A, OWNER_B, addMember, apiRequest, asUser, getDb, installHarness, provisionTenant, responseBody, teardownHarness,
} from "./helpers/tenant-harness";

async function seedDeadLetter(workspaceId: string, eventId: string): Promise<string> {
  const db = getDb();
  const subId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO webhook_subscriptions (id,workspace_id,name,endpoint_url,event_types_json,secret_ciphertext,secret_iv,enabled,verification_status,consecutive_failures,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,'verified',0,?,?)").bind(subId, workspaceId, "test-sub", "https://example.com/hook", JSON.stringify(["research.completed"]), "cipher", "iv", now, now).run();
  await enqueueWebhookDelivery({ workspaceId, subscriptionId: subId, eventId, eventType: "research.completed", payload: {}, idempotencyKey: eventId, maxAttempts: 1 });
  const claimed = await claimNextWebhook("w1");
  await failWebhook(claimed!.id, claimed!.leaseToken, new Error("boom"), true);
  return claimed!.id;
}

describe("dead-letter requeue RBAC (A3.3)", () => {
  let ownerA: { userId: string; workspaceId: string };
  let deliveryId: string;

  before(async () => {
    installHarness();
    ownerA = await provisionTenant(OWNER_A);
    await provisionTenant(OWNER_B);
    await addMember(ownerA.workspaceId, EDITOR_A, "editor");
  });
  after(() => teardownHarness());

  beforeEach(async () => {
    deliveryId = await seedDeadLetter(ownerA.workspaceId, `dlq-${crypto.randomUUID()}`);
  });

  it("allows the workspace owner to requeue a dead-lettered delivery", async () => {
    asUser(OWNER_A);
    const response = await requeueDelivery(apiRequest(`/api/v1/webhooks/deliveries/${deliveryId}/requeue`, { method: "POST" }), { params: Promise.resolve({ deliveryId }) });
    assert.equal(response.status, 200);
    const row = await getDb().prepare("SELECT status FROM webhook_deliveries WHERE id=?").bind(deliveryId).first<{ status: string }>();
    assert.equal(row?.status, "queued");
    const audit = await getDb().prepare("SELECT action FROM audit_logs WHERE resource_id=? AND action='webhook.delivery.requeue'").bind(deliveryId).all<{ action: string }>();
    assert.equal(audit.results.length, 1);
  });

  it("rejects a non-owner member of the owning workspace", async () => {
    asUser(EDITOR_A);
    const response = await requeueDelivery(apiRequest(`/api/v1/webhooks/deliveries/${deliveryId}/requeue`, { method: "POST" }), { params: Promise.resolve({ deliveryId }) });
    assert.equal(response.status, 403);
    const row = await getDb().prepare("SELECT status FROM webhook_deliveries WHERE id=?").bind(deliveryId).first<{ status: string }>();
    assert.equal(row?.status, "dead_letter");
  });

  it("rejects a user from another workspace without leaking existence", async () => {
    asUser(OWNER_B);
    const response = await requeueDelivery(apiRequest(`/api/v1/webhooks/deliveries/${deliveryId}/requeue`, { method: "POST" }), { params: Promise.resolve({ deliveryId }) });
    assert.equal(response.status, 404);
    const body = await responseBody(response);
    assert.equal((body?.error as Record<string, unknown>)?.code, "WORKSPACE_NOT_FOUND");
  });

  it("rejects an unauthenticated request", async () => {
    delete process.env.ALPHALENS_FIXTURE_MODE;
    try {
      const response = await requeueDelivery(apiRequest(`/api/v1/webhooks/deliveries/${deliveryId}/requeue`, { method: "POST" }), { params: Promise.resolve({ deliveryId }) });
      assert.equal(response.status, 401);
    } finally {
      process.env.ALPHALENS_FIXTURE_MODE = "true";
    }
  });
});
