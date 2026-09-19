import assert from "node:assert/strict";
import test from "node:test";
import { missingCapabilities, parseResearchSnapshot, safeJsonParse } from "../lib/research/snapshot.ts";

const snapshot = {
  schemaVersion: 1,
  ticker: "NVDA",
  question: "Check evidence",
  asOf: "2026-09-19T12:00:00.000Z",
  generatedAt: "2026-09-19T12:01:00.000Z",
  providerPlan: [
    { capability: "filings", selected: "sec-edgar", fallbacks: [], rejected: [], explanation: "primary" },
    { capability: "market-quote", selected: "alpha-vantage-market", fallbacks: [], rejected: [], explanation: "quote" },
  ],
  sources: [{ provider: "sec-edgar", asOf: "2026-09-19T12:00:00.000Z", fetchedAt: "2026-09-19T12:01:00.000Z", staleAt: "2026-09-20T12:01:00.000Z", freshness: "fresh", cache: "miss", sourceUrl: "https://www.sec.gov/example", licenseScope: "public", data: { cik: "1" } }],
  warnings: ["market provider unavailable"],
};

test("research snapshot preserves source provenance and reports selected missing capabilities", () => {
  const parsed = parseResearchSnapshot(snapshot);
  assert.ok(parsed);
  assert.equal(parsed.sources[0]?.sourceUrl, "https://www.sec.gov/example");
  assert.deepEqual(missingCapabilities(parsed).map((plan) => plan.capability), ["market-quote"]);
});

test("fixture snapshots remain explicitly labelled instead of being presented as live sources", () => {
  const parsed = parseResearchSnapshot({ ...snapshot, sourceMode: "fixture" });
  assert.equal(parsed?.sourceMode, "fixture");
});

test("malformed persisted snapshot never becomes a live result", () => {
  assert.equal(parseResearchSnapshot({ ...snapshot, sources: [{ ...snapshot.sources[0], sourceUrl: "" }] }), null);
  assert.equal(safeJsonParse("not json"), null);
});
