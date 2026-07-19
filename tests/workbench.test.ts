import assert from "node:assert/strict";
import test from "node:test";
import { cognitiveBiasStats, reverseImpliedExpectations } from "../lib/workbench/analytics.ts";
import { reportMarkdown, reportPdf, reportXlsx, type ReportModel } from "../lib/workbench/exports.ts";

test("reverse implied EPS expectations", () => {
  const result = reverseImpliedExpectations({ method: "eps", price: 150, currentEps: 3, terminalPe: 25, years: 2 });
  assert.equal(result.terminalValue, 6);
  assert.ok(Math.abs(result.impliedCagr - (Math.sqrt(2) - 1)) < 1e-10);
});

test("reverse implied revenue expectations includes net debt", () => {
  const result = reverseImpliedExpectations({ method: "revenue", marketCap: 1000, netDebt: 100, currentRevenue: 100, terminalEvSales: 5.5, years: 2 });
  assert.equal(result.terminalValue, 200);
  assert.ok(Math.abs(result.impliedCagr - (Math.sqrt(2) - 1)) < 1e-10);
});

test("bias statistics deduplicate labels inside one review", () => {
  const stats = cognitiveBiasStats([
    { biases: ["confirmation", "confirmation"], confidence: 0.8, outcomeScore: 0.2 },
    { biases: ["confirmation", "anchoring"], confidence: 0.6, outcomeScore: null },
  ]);
  assert.deepEqual(stats[0], { bias: "confirmation", count: 2, averageConfidence: 0.7, averageOutcomeScore: 0.2 });
});

test("report exports produce UTF-8 markdown, PDF and XLSX containers", () => {
  const report: ReportModel = { ticker: "NVDA", issuerName: "NVIDIA", asOf: "2026-07-20T00:00:00.000Z", thesis: { statement: "推理需求持续增长", status: "active", conviction: 0.8, version: 2 }, falsifiers: [{ label: "毛利率低于预期", status: "untriggered", threshold: 70, unit: "%" }], catalysts: [{ title: "财报", eventAt: "2026-08-28", dateStatus: "estimated", status: "upcoming" }], evidence: [{ kind: "FACT", claim: "收入增长", source: "SEC", asOf: "2026-07-20", confidence: 0.9 }], peers: [{ ticker: "AMD", metrics: { forwardPe: 30 }, asOf: "2026-07-20" }], warnings: ["一致预期来源未配置"] };
  assert.match(reportMarkdown(report), /推理需求持续增长/);
  assert.equal(new TextDecoder().decode(reportPdf(report).slice(0, 8)), "%PDF-1.4");
  assert.deepEqual([...reportXlsx(report).slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
});
