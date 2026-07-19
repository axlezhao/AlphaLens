import { contentHash } from "../core/ids";
import type { ProviderEnvelope } from "./types";
import { D1ProviderStore } from "./d1-store";

export type IrEvent = { title: string; url: string; publishedAt?: string; eventAt?: string };

export async function issuerIrEvents(feedUrl: string, allowedBaseUrl: string): Promise<ProviderEnvelope<IrEvent[]>> {
  const feed = new URL(feedUrl);
  const base = new URL(allowedBaseUrl);
  if (feed.protocol !== "https:" || feed.hostname !== base.hostname) throw new Error("IR feed must be HTTPS and match the issuer-approved IR hostname");
  const store = new D1ProviderStore();
  const cacheKey = `ir:${await contentHash(feed.toString())}`;
  const cached = await store.getCache(cacheKey);
  if (cached && Date.parse(cached.freshUntil) > Date.now()) return { provider: "issuer-ir", data: cached.body as IrEvent[], fetchedAt: cached.fetchedAt, asOf: cached.fetchedAt, staleAt: cached.freshUntil, freshness: "fresh", cache: "hit", licenseScope: "Issuer-published public IR materials; links and excerpts only", sourceUrl: feed.toString() };
  const circuit = await store.getCircuit("issuer-ir");
  if (circuit && circuit.consecutiveFailures >= 5 && circuit.circuitOpenedAt && Date.parse(circuit.circuitOpenedAt) + 15 * 60_000 > Date.now()) {
    if (cached && Date.parse(cached.staleUntil) > Date.now()) return { provider: "issuer-ir", data: cached.body as IrEvent[], fetchedAt: cached.fetchedAt, asOf: cached.fetchedAt, staleAt: cached.freshUntil, freshness: "stale", cache: "stale-fallback", licenseScope: "Issuer-published public IR materials; links and excerpts only", sourceUrl: feed.toString() };
    throw new Error("issuer-ir circuit is open");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(feed, { headers: { "User-Agent": process.env.IR_USER_AGENT ?? "AlphaLens/0.2 research@example.com", Accept: "application/rss+xml, application/atom+xml, text/calendar, text/html" }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`issuer-ir HTTP ${response.status}`);
      const text = await response.text();
      const fetchedAt = new Date().toISOString();
      const events = extractEvents(text, base);
      const freshUntil = new Date(Date.now() + 6 * 3600_000).toISOString();
      await store.putCache(cacheKey, "issuer-ir", { body: events, fetchedAt, freshUntil, staleUntil: new Date(Date.now() + 7 * 86400_000).toISOString(), etag: response.headers.get("etag") ?? undefined, lastModified: response.headers.get("last-modified") ?? undefined });
      await store.recordSuccess("issuer-ir", 0);
      return { provider: "issuer-ir", data: events, fetchedAt, asOf: fetchedAt, staleAt: freshUntil, freshness: "fresh", cache: "miss", licenseScope: "Issuer-published public IR materials; links and excerpts only", sourceUrl: feed.toString() };
    } catch (error) { lastError = error; if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt)); }
  }
  await store.recordFailure("issuer-ir", lastError instanceof Error ? lastError.message : String(lastError));
  if (cached && Date.parse(cached.staleUntil) > Date.now()) return { provider: "issuer-ir", data: cached.body as IrEvent[], fetchedAt: cached.fetchedAt, asOf: cached.fetchedAt, staleAt: cached.freshUntil, freshness: "stale", cache: "stale-fallback", licenseScope: "Issuer-published public IR materials; links and excerpts only", sourceUrl: feed.toString() };
  throw lastError;
}

export function extractEvents(document: string, base: URL): IrEvent[] {
  const items = document.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  return items.slice(0, 50).map((item) => {
    const title = decodeEntities(match(item, /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) ?? "Untitled IR item");
    const rawLink = match(item, /<link[^>]*href=["']([^"']+)/i) ?? match(item, /<link[^>]*>([^<]+)/i) ?? base.toString();
    const url = new URL(rawLink.trim(), base);
    if (url.hostname !== base.hostname) throw new Error("IR item redirects outside approved issuer hostname");
    const publishedAt = match(item, /<(?:pubDate|published|updated)[^>]*>([^<]+)/i);
    return { title, url: url.toString(), publishedAt: publishedAt ? new Date(publishedAt).toISOString() : undefined };
  });
}

function match(value: string, pattern: RegExp) { return value.match(pattern)?.[1]?.trim(); }
function decodeEntities(value: string) { return value.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim(); }
export async function irContentHash(events: IrEvent[]) { return contentHash(events); }
