import assert from "node:assert/strict";
import test from "node:test";
import { calculatePortfolioRisk, correlationMatrix, generateActionConditions, stressPortfolio, type PortfolioPosition, type RiskPolicy } from "../lib/portfolio/analytics.ts";

const policy: RiskPolicy = { nav: 1000, maxPositionWeight: .5, maxSectorWeight: .7, maxFactorExposure: .8, maxEventClusterWeight: .7, scenarioLossBudgetBps: 800, absoluteLossCapBps: 1500, exitParticipationRate: .1 };
const positions: PortfolioPosition[] = [
  { ticker: "AAA", positionType: "long", shares: 10, currentPrice: 60, marketValue: 600, sector: "Tech", currency: "USD", beta: 1.2, advUsd: 300, factorExposures: { growth: 1 }, eventTags: ["earnings"] },
  { ticker: "BBB", positionType: "short", shares: 5, currentPrice: 40, marketValue: 200, sector: "Tech", currency: "USD", beta: .8, advUsd: 200, factorExposures: { growth: .5 }, eventTags: ["earnings"] },
  { ticker: "CCC", positionType: "watch", shares: 0, sector: "Health" },
];

test("portfolio exposure respects long/short signs and excludes watchlist", () => {
  const result = calculatePortfolioRisk(positions, policy);
  assert.equal(result.grossExposure, .8); assert.equal(result.netExposure, .4); assert.equal(result.betaAdjustedNet, .56);
  assert.ok(Math.abs(result.exposures.sector.Tech - .4) < 1e-12); assert.equal(result.top5Weight, .8); assert.equal(result.liquidity[0].daysToExit, 20);
});

test("correlation requires aligned observations and reports coverage", () => {
  const dates = Array.from({ length: 20 }, (_, index) => `2026-01-${String(index + 1).padStart(2, "0")}`); const series = { AAA: Object.fromEntries(dates.map((date, index) => [date, index / 100])), BBB: Object.fromEntries(dates.map((date, index) => [date, index / 50])) };
  const result = correlationMatrix(series, 20); assert.equal(result.coverage, 1); assert.ok((result.matrix.AAA.BBB ?? 0) > .999);
  assert.equal(correlationMatrix({ ...series, BBB: { "2026-01-01": 1 } }, 20).matrix.AAA.BBB, null);
});

test("stress test applies the correct sign to short positions", () => {
  const result = stressPortfolio(positions, policy, [{ dimension: "sector", key: "Tech", percent: -20 }]);
  assert.equal(result.pnl, -80); assert.equal(result.lossBps, 800); assert.equal(result.impacts.find((item) => item.ticker === "BBB")?.pnl, 40);
});

test("action engine links thesis invalidation and risk budgets without orders", () => {
  const conditions = generateActionConditions(positions, policy, [{ ticker: "AAA", status: "invalidated", falsifierStatus: "triggered" }], 900);
  assert.ok(conditions.some((item) => item.ticker === "AAA" && item.conditionType === "re_underwrite"));
  assert.ok(conditions.some((item) => item.triggerKind === "risk_budget"));
  assert.ok(conditions.every((item) => !("order" in item) && !("quantity" in item)));
});
