import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { GET as getDraft, POST as createDraft } from "../app/api/v1/research/[jobId]/draft/route";
import { buildResearchDraft, draftEvidenceIds, DraftPreconditionError, type DraftableJob } from "../lib/research/draft.ts";
import { enqueueResearch } from "../lib/research/queue";
import { claimNextJob, executeJob } from "../lib/research/runner";
import type { ResearchSnapshot } from "../lib/research/snapshot.ts";
import {
  EDITOR_A, OWNER_A, OWNER_B, VIEWER_A, addMember, apiRequest, asUser, auditRows, getDb, installHarness, provisionTenant, responseBody, teardownHarness,
} from "./helpers/tenant-harness";

const citation = { provider: "sec-edgar" as const, sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json", filingUrl: null, cik: "0000000001", accession: "0000000001-26-000001", form: "10-K", filed: "2026-02-20", taxonomy: "us-gaap", concept: "Revenues", unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31", frame: null, filingFiscalYear: 2025, filingFiscalPeriod: "FY" };
const revenue = { key: "revenue" as const, label: "Revenue", periodicity: "annual" as const, value: 100, unit: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31", citation };
const income = { ...revenue, key: "net_income" as const, label: "Net income", value: 10, citation: { ...citation, concept: "NetIncomeLoss" } };

const snapshot: ResearchSnapshot = {
  schemaVersion: 1, sourceMode: "live", ticker: "SYN", question: "q", asOf: "2026-09-19T12:00:00.000Z", generatedAt: "2026-09-19T12:01:00.000Z",
  providerPlan: [
    { capability: "filings", selected: "sec-edgar", fallbacks: [], rejected: [], explanation: "" },
    { capability: "issuer-events", selected: "issuer-ir", fallbacks: [], rejected: [], explanation: "" },
  ],
  sources: [
    { provider: "sec-edgar", asOf: "", fetchedAt: "2026-09-19T12:00:30.000Z", staleAt: "", freshness: "fresh", cache: "miss", sourceUrl: "https://data.sec.gov/submissions/CIK0000000001.json", licenseScope: "", data: {} },
    { provider: "alpha-vantage-market", asOf: "", fetchedAt: "2026-09-18T12:00:00.000Z", staleAt: "", freshness: "stale", cache: "stale-fallback", sourceUrl: "https://www.alphavantage.co/query", licenseScope: "", data: {} },
  ],
  warnings: ["consensus provider timed out"],
  secFacts: {
    cik: "0000000001", entityName: "Synthetic Co", asOfDate: "2026-09-19", facts: [revenue, income],
    issues: [
      { code: "metric_missing", severity: "warning", metric: "operating_cash_flow", periodicity: "annual", message: "No annual Operating cash flow" },
      { code: "amended_filing", severity: "info", message: "amended" },
    ],
  },
  evidenceRefs: [
    { evidenceId: "evd_revenue", naturalKey: "sec-fact:revenue:annual", kind: "FACT", provider: "sec-edgar", sourceUrl: citation.sourceUrl },
    { evidenceId: "evd_quote", naturalKey: "market-quote", kind: "FACT", provider: "alpha-vantage-market", sourceUrl: "https://www.alphavantage.co/query" },
    { evidenceId: "evd_consensus", naturalKey: "consensus-estimates", kind: "EXPECTATION", provider: "alpha-vantage-consensus", sourceUrl: "https://www.alphavantage.co/query" },
  ],
};
const job: DraftableJob = { id: "job_1", status: "succeeded", ticker: "SYN", securityId: "sec_1", question: "Is revenue growth durable?", asOf: snapshot.asOf, snapshot };

describe("deterministic evidence draft builder", () => {
  const draft = buildResearchDraft(job);

  it("refuses jobs that cannot back a draft", () => {
    const code = (input: DraftableJob) => { try { buildResearchDraft(input); return null; } catch (error) { return error instanceof DraftPreconditionError ? error.code : "unexpected"; } };
    assert.equal(code({ ...job, status: "failed" }), "JOB_NOT_SUCCEEDED");
    assert.equal(code({ ...job, snapshot: null }), "SNAPSHOT_MISSING");
    assert.equal(code({ ...job, snapshot: { ...snapshot, secFacts: null } }), "NO_NORMALIZED_FACTS");
    assert.equal(code({ ...job, snapshot: { ...snapshot, evidenceRefs: [] } }), "NO_EVIDENCE_REFS");
  });

  it("links every fact to its evidence row and leaves uncited facts out", () => {
    assert.deepEqual(draft.facts.map((fact) => [fact.key, fact.evidenceId]), [["revenue", "evd_revenue"]]);
    assert.equal(draft.facts[0]?.citation.accession, "0000000001-26-000001");
    assert.ok(draft.unknowns.some((unknown) => unknown.code === "uncited_fact" && unknown.message.startsWith("Net income")));
  });

  it("keeps SEC facts, market data and expectations in separate sections", () => {
    assert.deepEqual(draft.marketData.map((item) => item.evidenceId), ["evd_quote"]);
    assert.deepEqual(draft.expectations.map((item) => item.evidenceId), ["evd_consensus"]);
    assert.deepEqual(draftEvidenceIds(draft).sort(), ["evd_consensus", "evd_quote", "evd_revenue"]);
  });

  it("surfaces gaps as unknowns instead of hiding them", () => {
    assert.deepEqual(draft.unknowns.map((unknown) => unknown.code).sort(), ["metric_missing", "missing_capability", "provider_failure", "stale_source", "uncited_fact"]);
    assert.deepEqual(draft.evidenceSummary.counts, { sources: 2, staleSources: 1, missingCapabilities: 1, facts: 1, unknowns: 5 });
    assert.equal(draft.normalizationIssues.length, 2, "the raw normalization issues are kept for review");
  });

  it("leaves every judgement to a person and records no model", () => {
    assert.equal(draft.thesis.status, "needs_author");
    assert.equal(draft.thesis.statement, null);
    assert.deepEqual([draft.scenarios, draft.falsifiers, draft.catalysts], [[], [], []]);
    assert.deepEqual(draft.review, { status: "unreviewed", modelVersion: null, promptVersion: null, formulaVersion: null });
    assert.match(draft.disclaimer, /Not investment advice/);
  });

  it("is a pure function of the job and its snapshot", () => {
    assert.deepEqual(buildResearchDraft(job), draft);
    assert.equal(draft.time.filingCutoff, "2026-09-19");
    assert.equal(draft.time.snapshotGeneratedAt, snapshot.generatedAt);
  });
});

describe("research draft API", () => {
  let tenantA: { userId: string; workspaceId: string };
  let succeededJob: string;
  let raceJob: string;
  let queuedJob: string;
  const asTenantA = () => ({ "x-alphalens-workspace": tenantA.workspaceId });
  const call = (handler: typeof getDraft, jobId: string, method: "GET" | "POST", headers: Record<string, string> = {}) =>
    handler(apiRequest(`/api/v1/research/${jobId}/draft`, { method, headers }), { params: Promise.resolve({ jobId }) });

  before(async () => {
    installHarness();
    tenantA = await provisionTenant(OWNER_A);
    await provisionTenant(OWNER_B);
    await addMember(tenantA.workspaceId, EDITOR_A, "editor");
    await addMember(tenantA.workspaceId, VIEWER_A, "viewer");
    asUser(OWNER_A);
    const context = { userId: tenantA.userId, email: OWNER_A, workspaceId: tenantA.workspaceId, role: "owner" as const };
    const runJob = async (ticker: string) => {
      await enqueueResearch(context, { ticker, question: "Draft me", asOf: "2026-09-19T12:00:00.000Z", idempotencyKey: `draft-${ticker}` });
      const claimed = await claimNextJob("worker-draft");
      assert.ok(claimed);
      assert.equal((await executeJob(claimed)).status, "succeeded");
      return claimed.id;
    };
    succeededJob = await runJob("AAPL");
    raceJob = await runJob("NVDA");
    const queued = await enqueueResearch(context, { ticker: "MSFT", question: "Not yet", asOf: "2026-09-19T12:00:00.000Z", idempotencyKey: "draft-queued" });
    queuedJob = (queued as { id: string }).id;
  });
  after(() => teardownHarness());

  it("returns 404 before a draft exists", async () => {
    asUser(OWNER_A);
    assert.equal((await call(getDraft, succeededJob, "GET")).status, 404);
  });

  it("forbids viewers from creating a draft", async () => {
    asUser(VIEWER_A);
    assert.equal((await call(createDraft, succeededJob, "POST", asTenantA())).status, 403);
  });

  it("refuses to draft a job that has not succeeded", async () => {
    asUser(EDITOR_A);
    const response = await call(createDraft, queuedJob, "POST", asTenantA());
    assert.equal(response.status, 409);
    assert.equal(((await responseBody(response))?.error as { code: string }).code, "JOB_NOT_SUCCEEDED");
  });

  it("creates one draft artifact whose citations resolve to workspace evidence", async () => {
    asUser(EDITOR_A);
    const response = await call(createDraft, succeededJob, "POST", asTenantA());
    assert.equal(response.status, 201);
    const data = (await responseBody(response))?.data as { status: string; version: number; content: { facts: Array<{ evidenceId: string }>; sourceMode: string; thesis: { status: string } } };
    assert.equal(data.status, "draft");
    assert.equal(data.version, 1);
    assert.equal(data.content.sourceMode, "fixture");
    assert.equal(data.content.thesis.status, "needs_author");
    assert.equal(data.content.facts.length, 8);
    for (const fact of data.content.facts) {
      const row = await getDb().prepare("SELECT kind FROM evidence WHERE id=? AND workspace_id=?").bind(fact.evidenceId, tenantA.workspaceId).first<{ kind: string }>();
      assert.equal(row?.kind, "FACT");
    }
    assert.equal((await auditRows("research.draft.create")).length, 1);
  });

  it("returns the existing draft on a repeat request", async () => {
    asUser(OWNER_A);
    const response = await call(createDraft, succeededJob, "POST");
    assert.equal(response.status, 200);
    assert.equal(((await responseBody(response))?.meta as { created: boolean }).created, false);
    assert.equal((await auditRows("research.draft.create")).length, 1, "no audit row for a draft that already existed");
  });

  it("converges concurrent first requests on a single draft version", async () => {
    asUser(OWNER_A);
    const responses = await Promise.all([call(createDraft, raceJob, "POST"), call(createDraft, raceJob, "POST")]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
    const bodies = await Promise.all(responses.map(responseBody));
    assert.equal((bodies[0]?.data as { versionId: string }).versionId, (bodies[1]?.data as { versionId: string }).versionId);
    const versions = await getDb().prepare("SELECT COUNT(*) AS c FROM research_artifact_versions WHERE workspace_id=?").bind(tenantA.workspaceId).first<{ c: number }>();
    assert.equal(versions?.c, 2, "one draft version per job");
    assert.equal((await auditRows("research.draft.create")).length, 2);
  });

  it("lets any member read the draft", async () => {
    asUser(VIEWER_A);
    const response = await call(getDraft, succeededJob, "GET", asTenantA());
    assert.equal(response.status, 200);
    assert.equal(((await responseBody(response))?.data as { version: number }).version, 1);
  });

  it("refuses a draft whose snapshot cites evidence from another security", async () => {
    // Graft the AAPL snapshot onto the MSFT job: its evidence ids exist, but not for this security.
    const source = await getDb().prepare("SELECT snapshot_json AS snapshotJson FROM research_jobs WHERE id=?").bind(succeededJob).first<{ snapshotJson: string }>();
    await getDb().prepare("UPDATE research_jobs SET status='succeeded',snapshot_json=? WHERE id=?").bind(source!.snapshotJson, queuedJob).run();
    asUser(OWNER_A);
    const response = await call(createDraft, queuedJob, "POST");
    assert.equal(response.status, 409);
    assert.equal(((await responseBody(response))?.error as { code: string }).code, "EVIDENCE_MISSING");
  });

  it("answers 404 to another tenant for both read and create", async () => {
    asUser(OWNER_B);
    assert.equal((await call(getDraft, succeededJob, "GET")).status, 404);
    assert.equal((await call(createDraft, succeededJob, "POST")).status, 404);
  });
});
