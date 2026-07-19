export type FinancialPoint = { metric: string; period: string; unit: string; value: number; sourceId: string; filedAt: string };

export function tieOutFinancials(points: FinancialPoint[], tolerance = 0.005) {
  const groups = new Map<string, FinancialPoint[]>();
  for (const point of points) {
    const key = `${point.metric}|${point.period}|${point.unit}`;
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }
  return [...groups.entries()].map(([key, values]) => {
    const benchmark = values[0]?.value ?? 0;
    const maxVariance = Math.max(...values.map((point) => Math.abs(point.value - benchmark) / Math.max(1, Math.abs(benchmark))));
    return { key, passed: values.length >= 2 && maxVariance <= tolerance, maxVariance, sourceIds: values.map((point) => point.sourceId) };
  });
}

export function detectSourceConflicts(points: FinancialPoint[], materiality = 0.01) {
  return tieOutFinancials(points, materiality).filter((result) => !result.passed && result.sourceIds.length >= 2);
}

export function assertNoFutureEvidence<T extends { observedAt: string }>(items: T[], asOf: string): T[] {
  const cutoff = Date.parse(asOf);
  const leaked = items.filter((item) => Date.parse(item.observedAt) > cutoff);
  if (leaked.length) throw new Error(`LOOK_AHEAD_BIAS: ${leaked.length} evidence item(s) observed after as_of`);
  return items;
}

export function dcfValue(input: { freeCashFlows: number[]; discountRate: number; terminalGrowth: number; netDebt: number; dilutedShares: number }) {
  if (input.discountRate <= input.terminalGrowth) throw new Error("discountRate must exceed terminalGrowth");
  if (input.dilutedShares <= 0) throw new Error("dilutedShares must be positive");
  const pvForecast = input.freeCashFlows.reduce((sum, cashFlow, index) => sum + cashFlow / (1 + input.discountRate) ** (index + 1), 0);
  const last = input.freeCashFlows.at(-1) ?? 0;
  const terminalValue = last * (1 + input.terminalGrowth) / (input.discountRate - input.terminalGrowth);
  const pvTerminal = terminalValue / (1 + input.discountRate) ** input.freeCashFlows.length;
  const enterpriseValue = pvForecast + pvTerminal;
  const equityValue = enterpriseValue - input.netDebt;
  return { pvForecast, pvTerminal, enterpriseValue, equityValue, perShare: equityValue / input.dilutedShares };
}

export function calibrationReport(samples: Array<{ confidence: number; correct: boolean }>) {
  if (!samples.length) return { count: 0, brierScore: null, expectedCalibrationError: null };
  const brierScore = samples.reduce((sum, item) => sum + (item.confidence - Number(item.correct)) ** 2, 0) / samples.length;
  const buckets = new Map<number, typeof samples>();
  for (const sample of samples) { const bucket = Math.min(9, Math.floor(sample.confidence * 10)); buckets.set(bucket, [...(buckets.get(bucket) ?? []), sample]); }
  const expectedCalibrationError = [...buckets.values()].reduce((sum, bucket) => { const confidence = bucket.reduce((s, x) => s + x.confidence, 0) / bucket.length; const accuracy = bucket.filter((x) => x.correct).length / bucket.length; return sum + bucket.length / samples.length * Math.abs(confidence - accuracy); }, 0);
  return { count: samples.length, brierScore, expectedCalibrationError };
}
