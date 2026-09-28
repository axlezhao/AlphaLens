import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { POST as enqueue } from "../app/api/v1/research/route";
import { GET as getJob } from "../app/api/v1/research/[jobId]/route";
import { GET as getDraft, POST as createDraft } from "../app/api/v1/research/[jobId]/draft/route";
import { POST as reverify } from "../app/api/v1/research/[jobId]/draft/verify/route";
import { POST as review } from "../app/api/v1/research/[jobId]/draft/review/route";
import { POST as researchWorker } from "../app/api/internal/research-worker/route";
import type { ResearchDraftContent, ResearchDraftVersion } from "../lib/research/draft.ts";
import { OWNER_A, WORKER_SECRET, apiRequest, asUser, getDb, installHarness, provisionTenant, responseBody, teardownHarness } from "./helpers/tenant-harness";

/**
 * Phase 1 gate (docs/PRODUCT_ARCHITECTURE_PLAN.md §14): a user can go from a
 * fixture research job to a reviewable, cited draft without any model, and
 * nothing with an open blocking issue can be approved or published. Drives
 * only the HTTP route handlers, the same surface `pnpm local:verify:e2e` uses.
 */
describe("Phase 1 gate: research job → evidence draft → verification → review → publish", () => {
  const params = (jobId: string) => ({ params: Promise.resolve({ jobId }) });
  const data = async (response: Response) => { const body = await responseBody(response); assert.ok(response.ok, JSON.stringify(body?.error)); return body?.data as Record<string, unknown>; };
  const errorOf = async (response: Response) => ((await responseBody(response))?.error as { code: string }).code;
  const reviewAction = (jobId: string, action: string) => review(apiRequest(`/api/v1/research/${jobId}/draft/review`, { method: "POST", body: { action } }), params(jobId));

  async function completedJob(ticker: string, asOf: string) {
    const created = await data(await enqueue(apiRequest("/api/v1/research", { method: "POST", body: { ticker, question: `Is ${ticker} revenue growth durable?`, asOf } })));
    await data(await researchWorker(apiRequest("/api/internal/research-worker", { method: "POST", headers: { authorization: `Bearer ${WORKER_SECRET}` } })));
    const job = await data(await getJob(apiRequest(`/api/v1/research/${created.id}`), params(String(created.id))));
    assert.equal(job.status, "succeeded");
    return String(job.id);
  }

  before(async () => {
    installHarness();
    await provisionTenant(OWNER_A);
    asUser(OWNER_A);
  });
  after(() => teardownHarness());

  it("publishes a verified, fully cited draft only after human approval", async () => {
    const jobId = await completedJob("AAPL", "2026-09-19T12:00:00.000Z");
    const draft = await data(await createDraft(apiRequest(`/api/v1/research/${jobId}/draft`, { method: "POST" }), params(jobId))) as unknown as ResearchDraftVersion;
    const content = draft.content as ResearchDraftContent;

    assert.equal(content.sourceMode, "fixture");
    assert.ok(content.facts.length > 0);
    for (const fact of content.facts) {
      assert.match(fact.evidenceId, /^evd_/);
      assert.match(fact.citation.accession, /^\d{10}-\d{2}-\d{6}$/);
      assert.ok(fact.citation.filed < content.time.filingCutoff, "no fact filed on or after as_of");
    }
    assert.equal(content.thesis.statement, null, "no generated thesis");
    assert.equal(content.review.modelVersion, null, "no model involved");
    assert.ok(draft.verifiedAt);
    assert.equal(draft.issueSummary.blockingOpen, 0);

    assert.equal(await errorOf(await reviewAction(jobId, "publish")), "NOT_APPROVED");
    assert.equal((await data(await reviewAction(jobId, "request"))).status, "in_review");
    assert.equal((await data(await reviewAction(jobId, "approve"))).status, "approved");
    assert.equal((await data(await reviewAction(jobId, "publish"))).status, "published");
    assert.equal((await data(await getDraft(apiRequest(`/api/v1/research/${jobId}/draft`), params(jobId)))).status, "published");
  });

  it("cannot approve a draft whose as_of predates every filing", async () => {
    // The fixture's earliest filing is 2026-02-20; nothing is knowable on 2026-01-01.
    const jobId = await completedJob("MSFT", "2026-01-01T12:00:00.000Z");
    const draft = await data(await createDraft(apiRequest(`/api/v1/research/${jobId}/draft`, { method: "POST" }), params(jobId))) as unknown as ResearchDraftVersion;
    assert.equal((draft.content as ResearchDraftContent).facts.length, 0);
    assert.ok(draft.issues.some((issue) => issue.checkCode === "no_facts" && issue.severity === "blocking"));
    await data(await reviewAction(jobId, "request"));
    assert.equal(await errorOf(await reviewAction(jobId, "approve")), "BLOCKING_ISSUES");
  });

  it("cannot approve a draft after its source evidence stops tying out", async () => {
    const jobId = await completedJob("NVDA", "2026-09-19T12:00:00.000Z");
    await data(await createDraft(apiRequest(`/api/v1/research/${jobId}/draft`, { method: "POST" }), params(jobId)));
    const evidence = await getDb().prepare("SELECT e.id,e.value_json AS valueJson FROM evidence e JOIN research_jobs j ON j.security_id=e.security_id WHERE j.id=? AND e.claim LIKE '%Diluted EPS (annual%'").bind(jobId).first<{ id: string; valueJson: string }>();
    await getDb().prepare("UPDATE evidence SET value_json=? WHERE id=?").bind(JSON.stringify({ ...JSON.parse(evidence!.valueJson), unit: "EUR/shares" }), evidence!.id).run();
    const rechecked = await data(await reverify(apiRequest(`/api/v1/research/${jobId}/draft/verify`, { method: "POST" }), params(jobId))) as unknown as ResearchDraftVersion;
    assert.ok(rechecked.issues.some((issue) => issue.checkCode === "value_tieout_failed" && issue.status === "open"));
    await data(await reviewAction(jobId, "request"));
    assert.equal(await errorOf(await reviewAction(jobId, "approve")), "BLOCKING_ISSUES");
  });
});
