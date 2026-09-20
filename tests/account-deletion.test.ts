import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { POST as requestDelete } from "../app/api/v1/account/delete/route";
import { POST as cancelDelete } from "../app/api/v1/account/delete/cancel/route";
import { cancelDeletion, claimNextDeletion, completeDeletion, executeDeletion, findBlockingOwnership, requestDeletion, recoverExpiredDeletions, failDeletion, DeletionBlockedError } from "../lib/account/deletion";
import { requireAuthenticatedUser } from "../lib/auth/context";
import {
  OWNER_A, OWNER_B, EDITOR_A, addMember, apiRequest, asUser, getDb, installHarness, provisionTenant, responseBody, teardownHarness,
} from "./helpers/tenant-harness";

const DELETE_ME = "delete-me@local.invalid";

describe("account deletion (A3.3)", () => {
  let ownerA: { userId: string; workspaceId: string };
  let ownerB: { userId: string; workspaceId: string };

  before(async () => {
    installHarness();
    ownerA = await provisionTenant(OWNER_A);
    ownerB = await provisionTenant(OWNER_B);
    // DELETE_ME is an ordinary member of A's workspace (not a controlling owner).
    await addMember(ownerA.workspaceId, DELETE_ME, "editor");
  });
  after(() => teardownHarness());

  it("rejects unauthenticated deletion requests with 401", async () => {
    delete process.env.ALPHALENS_FIXTURE_MODE;
    try {
      const response = await requestDelete(apiRequest("/api/v1/account/delete", { method: "POST", body: { confirmation: "DELETE" } }));
      assert.equal(response.status, 401);
      assert.equal(((await responseBody(response))?.error as Record<string, unknown>)?.code, "UNAUTHENTICATED");
    } finally {
      process.env.ALPHALENS_FIXTURE_MODE = "true";
    }
  });

  it("requires explicit confirmation text", async () => {
    asUser(DELETE_ME);
    const response = await requestDelete(apiRequest("/api/v1/account/delete", { method: "POST", body: { confirmation: "delete" } }));
    assert.equal(response.status, 409);
    assert.equal(((await responseBody(response))?.error as Record<string, unknown>)?.code, "CONFIRMATION_REQUIRED");
  });

  it("never deletes another user via a body-supplied userId", async () => {
    asUser(DELETE_ME);
    const target = await requireAuthenticatedUser(apiRequest("/api/v1/workbench"));
    const response = await requestDelete(apiRequest("/api/v1/account/delete", { method: "POST", body: { confirmation: "DELETE", userId: ownerB.userId } }));
    assert.equal(response.status, 202);
    const row = await getDb().prepare("SELECT user_id AS userId FROM deletion_requests WHERE id=?").bind(((await responseBody(response))?.data as Record<string, unknown>).id as string).first<{ userId: string }>();
    assert.equal(row?.userId, target.userId, "request must be bound to the authenticated user");
    assert.equal(row?.userId === ownerB.userId, false);
    await cancelDeletion(target.userId);
  });

  it("blocks a controlling owner from deleting", async () => {
    const blocking = await findBlockingOwnership(ownerA.userId);
    assert.ok(blocking);
    await assert.rejects(
      () => requestDeletion(ownerA.userId, { confirmation: "DELETE" }),
      (error: unknown) => error instanceof DeletionBlockedError && error.code === "CONTROLLING_OWNER_MUST_TRANSFER",
    );
  });

  it("allows a non-controlling member to request deletion", async () => {
    asUser(DELETE_ME);
    const user = await requireAuthenticatedUser(apiRequest("/api/v1/workbench"));
    assert.equal(await findBlockingOwnership(user.userId), null);
    const result = await requestDeletion(user.userId, { confirmation: "DELETE" });
    assert.equal(result.status, "requested");
    await cancelDeletion(user.userId);
  });

  it("supports cancellation of a pending deletion request", async () => {
    asUser(DELETE_ME);
    const user = await requireAuthenticatedUser(apiRequest("/api/v1/workbench"));
    const result = await requestDeletion(user.userId, { confirmation: "DELETE" });
    const cancelled = await cancelDeletion(user.userId);
    assert.equal(cancelled?.status, "cancelled");
    const row = await getDb().prepare("SELECT status FROM deletion_requests WHERE id=?").bind(result.id).first<{ status: string }>();
    assert.equal(row?.status, "cancelled");
  });

  it("executes deletion idempotently and leaves the shared workspace intact", async () => {
    asUser(DELETE_ME);
    const user = await requireAuthenticatedUser(apiRequest("/api/v1/workbench"));
    const result = await requestDeletion(user.userId, { confirmation: "DELETE" });
    await getDb().prepare("UPDATE deletion_requests SET scheduled_for=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), result.id).run();
    const claim = await claimNextDeletion("worker-1");
    assert.equal(claim?.userId, user.userId);
    await executeDeletion(claim!.userId);
    await completeDeletion(claim!.id, claim!.leaseToken);

    const deleted = await getDb().prepare("SELECT deleted_at AS deletedAt,display_name AS displayName FROM users WHERE id=?").bind(user.userId).first<{ deletedAt: string | null; displayName: string | null }>();
    assert.ok(deleted?.deletedAt, "user must be tombstoned");
    assert.equal(deleted?.displayName, null);

    // Membership is gone but the workspace and other members are untouched.
    const membership = await getDb().prepare("SELECT COUNT(*) AS c FROM workspace_members WHERE user_id=?").bind(user.userId).first<{ c: number }>();
    assert.equal(membership?.c, 0);
    const workspace = await getDb().prepare("SELECT COUNT(*) AS c FROM workspaces WHERE id=?").bind(ownerA.workspaceId).first<{ c: number }>();
    assert.equal(workspace?.c, 1);
    const ownerStillMember = await getDb().prepare("SELECT COUNT(*) AS c FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(ownerA.workspaceId, ownerA.userId).first<{ c: number }>();
    assert.equal(ownerStillMember?.c, 1);

    // Idempotent: re-running the delete is a safe no-op.
    await executeDeletion(user.userId);
    const again = await getDb().prepare("SELECT deleted_at AS deletedAt FROM users WHERE id=?").bind(user.userId).first<{ deletedAt: string | null }>();
    assert.ok(again?.deletedAt);
  });

  it("blocks a deleted user from re-authenticating", async () => {
    asUser("delete-verify@local.invalid");
    const user = await requireAuthenticatedUser(apiRequest("/api/v1/workbench"));
    await executeDeletion(user.userId);
    asUser("delete-verify@local.invalid");
    await assert.rejects(
      () => requireAuthenticatedUser(apiRequest("/api/v1/workbench")),
      (error: unknown) => (error as { status: number; code: string }).status === 401 && (error as { code: string }).code === "ACCOUNT_DELETED",
    );
  });

  it("answers cleanly when cancelling with no pending request", async () => {
    asUser(EDITOR_A);
    const response = await cancelDelete(apiRequest("/api/v1/account/delete/cancel", { method: "POST" }));
    assert.equal(response.status, 404);
  });

  it("allows a sole owner to delete their personal workspace and account", async () => {
    // A fresh user whose default workspace has no other members is not blocked.
    asUser("solo@local.invalid");
    const user = await requireAuthenticatedUser(apiRequest("/api/v1/workbench"));
    assert.equal(await findBlockingOwnership(user.userId), null);
    const result = await requestDeletion(user.userId, { confirmation: "DELETE" });
    assert.equal(result.status, "requested");
    await getDb().prepare("UPDATE deletion_requests SET scheduled_for=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), result.id).run();
    const claim = await claimNextDeletion("worker-1");
    assert.equal(claim?.userId, user.userId);
    await executeDeletion(claim!.userId);
    await completeDeletion(claim!.id, claim!.leaseToken);
    const deleted = await getDb().prepare("SELECT deleted_at AS deletedAt FROM users WHERE id=?").bind(user.userId).first<{ deletedAt: string | null }>();
    assert.ok(deleted?.deletedAt);
  });

  it("recovers a processing deletion whose lease expired after a crash", async () => {
    asUser("crash@local.invalid");
    const user = await requireAuthenticatedUser(apiRequest("/api/v1/workbench"));
    const result = await requestDeletion(user.userId, { confirmation: "DELETE" });
    await getDb().prepare("UPDATE deletion_requests SET scheduled_for=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), result.id).run();
    const claim = await claimNextDeletion("worker-1");
    assert.equal(claim?.userId, user.userId);
    // Simulate a crash: the claim is in processing with an expired lease.
    await getDb().prepare("UPDATE deletion_requests SET lease_expires_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), result.id).run();
    await recoverExpiredDeletions();
    const row = await getDb().prepare("SELECT status,lease_owner AS leaseOwner FROM deletion_requests WHERE id=?").bind(result.id).first<{ status: string; leaseOwner: string | null }>();
    assert.equal(row?.status, "requested");
    assert.equal(row?.leaseOwner, null);
    // A second worker can now claim and complete it.
    const reclaim = await claimNextDeletion("worker-2");
    assert.equal(reclaim?.userId, user.userId);
    await executeDeletion(reclaim!.userId);
    await completeDeletion(reclaim!.id, reclaim!.leaseToken);
  });

  it("a duplicate deletion request while processing returns the same request, no 500", async () => {
    asUser("dup@local.invalid");
    const user = await requireAuthenticatedUser(apiRequest("/api/v1/workbench"));
    const result = await requestDeletion(user.userId, { confirmation: "DELETE" });
    await getDb().prepare("UPDATE deletion_requests SET scheduled_for=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), result.id).run();
    const claim = await claimNextDeletion("worker-1");
    assert.ok(claim);
    // While processing, a repeat request returns the same id, not a 500 or a second row.
    const again = await requestDeletion(user.userId, { confirmation: "DELETE" });
    assert.equal(again.id, result.id);
    const count = await getDb().prepare("SELECT COUNT(*) AS c FROM deletion_requests WHERE user_id=? AND status IN ('requested','processing')").bind(user.userId).first<{ c: number }>();
    assert.equal(count?.c, 1);
    await completeDeletion(claim!.id, claim!.leaseToken);
  });

  it("a stale deletion worker cannot overwrite a newer worker's completion", async () => {
    asUser("stale-del@local.invalid");
    const user = await requireAuthenticatedUser(apiRequest("/api/v1/workbench"));
    const result = await requestDeletion(user.userId, { confirmation: "DELETE" });
    await getDb().prepare("UPDATE deletion_requests SET scheduled_for=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), result.id).run();
    const a = await claimNextDeletion("worker-a");
    assert.ok(a);
    // A's lease expires; B reclaims and completes.
    await getDb().prepare("UPDATE deletion_requests SET lease_expires_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), result.id).run();
    await recoverExpiredDeletions();
    const b = await claimNextDeletion("worker-b");
    assert.ok(b);
    await executeDeletion(b!.userId);
    await completeDeletion(b!.id, b!.leaseToken);
    // A's stale completion/failure must not change the completed state.
    await completeDeletion(a!.id, a!.leaseToken);
    await failDeletion(a!.id, a!.leaseToken, new Error("late"), true);
    const row = await getDb().prepare("SELECT status FROM deletion_requests WHERE id=?").bind(result.id).first<{ status: string }>();
    assert.equal(row?.status, "completed");
  });
});
