import { D1ProviderStore } from "./d1-store";
import { ProviderError, resilientJson } from "./resilient-client";

const store = new D1ProviderStore();
const policy = { timeoutMs: 10_000, maxAttempts: 3, baseBackoffMs: 800, freshForMs: 15 * 60_000, staleForMs: 24 * 3600_000, circuitThreshold: 5, circuitResetMs: 15 * 60_000, minIntervalMs: 1000 };
const licenseScope = "BYO Alpha Vantage agreement; server-side display only; no raw-data redistribution";

function config() {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  const acknowledged = process.env.ALPHA_VANTAGE_LICENSE_ACK === "commercial-or-authorized";
  if (!key || !acknowledged) throw new ProviderError("DISABLED", "Alpha Vantage requires API key and explicit commercial-or-authorized license acknowledgement");
  return key;
}

export function marketQuote(ticker: string) {
  const url = new URL("https://www.alphavantage.co/query");
  url.search = new URLSearchParams({ function: "GLOBAL_QUOTE", symbol: ticker, apikey: config() }).toString();
  return resilientJson<Record<string, unknown>>({ provider: "alpha-vantage-market", url: url.toString(), cacheKey: `av:quote:${ticker}`, policy, store, licenseScope, validate: validAlphaResponse });
}

export function consensusEstimates(ticker: string) {
  const url = new URL("https://www.alphavantage.co/query");
  url.search = new URLSearchParams({ function: "EARNINGS_ESTIMATES", symbol: ticker, apikey: config() }).toString();
  return resilientJson<Record<string, unknown>>({ provider: "alpha-vantage-consensus", url: url.toString(), cacheKey: `av:consensus:${ticker}`, policy: { ...policy, freshForMs: 12 * 3600_000, staleForMs: 7 * 86400_000 }, store, licenseScope, validate: validAlphaResponse });
}

function validAlphaResponse(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  return !("Error Message" in object || "Information" in object || "Note" in object);
}

export async function alphaVantageHealth() {
  if (!process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHA_VANTAGE_LICENSE_ACK !== "commercial-or-authorized") return [{ provider: "alpha-vantage-market", status: "disabled" }, { provider: "alpha-vantage-consensus", status: "disabled" }];
  const results = await Promise.allSettled([marketQuote("AAPL"), consensusEstimates("AAPL")]);
  return results.map((result, index) => ({ provider: index === 0 ? "alpha-vantage-market" : "alpha-vantage-consensus", status: result.status === "fulfilled" ? "healthy" : "degraded", error: result.status === "rejected" ? String(result.reason) : undefined }));
}
