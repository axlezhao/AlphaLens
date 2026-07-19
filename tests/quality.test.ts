import test from "node:test";
import assert from "node:assert/strict";
import { assertNoFutureEvidence, calibrationReport, dcfValue, detectSourceConflicts, tieOutFinancials } from "../lib/quality/financial-validation.ts";

test("financial values tie to an independent source inside tolerance", () => {
  const result = tieOutFinancials([
    { metric: "revenue", period: "FY2025", unit: "USDm", value: 1000, sourceId: "10-k", filedAt: "2026-02-01" },
    { metric: "revenue", period: "FY2025", unit: "USDm", value: 1002, sourceId: "earnings-release", filedAt: "2026-02-01" },
  ]);
  assert.equal(result[0].passed, true);
});

test("material source conflicts are surfaced", () => {
  const conflicts = detectSourceConflicts([
    { metric: "eps", period: "Q1", unit: "USD", value: 2, sourceId: "filing", filedAt: "2026-05-01" },
    { metric: "eps", period: "Q1", unit: "USD", value: 2.5, sourceId: "vendor", filedAt: "2026-05-01" },
  ]);
  assert.equal(conflicts.length, 1);
});

test("DCF golden case remains stable", () => {
  const value = dcfValue({ freeCashFlows: [100, 110, 121], discountRate: 0.1, terminalGrowth: 0.03, netDebt: 50, dilutedShares: 100 });
  assert.ok(Math.abs(value.perShare - 15.6038961038961) < 1e-9);
});

test("future evidence is rejected at the as_of boundary", () => {
  assert.throws(() => assertNoFutureEvidence([{ observedAt: "2026-07-18T00:00:00Z" }], "2026-07-17T23:59:59Z"), /LOOK_AHEAD_BIAS/);
});

test("confidence calibration returns Brier and ECE", () => {
  const report = calibrationReport([{ confidence: 0.9, correct: true }, { confidence: 0.8, correct: false }]);
  assert.equal(report.count, 2); assert.ok(report.brierScore! > 0); assert.ok(report.expectedCalibrationError! > 0);
});
