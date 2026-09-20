import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { POST as transferOwnership } from "../app/api/v1/workspaces/[workspaceId]/ownership-transfer/route";
import { PATCH as updateMember, DELETE as removeMember } from "../app/api/v1/workspaces/[workspaceId]/members/[userId]/route";
import {
  OWNER_A, OWNER_B, EDITOR_A, addMember, apiRequest, asUser, auditRows, getDb,
  installHarness, provisionTenant, responseBody, teardownHarness,
} from "./helpers/tenant-harness";

describe("workspace ownership transfer (A3.2)", () => {
  let ownerA: { userId: string; workspaceId: string };
  let ownerB: { userId: string; workspaceId: string };
  let editorAId: string;

  before(async () => {
    installHarness();
    const a = await provisionTenant(OWNER_A);
    const b = await provisionTenant(OWNER_B);
    ownerA = { userId: a.userId, workspaceId: a.workspaceId };
    ownerB = { userId: b.userId, workspaceId: b.workspaceId };
    editorAId = await addMember(ownerA.workspaceId, EDITOR_A, "editor");
  });
  after(() => teardownHarness());

  const params = (workspaceId: string) => ({ params: Promise.resolve({ workspaceId }) });
  const memberParams = (workspaceId: string, userId: string) => ({ params: Promise.resolve({ workspaceId, userId }) });
  const transfer = (workspaceId: string, body: Record<string, unknown>) =>
    transferOwnership(apiRequest(`/api/v1/workspaces/${workspaceId}/ownership-transfer`, { method: "POST", body }), params(workspaceId));

  it("rejects ownership transfer from a non-owner", async () => {
    asUser(EDITOR_A);
    const response = await transfer(ownerA.workspaceId, { userId: editorAId });
    assert.equal(response.status, 403);
    assert.equal(((await responseBody(response))?.error as Record<string, unknown>)?.code, "FORBIDDEN");
  });

  it("rejects transfer to a user that does not exist", async () => {
    asUser(OWNER_A);
    const response = await transfer(ownerA.workspaceId, { userId: "usr_does_not_exist" });
    assert.equal(response.status, 409);
    assert.equal(((await responseBody(response))?.error as Record<string, unknown>)?.code, "TARGET_NOT_MEMBER");
  });

  it("rejects transfer to a non-member (a user in another workspace)", async () => {
    asUser(OWNER_A);
    // ownerB is a real user but not a member of workspace A.
    const response = await transfer(ownerA.workspaceId, { userId: ownerB.userId });
    assert.equal(response.status, 409);
    assert.equal(((await responseBody(response))?.error as Record<string, unknown>)?.code, "TARGET_NOT_MEMBER");
  });

  it("rejects transferring to the current controlling owner", async () => {
    asUser(OWNER_A);
    const response = await transfer(ownerA.workspaceId, { userId: ownerA.userId });
    assert.equal(response.status, 409);
    assert.equal(((await responseBody(response))?.error as Record<string, unknown>)?.code, "ALREADY_CONTROLLING_OWNER");
  });

  it("transfers ownership to an existing member atomically", async () => {
    asUser(OWNER_A);
    const response = await transfer(ownerA.workspaceId, { userId: editorAId });
    assert.equal(response.status, 200);
    const data = (await responseBody(response))?.data as Record<string, unknown>;
    assert.equal(data.previousOwnerUserId, ownerA.userId);
    assert.equal(data.newOwnerUserId, editorAId);

    const workspace = await getDb().prepare("SELECT owner_user_id AS ownerUserId FROM workspaces WHERE id=?").bind(ownerA.workspaceId).first<{ ownerUserId: string }>();
    assert.equal(workspace?.ownerUserId, editorAId);

    const targetRole = await getDb().prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(ownerA.workspaceId, editorAId).first<{ role: string }>();
    assert.equal(targetRole?.role, "owner");
  });

  it("keeps the previous controlling owner as an ordinary owner member", async () => {
    const oldOwnerRole = await getDb().prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(ownerA.workspaceId, ownerA.userId).first<{ role: string }>();
    assert.equal(oldOwnerRole?.role, "owner");
  });

  it("protects the new controlling owner from demotion and removal", async () => {
    asUser(EDITOR_A); // now the controlling owner
    const demote = await updateMember(apiRequest(`/api/v1/workspaces/${ownerA.workspaceId}/members/${editorAId}`, { method: "PATCH", body: { role: "viewer" } }), memberParams(ownerA.workspaceId, editorAId));
    assert.equal(demote.status, 409);
    assert.equal(((await responseBody(demote))?.error as Record<string, unknown>)?.code, "CONTROLLING_OWNER_PROTECTED");

    const remove = await removeMember(apiRequest(`/api/v1/workspaces/${ownerA.workspaceId}/members/${editorAId}`, { method: "DELETE" }), memberParams(ownerA.workspaceId, editorAId));
    assert.equal(remove.status, 409);
    assert.equal(((await responseBody(remove))?.error as Record<string, unknown>)?.code, "CONTROLLING_OWNER_PROTECTED");
  });

  it("writes a sanitized audit row for the transfer", async () => {
    const audits = await auditRows("workspace.ownership.transfer");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].resource_type, "workspace");
    assert.equal(audits[0].resource_id, ownerA.workspaceId);
    const metadata = JSON.parse(String(audits[0].metadata_json ?? "{}")) as Record<string, unknown>;
    assert.equal(metadata.previousOwnerUserId, ownerA.userId);
    assert.equal(metadata.newOwnerUserId, editorAId);
    const serialized = JSON.stringify(audits[0]);
    assert.ok(!serialized.includes("token"), "audit must not contain credentials");
    assert.ok(!serialized.includes("cookie"), "audit must not contain cookies");
  });
});
