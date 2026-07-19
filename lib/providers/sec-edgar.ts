import { stableId } from "../core/ids";
import { D1ProviderStore } from "./d1-store";
import { resilientJson } from "./resilient-client";

const policy = { timeoutMs: 12_000, maxAttempts: 3, baseBackoffMs: 400, freshForMs: 6 * 3600_000, staleForMs: 7 * 86400_000, circuitThreshold: 5, circuitResetMs: 10 * 60_000, minIntervalMs: 125 };
const licenseScope = "SEC public information; cite SEC; do not imply SEC affiliation";

function headers() {
  const userAgent = process.env.SEC_USER_AGENT?.trim();
  if (!userAgent || !userAgent.includes("@")) throw new Error("SEC_USER_AGENT must identify the application and include a monitored email");
  return { "User-Agent": userAgent, Accept: "application/json", "Accept-Encoding": "gzip, deflate" };
}

export async function secCompany(ticker: string) {
  const store = new D1ProviderStore();
  const mapping = await resilientJson<Record<string, { cik_str: number; ticker: string; title: string }>>({ provider: "sec-edgar", url: "https://www.sec.gov/files/company_tickers.json", cacheKey: "sec:company-tickers", headers: headers(), policy: { ...policy, freshForMs: 86400_000 }, store, licenseScope });
  const company = Object.values(mapping.data).find((row) => row.ticker.toUpperCase() === ticker.toUpperCase());
  if (!company) throw new Error(`SEC CIK not found for ${ticker}`);
  const cik = String(company.cik_str).padStart(10, "0");
  const filings = await resilientJson<Record<string, unknown>>({ provider: "sec-edgar", url: `https://data.sec.gov/submissions/CIK${cik}.json`, cacheKey: `sec:submissions:${cik}`, headers: headers(), policy, store, licenseScope, validate: (v): v is Record<string, unknown> => !!v && typeof v === "object" && "filings" in v });
  const facts = await resilientJson<Record<string, unknown>>({ provider: "sec-edgar", url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, cacheKey: `sec:companyfacts:${cik}`, headers: headers(), policy, store, licenseScope, validate: (v): v is Record<string, unknown> => !!v && typeof v === "object" && "facts" in v });
  return { id: await stableId("sec", cik), ticker: ticker.toUpperCase(), cik, issuerName: company.title, filings, facts };
}

export async function secHealth() {
  try { await secCompany("AAPL"); return { provider: "sec-edgar", status: "healthy" as const }; }
  catch (error) { return { provider: "sec-edgar", status: "degraded" as const, error: error instanceof Error ? error.message : "unknown" }; }
}
