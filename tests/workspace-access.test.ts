import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { GET as listWorkspaces, POST as createWorkspace } from "../app/api/v1/workspaces/route";
import { GET as listMembers, POST as addMemberRoute } from "../app/api/v1/workspaces/[workspaceId]/members/route";
import { PATCH as updateMember, DELETE as removeMember } from "../app/api/v1/workspaces/[workspaceId]/members/[userId]/route";
import { GET as getWorkbench } from "../app/api/v1/workbench/route";
import {
  OWNER_A, OWNER_B, VIEWER_A, addMember, apiRequest, asUser, auditRows, getDb,
  installHarness, provisionTenant, responseBody, teardownHarness,
} from "./helpers/tenant-harness";

describe("workspace access control (A3.2)", () => {
  before(async () => {
    installHarness();
    await provisionTenant(OWNER_A);
    await provisionTenant(OWNER_B);
  });
  after(() => teardownHarness());

  it("rejects unauthenticated requests with a consistent 401", async () => {
    delete process.env.ALPHALENS_FIXTURE_MODE;
    try {
      asUser(OWNER_A);
      const response = await listWorkspaces(apiRequest("/api/v1/workspaces"));
      assert.equal(response.status, 401);
      const body = await responseBody(response);
      assert.equal((body?.error as Record<string, unknown>)?.code, "UNAUTHENTICATED");
    } finally {
      process.env.ALPHALENS_FIXTURE_MODE = "true";
    }
  });

  it("rejects fixture identity outside loopback hosts", async () => {
    asUser(OWNER_A);
    const response = await listWorkspaces(apiRequest("/api/v1/workspaces", { host: "alphalens.example.com" }));
    assert.equal(response.status, 401);
  });

  it("rejects fixture identities without a .invalid mailbox", async () => {
    process.env.ALPHALENS_LOCAL_AUTH_EMAIL = "attacker@gmail.com";
    try {
      const response = await listWorkspaces(apiRequest("/api/v1/workspaces"));
      assert.equal(response.status, 401);
    } finally {
      asUser(OWNER_A);
    }
  });

  it("lists only the workspaces the authenticated user belongs to", async () => {
    asUser(OWNER_A);
    const response = await listWorkspaces(apiRequest("/api/v1/workspaces"));
    assert.equal(response.status, 200);
    const body = await responseBody(response);
    const workspaces = (body?.data as Record<string, unknown>)?.workspaces as Array<Record<string, unknown>>;
    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0].role, "owner");
    assert.equal(workspaces[0].isDefault, true);
    assert.equal(workspaces[0].isControllingOwner, true);
  });

  it("creates a workspace with the creator as owner and writes an audit row", async () => {
    asUser(OWNER_A);
    const response = await createWorkspace(apiRequest("/api/v1/workspaces", { method: "POST", body: { name: "Macro Sleeve" } }));
    assert.equal(response.status, 201);
    const body = await responseBody(response);
    const created = body?.data as Record<string, unknown>;
    assert.equal(created.role, "owner");
    assert.match(String(created.workspaceId), /^wsp_/);

    asUser(OWNER_A);
    const list = await listWorkspaces(apiRequest("/api/v1/workspaces"));
    const workspaces = ((await responseBody(list))?.data as Record<string, unknown>)?.workspaces as Array<Record<string, unknown>>;
    assert.equal(workspaces.length, 2);

    const audits = await auditRows("workspace.create");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].resource_id, created.workspaceId);
  });

  it("rejects workspace creation without a name", async () => {
    asUser(OWNER_A);
    const response = await createWorkspace(apiRequest("/api/v1/workspaces", { method: "POST", body: {} }));
    assert.equal(response.status, 400);
  });
});

describe("workspace member administration (A3.2)", () => {
  let ownerA: { userId: string; workspaceId: string };
  let ownerB: { userId: string; workspaceId: string };
  let viewerAId: string;

  before(async () => {
    installHarness();
    const a = await provisionTenant(OWNER_A);
    const b = await provisionTenant(OWNER_B);
    ownerA = { userId: a.userId, workspaceId: a.workspaceId };
    ownerB = { userId: b.userId, workspaceId: b.workspaceId };
    viewerAId = await addMember(ownerA.workspaceId, VIEWER_A, "viewer");
  });
  after(() => teardownHarness());

  const params = (workspaceId: string) => ({ params: Promise.resolve({ workspaceId }) });
  const memberParams = (workspaceId: string, userId: string) => ({ params: Promise.resolve({ workspaceId, userId }) });

  it("lets the owner read the member list without exposing sensitive fields", async () => {
    asUser(OWNER_A);
    const response = await listMembers(apiRequest(`/api/v1/workspaces/${ownerA.workspaceId}/members`), params(ownerA.workspaceId));
    assert.equal(response.status, 200);
    const members = ((await responseBody(response))?.data as Record<string, unknown>)?.members as Array<Record<string, unknown>>;
    assert.equal(members.length, 2);
    assert.deepEqual(Object.keys(members[0]).sort(), ["displayName", "isControllingOwner", "joinedAt", "role", "userId"]);
    assert.equal(members.find((m) => m.userId === ownerA.userId)?.isControllingOwner, 1);
  });

  it("returns 404 (not 403) when a non-member reads the member list", async () => {
    asUser(OWNER_B);
    const response = await listMembers(apiRequest(`/api/v1/workspaces/${ownerA.workspaceId}/members`), params(ownerA.workspaceId));
    assert.equal(response.status, 404);
    const body = await responseBody(response);
    assert.equal((body?.error as Record<string, unknown>)?.code, "WORKSPACE_NOT_FOUND");
  });

  it("rejects member management from non-owner roles with a consistent 403", async () => {
    asUser(VIEWER_A);
    const response = await addMemberRoute(apiRequest(`/api/v1/workspaces/${ownerA.workspaceId}/members`, { method: "POST", body: { userId: ownerB.userId, role: "viewer" } }), params(ownerA.workspaceId));
    assert.equal(response.status, 403);
    const body = await responseBody(response);
    assert.equal((body?.error as Record<string, unknown>)?.code, "FORBIDDEN");
  });

  it("adds an existing user as a member and rejects duplicates", async () => {
    asUser(OWNER_A);
    const editorEmail = "editor-a@local.invalid";
    const { requireAuthenticatedUser } = await import("../lib/auth/context");
    asUser(editorEmail);
    const editor = await requireAuthenticatedUser(apiRequest("/api/v1/workbench"));

    asUser(OWNER_A);
    const created = await addMemberRoute(apiRequest(`/api/v1/workspaces/${ownerA.workspaceId}/members`, { method: "POST", body: { userId: editor.userId, role: "editor" } }), params(ownerA.workspaceId));
    assert.equal(created.status, 201);

    const duplicate = await addMemberRoute(apiRequest(`/api/v1/workspaces/${ownerA.workspaceId}/members`, { method: "POST", body: { userId: editor.userId, role: "viewer" } }), params(ownerA.workspaceId));
    assert.equal(duplicate.status, 409);

    const audits = await auditRows("workspace.member.add");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].resource_id, `${ownerA.workspaceId}:${editor.userId}`);
  });

  it("refuses to add accounts that do not exist", async () => {
    asUser(OWNER_A);
    const response = await addMemberRoute(apiRequest(`/api/v1/workspaces/${ownerA.workspaceId}/members`, { method: "POST", body: { userId: "usr_does_not_exist", role: "viewer" } }), params(ownerA.workspaceId));
    assert.equal(response.status, 404);
    const body = await responseBody(response);
    assert.equal((body?.error as Record<string, unknown>)?.code, "USER_NOT_FOUND");
  });

  it("updates a member role but protects the controlling owner from demotion", async () => {
    asUser(OWNER_A);
    const promoted = await updateMember(apiRequest(`/api/v1/workspaces/${ownerA.workspaceId}/members/${viewerAId}`, { method: "PATCH", body: { role: "editor" } }), memberParams(ownerA.workspaceId, viewerAId));
    assert.equal(promoted.status, 200);

    const demoteOwner = await updateMember(apiRequest(`/api/v1/workspaces/${ownerA.workspaceId}/members/${ownerA.userId}`, { method: "PATCH", body: { role: "viewer" } }), memberParams(ownerA.workspaceId, ownerA.userId));
    assert.equal(demoteOwner.status, 409);
    const body = await responseBody(demoteOwner);
    assert.equal((body?.error as Record<string, unknown>)?.code, "CONTROLLING_OWNER_PROTECTED");
  });

  it("removes a member but never the controlling owner", async () => {
    asUser(OWNER_A);
    const blocked = await removeMember(apiRequest(`/api/v1/workspaces/${ownerA.workspaceId}/members/${ownerA.userId}`, { method: "DELETE" }), memberParams(ownerA.workspaceId, ownerA.userId));
    assert.equal(blocked.status, 409);

    const removed = await removeMember(apiRequest(`/api/v1/workspaces/${ownerA.workspaceId}/members/${viewerAId}`, { method: "DELETE" }), memberParams(ownerA.workspaceId, viewerAId));
    assert.equal(removed.status, 200);

    asUser(VIEWER_A);
    const after = await listMembers(apiRequest(`/api/v1/workspaces/${ownerA.workspaceId}/members`), params(ownerA.workspaceId));
    assert.equal(after.status, 404);
  });

  it("records member administration in the audit log", async () => {
    const added = await auditRows("workspace.member.update");
    assert.ok(added.length >= 1);
    const removed = await auditRows("workspace.member.remove");
    assert.equal(removed.length, 1);
  });
});

describe("workspace selection header (A3.2)", () => {
  let ownerA: { workspaceId: string };
  let ownerB: { workspaceId: string };

  before(async () => {
    installHarness();
    ownerA = await provisionTenant(OWNER_A);
    ownerB = await provisionTenant(OWNER_B);
  });
  after(() => teardownHarness());

  it("honours x-alphalens-workspace only for workspaces the user belongs to", async () => {
    asUser(OWNER_A);
    const own = await getWorkbench(apiRequest("/api/v1/workbench", { headers: { "x-alphalens-workspace": ownerA.workspaceId } }));
    assert.equal(own.status, 200);
  });

  it("answers 404 when the header names a foreign workspace, without leaking existence", async () => {
    asUser(OWNER_A);
    const foreign = await getWorkbench(apiRequest("/api/v1/workbench", { headers: { "x-alphalens-workspace": ownerB.workspaceId } }));
    assert.equal(foreign.status, 404);
    const body = await responseBody(foreign);
    assert.equal((body?.error as Record<string, unknown>)?.code, "WORKSPACE_NOT_FOUND");

    const missing = await getWorkbench(apiRequest("/api/v1/workbench", { headers: { "x-alphalens-workspace": "wsp_does_not_exist" } }));
    assert.equal(missing.status, 404);
    assert.equal(((await responseBody(missing))?.error as Record<string, unknown>)?.code, (body?.error as Record<string, unknown>)?.code);
  });

  it("writes a sanitized audit row for denied access, free of credentials", async () => {
    asUser(OWNER_A);
    await getWorkbench(apiRequest("/api/v1/workbench", {
      headers: {
        "x-alphalens-workspace": ownerB.workspaceId,
        authorization: "Bearer alp_should_never_be_stored",
        cookie: "session=should_never_be_stored",
      },
    }));
    const denied = await auditRows("access.denied");
    assert.ok(denied.length >= 1);
    const latest = denied[denied.length - 1];
    assert.equal(latest.resource_type, "workspace");
    assert.equal(latest.resource_id, ownerB.workspaceId);
    const serialized = JSON.stringify(latest);
    assert.ok(!serialized.includes("alp_should_never_be_stored"), "audit must not store bearer tokens");
    assert.ok(!serialized.includes("should_never_be_stored"), "audit must not store cookies");
    assert.ok(!serialized.includes("authorization"), "audit must not mention credential headers");
  });

  it("never trusts client-supplied identity fields", async () => {
    asUser(OWNER_A);
    // Forged body/header fields must be ignored: the request still runs as A in A's workspace.
    const response = await getWorkbench(apiRequest("/api/v1/workbench", {
      headers: {
        "x-alphalens-workspace": ownerA.workspaceId,
        "x-user-id": "usr_forged",
        "x-role": "owner",
      },
    }));
    assert.equal(response.status, 200);
    const jobs = await getDb().prepare("SELECT COUNT(*) AS count FROM research_jobs WHERE workspace_id=?").bind(ownerB.workspaceId).first<{ count: number }>();
    assert.equal(jobs?.count, 0);
  });
});
