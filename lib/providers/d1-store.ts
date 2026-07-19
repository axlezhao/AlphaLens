import { getD1 } from "../../db";
import type { CacheRecord, ProviderName, ProviderStore } from "./types";

export class D1ProviderStore implements ProviderStore {
  async getCache(key: string): Promise<CacheRecord | null> {
    const row = await getD1().prepare("SELECT body_json,fetched_at,fresh_until,stale_until,etag,last_modified FROM source_cache WHERE cache_key=?").bind(key).first<Record<string, string | null>>();
    return row ? { body: JSON.parse(row.body_json!), fetchedAt: row.fetched_at!, freshUntil: row.fresh_until!, staleUntil: row.stale_until!, etag: row.etag ?? undefined, lastModified: row.last_modified ?? undefined } : null;
  }
  async putCache(key: string, provider: ProviderName, value: CacheRecord) {
    await getD1().prepare("INSERT INTO source_cache (cache_key,provider,body_json,content_type,fetched_at,fresh_until,stale_until,etag,last_modified) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET body_json=excluded.body_json,fetched_at=excluded.fetched_at,fresh_until=excluded.fresh_until,stale_until=excluded.stale_until,etag=excluded.etag,last_modified=excluded.last_modified")
      .bind(key, provider, JSON.stringify(value.body), "application/json", value.fetchedAt, value.freshUntil, value.staleUntil, value.etag ?? null, value.lastModified ?? null).run();
  }
  async getCircuit(provider: ProviderName) { return getD1().prepare("SELECT consecutive_failures AS consecutiveFailures,circuit_opened_at AS circuitOpenedAt FROM provider_state WHERE provider=?").bind(provider).first<{ consecutiveFailures: number; circuitOpenedAt: string | null }>(); }
  async recordSuccess(provider: ProviderName, latencyMs: number) { const now = new Date().toISOString(); await getD1().prepare("INSERT INTO provider_state (provider,status,consecutive_failures,last_success_at,latency_ms,checked_at) VALUES (?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET status='healthy',consecutive_failures=0,circuit_opened_at=NULL,last_success_at=excluded.last_success_at,latency_ms=excluded.latency_ms,checked_at=excluded.checked_at,last_error=NULL").bind(provider, "healthy", 0, now, latencyMs, now).run(); }
  async recordFailure(provider: ProviderName, message: string) { const now = new Date().toISOString(); await getD1().prepare("INSERT INTO provider_state (provider,status,consecutive_failures,circuit_opened_at,last_failure_at,last_error,checked_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET status=CASE WHEN consecutive_failures+1>=5 THEN 'open' ELSE 'degraded' END,consecutive_failures=consecutive_failures+1,circuit_opened_at=CASE WHEN consecutive_failures+1>=5 THEN excluded.circuit_opened_at ELSE circuit_opened_at END,last_failure_at=excluded.last_failure_at,last_error=excluded.last_error,checked_at=excluded.checked_at").bind(provider, "degraded", 1, now, now, message.slice(0, 500), now).run(); }
}
