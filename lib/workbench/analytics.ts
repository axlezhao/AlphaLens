export type ImpliedEpsInput = {
  method: "eps";
  price: number;
  currentEps: number;
  terminalPe: number;
  years: number;
};

export type ImpliedRevenueInput = {
  method: "revenue";
  marketCap: number;
  netDebt: number;
  currentRevenue: number;
  terminalEvSales: number;
  years: number;
};

export type ImpliedExpectationsInput = ImpliedEpsInput | ImpliedRevenueInput;

export function reverseImpliedExpectations(input: ImpliedExpectationsInput) {
  requirePositive(input.years, "years");
  if (input.method === "eps") {
    requirePositive(input.price, "price");
    requirePositive(input.currentEps, "currentEps");
    requirePositive(input.terminalPe, "terminalPe");
    const terminalEps = input.price / input.terminalPe;
    const cagr = Math.pow(terminalEps / input.currentEps, 1 / input.years) - 1;
    return { method: input.method, impliedCagr: cagr, terminalValue: terminalEps, terminalMetric: "EPS", formula: "(price / terminal P/E / current EPS)^(1 / years) - 1" } as const;
  }
  requirePositive(input.marketCap, "marketCap");
  requirePositive(input.currentRevenue, "currentRevenue");
  requirePositive(input.terminalEvSales, "terminalEvSales");
  const enterpriseValue = input.marketCap + input.netDebt;
  if (enterpriseValue <= 0) throw new Error("enterpriseValue must be positive");
  const terminalRevenue = enterpriseValue / input.terminalEvSales;
  const cagr = Math.pow(terminalRevenue / input.currentRevenue, 1 / input.years) - 1;
  return { method: input.method, impliedCagr: cagr, terminalValue: terminalRevenue, terminalMetric: "Revenue", enterpriseValue, formula: "((market cap + net debt) / terminal EV/Sales / current revenue)^(1 / years) - 1" } as const;
}

export type BiasObservation = { biases: string[]; confidence: number; outcomeScore: number | null };

export function cognitiveBiasStats(reviews: BiasObservation[]) {
  const counts = new Map<string, { count: number; scored: number; scoreTotal: number; confidenceTotal: number }>();
  for (const review of reviews) {
    for (const bias of new Set(review.biases.map((item) => item.trim()).filter(Boolean))) {
      const entry = counts.get(bias) ?? { count: 0, scored: 0, scoreTotal: 0, confidenceTotal: 0 };
      entry.count += 1;
      entry.confidenceTotal += review.confidence;
      if (review.outcomeScore !== null) { entry.scored += 1; entry.scoreTotal += review.outcomeScore; }
      counts.set(bias, entry);
    }
  }
  return [...counts.entries()].map(([bias, value]) => ({
    bias,
    count: value.count,
    averageConfidence: value.confidenceTotal / value.count,
    averageOutcomeScore: value.scored ? value.scoreTotal / value.scored : null,
  })).sort((a, b) => b.count - a.count || a.bias.localeCompare(b.bias));
}

function requirePositive(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}
