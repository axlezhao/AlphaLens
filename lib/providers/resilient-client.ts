import type { ProviderEnvelope, ProviderName, ProviderStore, ResiliencePolicy } from "./types";

const lastRequestAt = new Map<ProviderName, number>();

export class ProviderError extends Error {
  code: "DISABLED" | "CIRCUIT_OPEN" | "TIMEOUT" | "UPSTREAM" | "INVALID_RESPONSE";
  constructor(code: "DISABLED" | "CIRCUIT_OPEN" | "TIMEOUT" | "UPSTREAM" | "INVALID_RESPONSE", message: string) { super(message); this.code = code; }
}

export async function resilientJson<T>(input: {
  provider: ProviderName;
  url: string;
  cacheKey: string;
  headers?: HeadersInit;
  policy: ResiliencePolicy;
  store: ProviderStore;
  licenseScope: string;
  validate?: (value: unknown) => value is T;
}): Promise<ProviderEnvelope<T>> {
  const now = Date.now();
  const cached = await input.store.getCache(input.cacheKey);
  if (cached && Date.parse(cached.freshUntil) > now) return envelope(input, cached.body as T, cached.fetchedAt, cached.freshUntil, "hit");

  const circuit = await input.store.getCircuit(input.provider);
  if (circuit && circuit.consecutiveFailures >= input.policy.circuitThreshold && circuit.circuitOpenedAt && Date.parse(circuit.circuitOpenedAt) + input.policy.circuitResetMs > now) {
    if (cached && Date.parse(cached.staleUntil) > now) return envelope(input, cached.body as T, cached.fetchedAt, cached.freshUntil, "stale-fallback");
    throw new ProviderError("CIRCUIT_OPEN", `${input.provider} circuit is open`);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < input.policy.maxAttempts; attempt++) {
    try {
      await throttle(input.provider, input.policy.minIntervalMs ?? 0);
      const started = Date.now();
      const response = await fetch(input.url, { headers: input.headers, signal: AbortSignal.timeout(input.policy.timeoutMs) });
      if (!response.ok) throw new ProviderError("UPSTREAM", `${input.provider} HTTP ${response.status}`);
      const value: unknown = await response.json();
      if (input.validate && !input.validate(value)) throw new ProviderError("INVALID_RESPONSE", `${input.provider} response contract failed`);
      const fetchedAt = new Date().toISOString();
      const freshUntil = new Date(Date.now() + input.policy.freshForMs).toISOString();
      const staleUntil = new Date(Date.now() + input.policy.freshForMs + input.policy.staleForMs).toISOString();
      await input.store.putCache(input.cacheKey, input.provider, { body: value, fetchedAt, freshUntil, staleUntil, etag: response.headers.get("etag") ?? undefined, lastModified: response.headers.get("last-modified") ?? undefined });
      await input.store.recordSuccess(input.provider, Date.now() - started);
      return envelope(input, value as T, fetchedAt, freshUntil, "miss");
    } catch (error) {
      lastError = error;
      if (attempt + 1 < input.policy.maxAttempts) await new Promise((resolve) => setTimeout(resolve, input.policy.baseBackoffMs * 2 ** attempt + Math.floor(Math.random() * 100)));
    }
  }
  const message = lastError instanceof Error ? lastError.message : "unknown provider failure";
  await input.store.recordFailure(input.provider, message);
  if (cached && Date.parse(cached.staleUntil) > Date.now()) return envelope(input, cached.body as T, cached.fetchedAt, cached.freshUntil, "stale-fallback");
  if (lastError instanceof DOMException && lastError.name === "TimeoutError") throw new ProviderError("TIMEOUT", message);
  throw lastError instanceof ProviderError ? lastError : new ProviderError("UPSTREAM", message);
}

function envelope<T>(input: { provider: ProviderName; url: string; licenseScope: string }, data: T, fetchedAt: string, staleAt: string, cache: "hit" | "miss" | "stale-fallback"): ProviderEnvelope<T> {
  return { provider: input.provider, data, fetchedAt, asOf: fetchedAt, staleAt, freshness: Date.parse(staleAt) > Date.now() ? "fresh" : "stale", cache, licenseScope: input.licenseScope, sourceUrl: redactKey(input.url) };
}

async function throttle(provider: ProviderName, minIntervalMs: number) {
  const wait = Math.max(0, (lastRequestAt.get(provider) ?? 0) + minIntervalMs - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt.set(provider, Date.now());
}

function redactKey(url: string) { const parsed = new URL(url); if (parsed.searchParams.has("apikey")) parsed.searchParams.set("apikey", "REDACTED"); return parsed.toString(); }
