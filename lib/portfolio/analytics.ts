export type PortfolioPosition = {
  id?: string; ticker: string; positionType: "long" | "short" | "watch"; shares: number;
  currentPrice?: number | null; marketValue?: number | null; currency?: string | null; sector?: string | null;
  industry?: string | null; beta?: number | null; advUsd?: number | null; factorExposures?: Record<string, number>;
  eventTags?: string[]; dataStatus?: "current" | "stale" | "user_input" | "missing";
};

export type RiskPolicy = {
  nav: number; maxPositionWeight: number; maxSectorWeight: number; maxFactorExposure: number;
  maxEventClusterWeight: number; scenarioLossBudgetBps: number; absoluteLossCapBps: number; correlationLookbackDays?: number; exitParticipationRate: number;
};

export type ThesisSignal = { ticker: string; status?: string | null; falsifierStatus?: string | null };
export type Shock = { dimension: "ticker" | "sector" | "factor" | "currency" | "event"; key: string; percent: number };

function signedValue(position: PortfolioPosition) {
  if (position.positionType === "watch") return 0;
  const absolute = Math.abs(position.marketValue ?? position.shares * (position.currentPrice ?? 0));
  return position.positionType === "short" ? -absolute : absolute;
}

function groupSum(entries: Array<[string, number]>) {
  return entries.reduce<Record<string, number>>((result, [key, value]) => { result[key] = (result[key] ?? 0) + value; return result; }, {});
}

export function calculatePortfolioRisk(positions: PortfolioPosition[], policy: RiskPolicy) {
  const held = positions.filter((position) => position.positionType !== "watch");
  const nav = policy.nav > 0 ? policy.nav : held.reduce((sum, position) => sum + Math.abs(signedValue(position)), 0);
  const values = held.map((position) => ({ position, value: signedValue(position) }));
  const gross = values.reduce((sum, item) => sum + Math.abs(item.value), 0);
  const net = values.reduce((sum, item) => sum + item.value, 0);
  const weights = values.map(({ position, value }) => ({ ticker: position.ticker, weight: nav ? value / nav : 0, absoluteWeight: nav ? Math.abs(value) / nav : 0 }));
  const sector = groupSum(values.map(({ position, value }) => [position.sector ?? "Unclassified", nav ? value / nav : 0]));
  const currency = groupSum(values.map(({ position, value }) => [position.currency ?? "Unknown", nav ? value / nav : 0]));
  const event = groupSum(values.flatMap(({ position, value }) => (position.eventTags?.length ? position.eventTags : ["Unclassified"]).map((tag) => [tag, nav ? Math.abs(value) / nav : 0] as [string, number])));
  const factor = groupSum(values.flatMap(({ position, value }) => Object.entries(position.factorExposures ?? {}).map(([key, exposure]) => [key, nav ? value / nav * exposure : 0] as [string, number])));
  const sorted = [...weights].sort((a, b) => b.absoluteWeight - a.absoluteWeight);
  const hhi = weights.reduce((sum, item) => sum + item.absoluteWeight ** 2, 0);
  const liquidity = values.map(({ position, value }) => ({ ticker: position.ticker, daysToExit: position.advUsd && policy.exitParticipationRate > 0 ? Math.abs(value) / (position.advUsd * policy.exitParticipationRate) : null }));
  const warnings = [
    !policy.nav ? "NAV 未设置：风险权重以持仓绝对市值合计作为临时分母。" : null,
    positions.some((position) => position.dataStatus === "stale") ? "部分价格或风险输入已陈旧。" : null,
    held.some((position) => !position.currentPrice && !position.marketValue) ? "部分持仓缺少价格或市值，组合统计不完整。" : null,
    held.some((position) => !position.advUsd) ? "部分持仓缺少 ADV，流动性退出天数不可计算。" : null,
  ].filter((warning): warning is string => Boolean(warning));
  return {
    nav, grossExposure: nav ? gross / nav : 0, netExposure: nav ? net / nav : 0,
    betaAdjustedNet: nav ? values.reduce((sum, item) => sum + item.value * (item.position.beta ?? 1), 0) / nav : 0,
    top5Weight: sorted.slice(0, 5).reduce((sum, item) => sum + item.absoluteWeight, 0), hhi,
    effectivePositions: hhi > 0 ? 1 / hhi : 0, weights, exposures: { sector, factor, currency, event }, liquidity, warnings,
  };
}

export function correlationMatrix(series: Record<string, Record<string, number>>, minimumObservations = 20) {
  const tickers = Object.keys(series).sort(); const matrix: Record<string, Record<string, number | null>> = {}; let validPairs = 0; let possiblePairs = 0;
  for (const left of tickers) { matrix[left] = {}; for (const right of tickers) {
    if (left === right) { matrix[left][right] = 1; continue; }
    if (left < right) possiblePairs += 1;
    const dates = Object.keys(series[left]).filter((date) => series[right]?.[date] != null);
    const correlation = dates.length >= minimumObservations ? pearson(dates.map((date) => series[left][date]), dates.map((date) => series[right][date])) : null;
    matrix[left][right] = correlation; if (left < right && correlation != null) validPairs += 1;
  }}
  return { tickers, matrix, coverage: possiblePairs ? validPairs / possiblePairs : tickers.length === 1 ? 1 : 0, minimumObservations, warnings: validPairs < possiblePairs ? [`${possiblePairs - validPairs} 个相关性配对样本不足。`] : [] };
}

export function stressPortfolio(positions: PortfolioPosition[], policy: RiskPolicy, shocks: Shock[]) {
  const base = calculatePortfolioRisk(positions, policy); let totalPnl = 0;
  const impacts = positions.filter((position) => position.positionType !== "watch").map((position) => {
    const matched = shocks.filter((shock) => matches(position, shock));
    const combinedShock = Math.max(-1, Math.min(5, matched.reduce((sum, shock) => sum + shock.percent / 100 * (shock.dimension === "factor" ? position.factorExposures?.[shock.key] ?? 0 : 1), 0)));
    const pnl = signedValue(position) * combinedShock; totalPnl += pnl;
    return { ticker: position.ticker, shockPercent: combinedShock * 100, pnl, matched: matched.map((shock) => `${shock.dimension}:${shock.key}`) };
  });
  const lossBps = base.nav ? Math.max(0, -totalPnl / base.nav * 10_000) : 0;
  return { asOf: new Date().toISOString(), pnl: totalPnl, lossBps, budgetStatus: lossBps > policy.absoluteLossCapBps ? "absolute_cap_breached" : lossBps > policy.scenarioLossBudgetBps ? "loss_budget_breached" : "within_budget", impacts };
}

export function generateActionConditions(positions: PortfolioPosition[], policy: RiskPolicy, theses: ThesisSignal[], scenarioLossBps = 0) {
  const risk = calculatePortfolioRisk(positions, policy); const conditions: Array<{ key: string; ticker?: string; conditionType: "review" | "trim" | "exit" | "re_underwrite"; triggerKind: "thesis_status" | "falsifier" | "risk_budget" | "exposure"; severity: "warning" | "critical"; message: string; predicate: Record<string, unknown> }> = [];
  for (const item of risk.weights) if (item.absoluteWeight > policy.maxPositionWeight) conditions.push({ key: `position:${item.ticker}:${policy.maxPositionWeight}`, ticker: item.ticker, conditionType: "review", triggerKind: "risk_budget", severity: "warning", message: `${item.ticker} 权重 ${(item.absoluteWeight * 100).toFixed(1)}% 超过单一仓位预算；复核后才决定是否降低风险。`, predicate: { actual: item.absoluteWeight, limit: policy.maxPositionWeight } });
  for (const [sector, weight] of Object.entries(risk.exposures.sector)) if (Math.abs(weight) > policy.maxSectorWeight) conditions.push({ key: `sector:${sector}:${policy.maxSectorWeight}`, conditionType: "review", triggerKind: "exposure", severity: "warning", message: `${sector} 净暴露 ${(weight * 100).toFixed(1)}% 超过行业预算。`, predicate: { actual: weight, limit: policy.maxSectorWeight } });
  for (const [factor, exposure] of Object.entries(risk.exposures.factor)) if (Math.abs(exposure) > policy.maxFactorExposure) conditions.push({ key: `factor:${factor}:${policy.maxFactorExposure}`, conditionType: "review", triggerKind: "exposure", severity: "warning", message: `${factor} 因子暴露 ${(exposure * 100).toFixed(1)}% 超过因子预算。`, predicate: { actual: exposure, limit: policy.maxFactorExposure } });
  for (const [event, exposure] of Object.entries(risk.exposures.event)) if (exposure > policy.maxEventClusterWeight) conditions.push({ key: `event:${event}:${policy.maxEventClusterWeight}`, conditionType: "review", triggerKind: "exposure", severity: "warning", message: `${event} 事件簇覆盖 ${(exposure * 100).toFixed(1)}% 的 NAV，超过事件预算。`, predicate: { actual: exposure, limit: policy.maxEventClusterWeight } });
  for (const thesis of theses) {
    if (thesis.status === "invalidated" || thesis.falsifierStatus === "triggered") conditions.push({ key: `invalidated:${thesis.ticker}:${thesis.falsifierStatus}`, ticker: thesis.ticker, conditionType: "re_underwrite", triggerKind: thesis.falsifierStatus === "triggered" ? "falsifier" : "thesis_status", severity: "critical", message: `${thesis.ticker} 论点已证伪或失效：禁止加仓，先重新承保并按用户规则评估减仓/退出。`, predicate: { thesisStatus: thesis.status, falsifierStatus: thesis.falsifierStatus } });
    else if (thesis.status === "weakening" || thesis.falsifierStatus === "warning") conditions.push({ key: `weakening:${thesis.ticker}:${thesis.falsifierStatus}`, ticker: thesis.ticker, conditionType: "review", triggerKind: thesis.falsifierStatus === "warning" ? "falsifier" : "thesis_status", severity: "warning", message: `${thesis.ticker} 论点弱化：暂停新增风险，复核证据和仓位上限。`, predicate: { thesisStatus: thesis.status, falsifierStatus: thesis.falsifierStatus } });
  }
  if (scenarioLossBps > policy.scenarioLossBudgetBps) conditions.push({ key: `scenario:${policy.scenarioLossBudgetBps}`, conditionType: "review", triggerKind: "risk_budget", severity: scenarioLossBps > policy.absoluteLossCapBps ? "critical" : "warning", message: `压力情景损失 ${Math.round(scenarioLossBps)} bps 超过 ${policy.scenarioLossBudgetBps} bps 情景预算；复核集中度、对冲或规模方案。`, predicate: { actualBps: scenarioLossBps, budgetBps: policy.scenarioLossBudgetBps, absoluteCapBps: policy.absoluteLossCapBps } });
  return conditions;
}

function matches(position: PortfolioPosition, shock: Shock) {
  if (shock.dimension === "ticker") return position.ticker === shock.key;
  if (shock.dimension === "sector") return position.sector === shock.key;
  if (shock.dimension === "currency") return (position.currency ?? "USD") === shock.key;
  if (shock.dimension === "event") return position.eventTags?.includes(shock.key) ?? false;
  return position.factorExposures?.[shock.key] != null;
}

function pearson(left: number[], right: number[]) {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length; const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  const numerator = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0);
  const denominator = Math.sqrt(left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0) * right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0));
  return denominator ? Math.max(-1, Math.min(1, numerator / denominator)) : 0;
}
