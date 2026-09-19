import type { ProviderEnvelope, ProviderName } from "../providers/types";

const FIXTURE_ORIGIN = "https://fixtures.alphalens.invalid";

/**
 * Synthetic, non-investable snapshots used only by the local fixture workflow.
 * The reserved .invalid origin makes accidental presentation as a live source obvious.
 */
export function fixtureProviderSnapshots(ticker: string, asOf: string): ProviderEnvelope<unknown>[] {
  const fetchedAt = new Date().toISOString();
  const staleAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const normalizedTicker = ticker.toUpperCase();
  return [
    fixture("sec-edgar", { fixture: true, issuer: `${normalizedTicker} Fixture Issuer`, filings: [{ form: "10-Q", filedAt: "2026-07-01" }], facts: { note: "Synthetic fixture; no SEC request was made." } }, "sec-edgar", normalizedTicker, asOf, fetchedAt, staleAt),
    fixture("issuer-ir", [{ fixture: true, title: `${normalizedTicker} Fixture earnings event`, url: `${FIXTURE_ORIGIN}/issuer-ir/${normalizedTicker}/event`, publishedAt: fetchedAt }], "issuer-ir", normalizedTicker, asOf, fetchedAt, staleAt),
    fixture("alpha-vantage-market", { fixture: true, quote: { symbol: normalizedTicker, price: "123.45", latestTradingDay: "2026-07-01" }, note: "Synthetic fixture; no market-data provider was called." }, "market-quote", normalizedTicker, asOf, fetchedAt, staleAt),
    fixture("alpha-vantage-consensus", { fixture: true, symbol: normalizedTicker, estimates: [], note: "Synthetic fixture; no consensus provider was called." }, "consensus", normalizedTicker, asOf, fetchedAt, staleAt),
  ];
}

function fixture(provider: ProviderName, data: unknown, capability: string, ticker: string, asOf: string, fetchedAt: string, staleAt: string): ProviderEnvelope<unknown> {
  return {
    provider,
    data,
    fetchedAt,
    asOf,
    staleAt,
    freshness: "fresh",
    cache: "miss",
    licenseScope: "Local fixture only — synthetic data; not market data and not for investment use.",
    sourceUrl: `${FIXTURE_ORIGIN}/${capability}/${encodeURIComponent(ticker)}`,
  };
}
