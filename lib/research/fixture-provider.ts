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

/**
 * Synthetic SEC XBRL `companyfacts` document for the local fixture workflow.
 * Values are round, obviously fake numbers; accession numbers use a reserved
 * all-zero filer prefix and filing links resolve to the `.invalid` origin.
 */
export function fixtureCompanyFacts(ticker: string, asOf: string): ProviderEnvelope<unknown> {
  const fetchedAt = new Date().toISOString();
  const staleAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const normalizedTicker = ticker.toUpperCase();
  const annual = { start: "2025-01-01", end: "2025-12-31", accn: "0000000000-26-000001", fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-20", frame: "CY2025" };
  const quarter = { start: "2026-04-01", end: "2026-06-30", accn: "0000000000-26-000002", fy: 2026, fp: "Q2", form: "10-Q", filed: "2026-07-30", frame: "CY2026Q2" };
  const cover = { end: "2026-07-24", accn: quarter.accn, fy: 2026, fp: "Q2", form: "10-Q", filed: quarter.filed };
  const usd = (annualValue: number, quarterValue?: number) => ({ units: { USD: quarterValue === undefined ? [{ ...annual, val: annualValue }] : [{ ...annual, val: annualValue }, { ...quarter, val: quarterValue }] } });
  return {
    provider: "sec-edgar",
    data: {
      fixture: true,
      cik: 0,
      entityName: `${normalizedTicker} Fixture Issuer`,
      facts: {
        dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ ...cover, val: 1_000_000_000 }] } } },
        "us-gaap": {
          Revenues: usd(40_000_000_000, 11_000_000_000),
          NetIncomeLoss: usd(8_000_000_000, 2_200_000_000),
          EarningsPerShareDiluted: { units: { "USD/shares": [{ ...annual, val: 8 }, { ...quarter, val: 2.2 }] } },
          NetCashProvidedByUsedInOperatingActivities: usd(10_000_000_000),
        },
      },
    },
    fetchedAt,
    asOf,
    staleAt,
    freshness: "fresh",
    cache: "miss",
    licenseScope: "Local fixture only — synthetic data; not market data and not for investment use.",
    sourceUrl: `${FIXTURE_ORIGIN}/sec-companyfacts/${encodeURIComponent(normalizedTicker)}`,
  };
}

export const FIXTURE_SEC_ARCHIVE_ORIGIN = `${FIXTURE_ORIGIN}/sec-archive`;
