import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { normalizeCompanyFacts, secFactClaim, type NormalizedSecFact } from "../lib/research/normalize.ts";
import { fixtureCompanyFacts } from "../lib/research/fixture-provider.ts";
import { enqueueResearch } from "../lib/research/queue";
import { claimNextJob, executeJob } from "../lib/research/runner";
import { parseResearchSnapshot, safeJsonParse } from "../lib/research/snapshot.ts";
import { OWNER_A, asUser, getDb, installHarness, provisionTenant, teardownHarness } from "./helpers/tenant-harness";

const payload = JSON.parse(readFileSync(new URL("./fixtures/sec-companyfacts-edge.json", import.meta.url), "utf8"));
const SOURCE = "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json";
const AS_OF = "2026-01-15T12:00:00.000Z";

function find(facts: NormalizedSecFact[], key: string, periodicity: string) {
  return facts.find((fact) => fact.key === key && fact.periodicity === periodicity);
}

describe("SEC companyfacts normalization", () => {
  const result = normalizeCompanyFacts(payload, { asOf: AS_OF, sourceUrl: SOURCE });
  const codes = (code: string) => result.issues.filter((issue) => issue.code === code);

  it("identifies the issuer and pads the CIK", () => {
    assert.equal(result.cik, "0000320193");
    assert.equal(result.entityName, "Synthetic Edge Case Co.");
    assert.equal(result.asOfDate, "2026-01-15");
  });

  it("excludes values filed on or after the as_of date", () => {
    // FY2025 revenue (filed 2026-02-10) and Q3 EPS (filed on the as_of day) are unknowable at as_of.
    assert.equal(find(result.facts, "revenue", "annual")?.periodEnd, "2024-12-31");
    assert.equal(find(result.facts, "eps_diluted", "quarterly")?.periodEnd, "2025-06-30");
    assert.match(codes("later_filings_excluded")[0]?.message ?? "", /^2 reported values/);
  });

  it("prefers the higher-priority concept within a period but never an older period", () => {
    const annual = find(result.facts, "revenue", "annual");
    assert.equal(annual?.value, 1010);
    assert.equal(annual?.citation.concept, "Revenues");
    // Only the lower-priority concept reports the latest quarter; the 2017 SalesRevenueNet never wins.
    const quarter = find(result.facts, "revenue", "quarterly");
    assert.equal(quarter?.value, 300);
    assert.equal(quarter?.citation.concept, "RevenueFromContractWithCustomerExcludingAssessedTax");
  });

  it("ignores year-to-date durations, non-periodic forms, and malformed rows", () => {
    const quarter = find(result.facts, "revenue", "quarterly");
    assert.equal(quarter?.periodStart, "2025-07-01");
    assert.notEqual(quarter?.citation.form, "8-K");
  });

  it("uses the latest restatement filed before as_of and flags the amendment", () => {
    const income = find(result.facts, "net_income", "annual");
    assert.equal(income?.value, 95);
    assert.equal(income?.citation.form, "10-K/A");
    assert.equal(codes("amended_filing").length, 1);
  });

  it("cites the exact filing, concept, unit and period for every fact", () => {
    const annual = find(result.facts, "revenue", "annual")!;
    assert.deepEqual(annual.citation, {
      provider: "sec-edgar", sourceUrl: SOURCE, filingUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000010/",
      cik: "0000320193", accession: "0000320193-25-000010", form: "10-K", filed: "2025-02-15", taxonomy: "us-gaap", concept: "Revenues",
      unit: "USD", periodStart: "2024-01-01", periodEnd: "2024-12-31", frame: "CY2024", filingFiscalYear: 2024, filingFiscalPeriod: "FY",
    });
    assert.equal(secFactClaim("SYN", annual), "SYN Revenue (annual, 2024-01-01 to 2024-12-31): 1,010 USD — 10-K filed 2025-02-15, us-gaap:Revenues");
  });

  it("reports missing, stale and ambiguous metrics instead of guessing", () => {
    assert.deepEqual(codes("metric_missing").map((issue) => `${issue.metric}:${issue.periodicity}`), ["operating_cash_flow:annual"]);
    assert.deepEqual(codes("stale_period").map((issue) => `${issue.metric}:${issue.periodicity}`), ["eps_diluted:quarterly"]);
    assert.deepEqual(codes("ambiguous_value").map((issue) => issue.metric), ["shares_outstanding"]);
    assert.equal(find(result.facts, "shares_outstanding", "instant"), undefined);
  });

  it("is deterministic", () => {
    assert.deepEqual(normalizeCompanyFacts(payload, { asOf: AS_OF, sourceUrl: SOURCE }), result);
  });

  it("rejects malformed payloads and as_of values as blocking issues", () => {
    assert.equal(normalizeCompanyFacts({ cik: 1 }, { asOf: AS_OF, sourceUrl: SOURCE }).issues[0]?.severity, "blocking");
    assert.equal(normalizeCompanyFacts(payload, { asOf: "yesterday", sourceUrl: SOURCE }).issues[0]?.code, "malformed_payload");
  });

  it("normalizes the synthetic local fixture completely with .invalid citations", () => {
    const envelope = fixtureCompanyFacts("aapl", "2026-09-19T12:00:00.000Z");
    const fixture = normalizeCompanyFacts(envelope.data, { asOf: envelope.asOf, sourceUrl: envelope.sourceUrl, archiveOrigin: "https://fixtures.alphalens.invalid/sec-archive" });
    assert.equal(fixture.facts.length, 8);
    assert.deepEqual(fixture.issues, []);
    assert.ok(fixture.facts.every((fact) => fact.citation.sourceUrl.includes(".invalid") && fact.citation.filingUrl?.includes(".invalid")));
  });
});

describe("research runner persists normalized SEC facts (fixture mode)", () => {
  let tenant: { userId: string; workspaceId: string };

  // installHarness enables fixture mode and teardownHarness clears it.
  before(async () => {
    installHarness();
    tenant = await provisionTenant(OWNER_A);
  });
  after(() => teardownHarness());

  async function runOnce(key: string) {
    asUser(OWNER_A);
    const context = { userId: tenant.userId, email: OWNER_A, workspaceId: tenant.workspaceId, role: "owner" as const };
    await enqueueResearch(context, { ticker: "AAPL", question: "normalize", asOf: "2026-09-19T12:00:00.000Z", idempotencyKey: key });
    const job = await claimNextJob("worker-normalize");
    assert.ok(job);
    assert.equal((await executeJob(job)).status, "succeeded");
    return job.id;
  }

  it("stores each fact as cited FACT evidence and in the snapshot", async () => {
    const jobId = await runOnce("normalize-1");
    const rows = await getDb().prepare("SELECT e.kind,e.claim,e.value_json AS valueJson,s.title FROM evidence e JOIN sources s ON s.id=e.source_id WHERE e.workspace_id=? AND (e.claim LIKE '%us-gaap:%' OR e.claim LIKE '%dei:%')").bind(tenant.workspaceId).all<{ kind: string; claim: string; valueJson: string; title: string }>();
    assert.equal(rows.results.length, 8);
    assert.ok(rows.results.every((row) => row.kind === "FACT" && row.title === "AAPL SEC XBRL company facts"));
    assert.ok(rows.results.every((row) => JSON.parse(row.valueJson).citation.accession));

    const job = await getDb().prepare("SELECT snapshot_json AS snapshotJson FROM research_jobs WHERE id=?").bind(jobId).first<{ snapshotJson: string }>();
    const snapshot = parseResearchSnapshot(safeJsonParse(job?.snapshotJson));
    assert.equal(snapshot?.secFacts?.facts.length, 8);
    assert.ok(!JSON.stringify(snapshot?.sources).includes("NetIncomeLoss"), "raw companyfacts stays out of the snapshot");
  });

  it("does not create new evidence versions when the same facts are collected again", async () => {
    await runOnce("normalize-2");
    const count = await getDb().prepare("SELECT COUNT(*) AS c FROM evidence WHERE workspace_id=? AND (claim LIKE '%us-gaap:%' OR claim LIKE '%dei:%')").bind(tenant.workspaceId).first<{ c: number }>();
    assert.equal(count?.c, 8);
  });
});
