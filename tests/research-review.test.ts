import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { POST as createDraft } from "../app/api/v1/research/[jobId]/draft/route";
import { POST as reverify } from "../app/api/v1/research/[jobId]/draft/verify/route";
import { POST as review } from "../app/api/v1/research/[jobId]/draft/review/route";
import { mutatePlatform } from "../lib/platform/service";
import type { ResearchDraftVersion } from "../lib/research/draft.ts";
import { enqueueResearch } from "../lib/research/queue";
import { claimNextJob, executeJob } from "../lib/research/runner";
import {
  EDITOR_A, OWNER_A, OWNER_B, VIEWER_A, addMember, apiRequest, asUser, getDb, installHarness, provisionTenant, responseBody, teardownHarness,
} from "./helpers/tenant-harness";

describe("evidence draft review and publish gate", () => {
  let tenantA: { userId: string; workspaceId: string };
  let cleanJob: string;
  let blockedJob: string;
  const headers = () => ({ "x-alphalens-workspace": tenantA.workspaceId });
  const post = (handler: typeof createDraft, jobId: string, path: string, body?: unknown) =>
    handler(apiRequest(`/api/v1/research/${jobId}/draft${path}`, { method: "POST", headers: headers(), body }), { params: Promise.resolve({ jobId }) });
  const act = (jobId: string, action: string) => post(review, jobId, "/review", { action });
  const draftOf = async (response: Response) => (await responseBody(response))?.data as ResearchDraftVersion;
  const errorOf = async (response: Response) => ((await responseBody(response))?.error as { code: string }).code;
  const ownerContext = () => ({ userId: tenantA.userId, email: OWNER_A, workspaceId: tenantA.workspaceId, role: "owner" as const });

  before(async () => {
    installHarness();
    tenantA = await provisionTenant(OWNER_A);
    await provisionTenant(OWNER_B);
    await addMember(tenantA.workspaceId, EDITOR_A, "editor");
    await addMember(tenantA.workspaceId, VIEWER_A, "viewer");
    asUser(OWNER_A);
    const run = async (ticker: string) => {
      await enqueueResearch(ownerContext(), { ticker, question: "Review me", asOf: "2026-09-19T12:00:00.000Z", idempotencyKey: `review-${ticker}` });
      const job = await claimNextJob("worker-review");
      assert.ok(job);
      assert.equal((await executeJob(job)).status, "succeeded");
      return job.id;
    };
    cleanJob = await run("AAPL");
    blockedJob = await run("NVDA");
    asUser(EDITOR_A);
    assert.equal((await post(createDraft, cleanJob, "")).status, 201);
    assert.equal((await post(createDraft, blockedJob, "")).status, 201);
  });
  after(() => teardownHarness());

  it("walks a clean draft through request, owner approval and publish", async () => {
    asUser(VIEWER_A);
    assert.equal((await act(cleanJob, "request")).status, 403);

    asUser(EDITOR_A);
    const requested = await draftOf(await act(cleanJob, "request"));
    assert.equal(requested.status, "in_review");
    assert.equal(requested.approval?.status, "pending");
    assert.equal(await errorOf(await act(cleanJob, "request")), "NOT_DRAFT", "a version already in review cannot be re-requested");
    assert.equal((await act(cleanJob, "approve")).status, 403, "approval requires an owner");

    asUser(OWNER_A);
    const approved = await draftOf(await act(cleanJob, "approve"));
    assert.equal(approved.status, "approved");
    assert.equal(approved.approval?.status, "approved");
    const published = await draftOf(await act(cleanJob, "publish"));
    assert.equal(published.status, "published");
  });

  it("refuses approval and publication while a blocking issue is open", async () => {
    const evidence = await getDb().prepare("SELECT e.id,e.value_json AS valueJson FROM evidence e JOIN research_jobs j ON j.security_id=e.security_id WHERE j.id=? AND e.claim LIKE '%Net income (annual%'").bind(blockedJob).first<{ id: string; valueJson: string }>();
    await getDb().prepare("UPDATE evidence SET value_json=? WHERE id=?").bind(JSON.stringify({ ...JSON.parse(evidence!.valueJson), value: 7 }), evidence!.id).run();
    asUser(EDITOR_A);
    const broken = await draftOf(await post(reverify, blockedJob, "/verify"));
    assert.equal(broken.issueSummary.blockingOpen, 1);

    // Review can be requested so a reviewer sees the problem, but not approved.
    assert.equal((await draftOf(await act(blockedJob, "request"))).status, "in_review");
    asUser(OWNER_A);
    assert.equal(await errorOf(await act(blockedJob, "approve")), "BLOCKING_ISSUES");

    // Even a version forced to approved cannot be published through the platform path.
    await getDb().prepare("UPDATE research_artifact_versions SET status='approved' WHERE id=?").bind(broken.versionId).run();
    await assert.rejects(mutatePlatform(ownerContext(), { action: "artifact.publish", artifactVersionId: broken.versionId }), /阻断性校验问题/);
    await getDb().prepare("UPDATE research_artifact_versions SET status='in_review' WHERE id=?").bind(broken.versionId).run();

    // Sending it back for changes returns it to draft; fixing the source and re-checking clears the gate.
    const returned = await draftOf(await act(blockedJob, "request_changes"));
    assert.equal(returned.status, "draft");
    await getDb().prepare("UPDATE evidence SET value_json=? WHERE id=?").bind(evidence!.valueJson, evidence!.id).run();
    asUser(EDITOR_A);
    assert.equal((await draftOf(await post(reverify, blockedJob, "/verify"))).issueSummary.blockingOpen, 0);
    await act(blockedJob, "request");
    asUser(OWNER_A);
    assert.equal((await draftOf(await act(blockedJob, "approve"))).status, "approved");
  });

  it("refuses to approve a research draft that was never verified", async () => {
    asUser(OWNER_A);
    const draft = await draftOf(await post(createDraft, blockedJob, ""));
    await getDb().prepare("UPDATE research_artifact_versions SET status='in_review',verified_at=NULL WHERE id=?").bind(draft.versionId).run();
    const approvalId = crypto.randomUUID(); const now = new Date().toISOString();
    await getDb().prepare("INSERT INTO approval_requests (id,workspace_id,artifact_version_id,requested_by_user_id,required_role,status,created_at,updated_at) VALUES (?,?,?,?,'owner','pending',?,?)").bind(approvalId, tenantA.workspaceId, draft.versionId, tenantA.userId, now, now).run();
    await assert.rejects(mutatePlatform(ownerContext(), { action: "approval.decide", id: approvalId, decision: "approved" }), /尚未完成自动校验/);
  });

  it("keeps generic artifact saves away from research drafts", async () => {
    const artifact = await getDb().prepare("SELECT logical_id AS logicalId FROM research_artifacts WHERE research_job_id=?").bind(cleanJob).first<{ logicalId: string }>();
    await assert.rejects(mutatePlatform(ownerContext(), { action: "artifact.save", logicalId: artifact!.logicalId, title: "overwrite", content: { markdown: "unverified" } }), /不能直接保存新版本/);
    await assert.rejects(mutatePlatform(ownerContext(), { action: "artifact.save", title: "forged", content: { kind: "evidence_draft" } }), /只能由研究任务生成/);
    const saved = await mutatePlatform(ownerContext(), { action: "artifact.save", title: "Ordinary memo", content: { markdown: "notes" } }) as { version: number };
    assert.equal(saved.version, 1, "ordinary platform artifacts are unaffected");
  });

  it("validates review actions and hides drafts from other tenants", async () => {
    asUser(OWNER_A);
    assert.equal((await act(cleanJob, "delete")).status, 400);
    assert.equal(await errorOf(await act(cleanJob, "approve")), "NO_PENDING_APPROVAL");
    asUser(OWNER_B);
    const foreign = await review(apiRequest(`/api/v1/research/${cleanJob}/draft/review`, { method: "POST", body: { action: "request" } }), { params: Promise.resolve({ jobId: cleanJob }) });
    assert.equal(foreign.status, 404);
  });
});
