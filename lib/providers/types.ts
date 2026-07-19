export type ProviderName = "sec-edgar" | "issuer-ir" | "alpha-vantage-market" | "alpha-vantage-consensus";
export type Freshness = "fresh" | "stale";

export type ProviderEnvelope<T> = {
  provider: ProviderName;
  data: T;
  fetchedAt: string;
  asOf: string;
  staleAt: string;
  freshness: Freshness;
  cache: "hit" | "miss" | "stale-fallback";
  licenseScope: string;
  sourceUrl: string;
};

export type CacheRecord = { body: unknown; fetchedAt: string; freshUntil: string; staleUntil: string; etag?: string; lastModified?: string };
export interface ProviderStore {
  getCache(key: string): Promise<CacheRecord | null>;
  putCache(key: string, provider: ProviderName, value: CacheRecord): Promise<void>;
  getCircuit(provider: ProviderName): Promise<{ consecutiveFailures: number; circuitOpenedAt: string | null } | null>;
  recordSuccess(provider: ProviderName, latencyMs: number): Promise<void>;
  recordFailure(provider: ProviderName, message: string): Promise<void>;
}

export type ResiliencePolicy = {
  timeoutMs: number;
  maxAttempts: number;
  baseBackoffMs: number;
  freshForMs: number;
  staleForMs: number;
  circuitThreshold: number;
  circuitResetMs: number;
  minIntervalMs?: number;
};
