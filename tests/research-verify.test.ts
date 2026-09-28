import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { POST as createDraft } from "../app/api/v1/research/[jobId]/draft/route";
import { POST as reverify } from "../app/api/v1/research/[jobId]/draft/verify/route";
import { PATCH as updateIssue } from "../app/api/v1/research/[jobId]/draft/issues/[issueId]/route";
import { buildResearchDraft, draftEvidenceIds, type DraftIssue, type ResearchDraftContent } from "../lib/research/draft.ts";
import { FIXTURE_SEC_ARCHIVE_ORIGIN, fixtureCompanyFacts } from "../lib/research/fixture-provider.ts";
import { normalizeCompanyFacts, secFactNaturalKey } from "../lib/research/normalize.ts";
import { enqueueResearch } from "../lib/research/queue";
import { claimNextJob, executeJob } from "../lib/research/runner";
import type { ResearchSnapshot } from "../lib/research/snapshot.ts";
import { verifyDraft, type CitedEvidence } from "../lib/research/verify.ts";
import {
  EDITOR_A, OWNER_A, OWNER_B, VIEWER_A, addMember, apiRequest, asUser, getDb, installHarness, provisionTenant, responseBody, teardownHarness,
} from "./helpers/tenant-harness";

const AS_OF = "2026-09-19T12:00:00.000Z";

/** A consistent draft built the same way the runner builds one, plus the evidence it cites. */
function cleanDraft() {
  const envelope = fixtureCompanyFacts("SYN", AS_OF);
  const secFacts = normalizeCompanyFacts(envelope.data, { asOf: AS_OF, sourceUrl: envelope.sourceUrl, archiveOrigin: FIXTURE_SEC_ARCHIVE_ORIGIN });
  const snapshot: ResearchSnapshot = {
    schemaVersion: 1, sourceMode: "fixture", ticker: "SYN", question: "q", asOf: AS_OF, generatedAt: AS_OF, providerPlan: [], warnings: [], secFacts,
    sources: [{ provider: "sec-edgar", asOf: AS_OF, fetchedAt: AS_OF, staleAt: AS_OF, freshness: "fresh", cache: "miss", sourceUrl: envelope.sourceUrl, licenseScope: "", data: {} }],
    evidenceRefs: [
      ...secFacts.facts.map((fact) => ({ evidenceId: `evd_${fact.key}_${fact.periodicity}`, naturalKey: secFactNaturalKey(fact), kind: "FACT" as const, provider: "sec-edgar" as const, sourceUrl: envelope.sourceUrl })),
      { evidenceId: "evd_consensus", naturalKey: "consensus-estimates", kind: "EXPECTATION", provider: "alpha-vantage-consensus", sourceUrl: "https://fixtures.alphalens.invalid/consensus/SYN" },
    ],
  };
  const content = buildResearchDraft({ id: "job_1", status: "succeeded", ticker: "SYN", securityId: "sec_1", question: "q", asOf: AS_OF, snapshot });
  const evidence = new Map<string, CitedEvidence>(secFacts.facts.map((fact) => [`evd_${fact.key}_${fact.periodicity}`, { id: `evd_${fact.key}_${fact.periodicity}`, securityId: "sec_1", kind: "FACT", value: fact }]));
  evidence.set("evd_consensus", { id: "evd_consensus", securityId: "sec_1", kind: "EXPECTATION", value: {} });
  return { content, evidence };
}

const codes = (content: ResearchDraftContent, evidence: Map<string, CitedEvidence>, severity?: string) =>
  verifyDraft(content, evidence).filter((item) => !severity || item.severity === severity).map((item) => item.checkCode).sort();

describe("draft verification checks", () => {
  it("passes a consistent draft with only the no-thesis note", () => {
    const { content, evidence } = cleanDraft();
    assert.deepEqual(codes(content, evidence), ["thesis_not_authored"]);
    assert.equal(verifyDraft(content, evidence)[0]?.severity, "info");
  });

  it("blocks citations that are missing, foreign to the security, or the wrong kind", () => {
    const { content, evidence } = cleanDraft();
    evidence.delete("evd_revenue_annual");
    evidence.set("evd_net_income_annual", { ...evidence.get("evd_net_income_annual")!, securityId: "sec_other" });
    evidence.set("evd_consensus", { ...evidence.get("evd_consensus")!, kind: "FACT" });
    assert.deepEqual(codes(content, evidence, "blocking"), ["evidence_kind_mismatch", "evidence_not_found", "evidence_security_mismatch"]);
  });

  it("ties every number, unit, period and citation out to its evidence row", () => {
    const { content, evidence } = cleanDraft();
    const stored = evidence.get("evd_revenue_annual")!;
    evidence.set("evd_revenue_annual", { ...stored, value: { ...(stored.value as object), value: 1 } });
    const found = verifyDraft(content, evidence).filter((item) => item.checkCode === "value_tieout_failed");
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /value 1/);
    assert.deepEqual(found[0]!.subject, { section: "facts", key: "revenue", periodicity: "annual", evidenceId: "evd_revenue_annual" });
  });

  it("blocks wrong units, incomplete citations and anything at or past the filing cutoff", () => {
    const { content, evidence } = cleanDraft();
    const [first, second, third, ...rest] = content.facts;
    const tampered: ResearchDraftContent = { ...content, facts: [
      { ...first!, unit: "EUR" },
      { ...second!, citation: { ...second!.citation, accession: "" } },
      { ...third!, periodEnd: "2026-10-01", citation: { ...third!.citation, filed: content.time.filingCutoff } },
      ...rest,
    ] };
    const blocking = codes(tampered, evidence, "blocking");
    for (const code of ["unit_mismatch", "citation_incomplete", "filed_after_cutoff", "period_after_cutoff"]) assert.ok(blocking.includes(code), code);
    assert.deepEqual(codes({ ...content, facts: [] }, evidence, "blocking"), ["no_facts"]);
  });

  it("warns when EPS does not tie out to net income over shares outstanding", () => {
    const { content, evidence } = cleanDraft();
    const facts = content.facts.map((fact) => fact.key === "shares_outstanding" ? { ...fact, value: 2_000_000_000 } : fact);
    const found = verifyDraft({ ...content, facts }, evidence).find((item) => item.checkCode === "cross_check_divergence");
    assert.equal(found?.severity, "warning");
    assert.match(found?.message ?? "", /differs by 50%/);
  });

  it("turns draft unknowns into warnings and failed normalization into a blocker", () => {
    const { content, evidence } = cleanDraft();
    const withUnknowns: ResearchDraftContent = { ...content, unknowns: [
      { code: "provider_failure", message: "consensus provider timed out" },
      { code: "stale_source", message: "market data is stale" },
      { code: "normalization_failed", message: "no facts object" },
    ] };
    assert.deepEqual(codes(withUnknowns, evidence, "warning"), ["provider_failure", "stale_source"]);
    assert.deepEqual(codes(withUnknowns, evidence, "blocking"), ["normalization_failed"]);
  });

  it("gives every finding a stable, unique fingerprint", () => {
    const { content, evidence } = cleanDraft();
    evidence.clear();
    const first = verifyDraft(content, evidence);
    assert.deepEqual(verifyDraft(content, evidence), first);
    assert.equal(new Set(first.map((item) => item.fingerprint)).size, first.length);
    assert.equal(first.filter((item) => item.checkCode === "evidence_not_found").length, draftEvidenceIds(content).length);
  });
});

describe("verification issue lifecycle (API)", () => {
  let tenantA: { userId: string; workspaceId: string };
  let cleanJob: string;
  let warnedJob: string;
  const tenantHeader = () => ({ "x-alphalens-workspace": tenantA.workspaceId });
  const post = (handler: typeof createDraft, jobId: string, path = "") => handler(apiRequest(`/api/v1/research/${jobId}/draft${path}`, { method: "POST", headers: tenantHeader() }), { params: Promise.resolve({ jobId }) });
  const acknowledge = (jobId: string, issueId: string, note: unknown = "Reviewed; consensus is not needed for this question.") =>
    updateIssue(apiRequest(`/api/v1/research/${jobId}/draft/issues/${issueId}`, { method: "PATCH", headers: tenantHeader(), body: { status: "acknowledged", note } }), { params: Promise.resolve({ jobId, issueId }) });
  const dataOf = async (response: Response) => (await responseBody(response))?.data as { versionId: string; issues: DraftIssue[]; issueSummary: { blockingOpen: number; warningsOpen: number; acknowledged: number } };
  const errorOf = async (response: Response) => ((await responseBody(response))?.error as { code: string }).code;

  before(async () => {
    installHarness();
    tenantA = await provisionTenant(OWNER_A);
    await provisionTenant(OWNER_B);
    await addMember(tenantA.workspaceId, EDITOR_A, "editor");
    await addMember(tenantA.workspaceId, VIEWER_A, "viewer");
    asUser(OWNER_A);
    const context = { userId: tenantA.userId, email: OWNER_A, workspaceId: tenantA.workspaceId, role: "owner" as const };
    const run = async (ticker: string) => {
      await enqueueResearch(context, { ticker, question: "Verify me", asOf: AS_OF, idempotencyKey: `verify-${ticker}` });
      const job = await claimNextJob("worker-verify");
      assert.ok(job);
      assert.equal((await executeJob(job)).status, "succeeded");
      return job.id;
    };
    cleanJob = await run("AAPL");
    warnedJob = await run("TSLA");
    // Simulate a provider that failed during collection.
    const row = await getDb().prepare("SELECT snapshot_json AS snapshotJson FROM research_jobs WHERE id=?").bind(warnedJob).first<{ snapshotJson: string }>();
    const snapshot = JSON.parse(row!.snapshotJson);
    snapshot.warnings = ["consensus provider timed out"];
    await getDb().prepare("UPDATE research_jobs SET snapshot_json=? WHERE id=?").bind(JSON.stringify(snapshot), warnedJob).run();
  });
  after(() => teardownHarness());

  it("records issues atomically with a new draft", async () => {
    asUser(EDITOR_A);
    const draft = await dataOf(await post(createDraft, cleanJob));
    assert.deepEqual(draft.issues.map((issue) => [issue.checkCode, issue.severity, issue.status]), [["thesis_not_authored", "info", "open"]]);
    assert.deepEqual(draft.issueSummary, { blockingOpen: 0, warningsOpen: 0, acknowledged: 0 });
    const version = await getDb().prepare("SELECT verified_at AS verifiedAt,verifier_version AS verifierVersion FROM research_artifact_versions WHERE id=?").bind(draft.versionId).first<{ verifiedAt: string; verifierVersion: string }>();
    assert.ok(version?.verifiedAt);
    assert.equal(version?.verifierVersion, "draft-checks-v1");
  });

  it("opens a blocker when evidence no longer ties out, refuses to acknowledge it, and closes it on a passing re-check", async () => {
    asUser(EDITOR_A);
    const evidence = await getDb().prepare("SELECT e.id,e.value_json AS valueJson FROM evidence e JOIN research_jobs j ON j.security_id=e.security_id WHERE j.id=? AND e.claim LIKE '%Revenue (annual%'").bind(cleanJob).first<{ id: string; valueJson: string }>();
    const original = evidence!.valueJson;
    await getDb().prepare("UPDATE evidence SET value_json=? WHERE id=?").bind(JSON.stringify({ ...JSON.parse(original), value: 1 }), evidence!.id).run();

    const broken = await dataOf(await post(reverify, cleanJob, "/verify"));
    const blocker = broken.issues.find((issue) => issue.checkCode === "value_tieout_failed");
    assert.equal(blocker?.status, "open");
    assert.equal(broken.issueSummary.blockingOpen, 1);

    const refused = await acknowledge(cleanJob, blocker!.id);
    assert.equal(refused.status, 409);
    assert.equal(await errorOf(refused), "BLOCKING_NOT_ACKNOWLEDGEABLE");

    await getDb().prepare("UPDATE evidence SET value_json=? WHERE id=?").bind(original, evidence!.id).run();
    const fixed = await dataOf(await post(reverify, cleanJob, "/verify"));
    const closed = fixed.issues.find((issue) => issue.id === blocker!.id);
    assert.equal(closed?.status, "resolved");
    assert.match(closed?.resolutionNote ?? "", /No longer detected/);
    assert.equal(fixed.issueSummary.blockingOpen, 0);
  });

  it("lets an editor, but not a viewer, acknowledge a warning once with a note", async () => {
    asUser(EDITOR_A);
    const draft = await dataOf(await post(createDraft, warnedJob));
    const warning = draft.issues.find((issue) => issue.checkCode === "provider_failure");
    assert.equal(warning?.severity, "warning");
    assert.equal(draft.issueSummary.warningsOpen, 1);

    asUser(VIEWER_A);
    assert.equal((await acknowledge(warnedJob, warning!.id)).status, 403);
    asUser(EDITOR_A);
    assert.equal((await acknowledge(warnedJob, warning!.id, "   ")).status, 400);
    const acknowledged = await dataOf(await acknowledge(warnedJob, warning!.id));
    assert.equal(acknowledged.issues.find((issue) => issue.id === warning!.id)?.status, "acknowledged");
    assert.deepEqual(acknowledged.issueSummary, { blockingOpen: 0, warningsOpen: 0, acknowledged: 1 });
    assert.equal(await errorOf(await acknowledge(warnedJob, warning!.id)), "ISSUE_NOT_OPEN");

    // A re-check that still finds the warning keeps the acknowledgement.
    const rechecked = await dataOf(await post(reverify, warnedJob, "/verify"));
    assert.equal(rechecked.issues.find((issue) => issue.id === warning!.id)?.status, "acknowledged");
  });

  it("freezes approved versions and hides drafts from other tenants", async () => {
    asUser(EDITOR_A);
    const draft = await dataOf(await post(createDraft, warnedJob));
    await getDb().prepare("UPDATE research_artifact_versions SET status='approved' WHERE id=?").bind(draft.versionId).run();
    assert.equal(await errorOf(await post(reverify, warnedJob, "/verify")), "VERSION_LOCKED");

    asUser(OWNER_B);
    const foreign = (handler: typeof createDraft, path: string) => handler(apiRequest(`/api/v1/research/${cleanJob}/draft${path}`, { method: "POST" }), { params: Promise.resolve({ jobId: cleanJob }) });
    assert.equal((await foreign(reverify, "/verify")).status, 404);
    const issueId = draft.issues[0]!.id;
    const patch = await updateIssue(apiRequest(`/api/v1/research/${cleanJob}/draft/issues/${issueId}`, { method: "PATCH", body: { status: "acknowledged", note: "x" } }), { params: Promise.resolve({ jobId: cleanJob, issueId }) });
    assert.equal(patch.status, 404);
  });

  it("rejects a verification issue written against another workspace's version at the database", async () => {
    const version = await getDb().prepare("SELECT id FROM research_artifact_versions WHERE workspace_id=? LIMIT 1").bind(tenantA.workspaceId).first<{ id: string }>();
    const foreignWorkspace = await getDb().prepare("SELECT id FROM workspaces WHERE id<>? LIMIT 1").bind(tenantA.workspaceId).first<{ id: string }>();
    const now = new Date().toISOString();
    await assert.rejects(
      getDb().prepare("INSERT INTO verification_issues (id,workspace_id,artifact_version_id,fingerprint,check_code,severity,status,message,verifier_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), foreignWorkspace!.id, version!.id, "x", "x", "info", "open", "x", "v", now, now).run(),
      /verification_issue_workspace_mismatch/,
    );
  });
});
