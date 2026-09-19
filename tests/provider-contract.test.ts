import test from "node:test";
import assert from "node:assert/strict";
import { resilientJson } from "../lib/providers/resilient-client.ts";
import { fixtureProviderSnapshots } from "../lib/research/fixture-provider.ts";
import type { CacheRecord, ProviderName, ProviderStore } from "../lib/providers/types.ts";

class MemoryStore implements ProviderStore {
  cache = new Map<string, CacheRecord>(); failures = 0; successes = 0;
  async getCache(key: string) { return this.cache.get(key) ?? null; }
  async putCache(key: string, provider: ProviderName, value: CacheRecord) { void provider; this.cache.set(key, value); }
  async getCircuit(provider: ProviderName) { void provider; return { consecutiveFailures: this.failures, circuitOpenedAt: this.failures >= 2 ? new Date().toISOString() : null }; }
  async recordSuccess() { this.successes += 1; this.failures = 0; }
  async recordFailure() { this.failures += 1; }
}

const policy = { timeoutMs: 1000, maxAttempts: 1, baseBackoffMs: 1, freshForMs: 1000, staleForMs: 1000, circuitThreshold: 2, circuitResetMs: 60_000 };

test("provider validates its contract and caches successful data", async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({ ok: true });
  const store = new MemoryStore();
  const result = await resilientJson<{ ok: boolean }>({ provider: "sec-edgar", url: "https://example.test/data", cacheKey: "x", policy, store, licenseScope: "test", validate: (v): v is { ok: boolean } => !!v && typeof v === "object" && "ok" in v });
  assert.equal(result.cache, "miss"); assert.equal(store.successes, 1); assert.equal(store.cache.size, 1);
});

test("stale cache is returned when upstream fails", async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { throw new Error("offline"); };
  const store = new MemoryStore(); store.cache.set("x", { body: { ok: true }, fetchedAt: new Date(Date.now() - 5000).toISOString(), freshUntil: new Date(Date.now() - 1000).toISOString(), staleUntil: new Date(Date.now() + 10000).toISOString() });
  const result = await resilientJson<{ ok: boolean }>({ provider: "sec-edgar", url: "https://example.test/data", cacheKey: "x", policy, store, licenseScope: "test" });
  assert.equal(result.cache, "stale-fallback"); assert.equal(result.freshness, "stale");
});

test("local fixture provider creates synthetic provenance without a network request", () => {
  const sources = fixtureProviderSnapshots("nvda", "2026-09-19T12:00:00.000Z");
  assert.equal(sources.length, 4);
  assert.ok(sources.every((source) => source.sourceUrl.includes("fixtures.alphalens.invalid")));
  assert.ok(sources.every((source) => source.licenseScope.startsWith("Local fixture only")));
});
