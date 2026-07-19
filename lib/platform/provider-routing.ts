import { getD1 } from "../../db";
import { routeProviders } from "./analytics";
import type { ProviderRequest, ProviderRoute } from "./contracts";

const fallbackRoutes: ProviderRoute[] = [
  { provider: "sec-edgar", category: "Company Filings & IR", capability: "filings", priority: 10, enabled: true, licenseScope: "public-sec-fair-access", allowedUse: "research,display", freshnessSeconds: 21600 },
  { provider: "issuer-ir", category: "Company Filings & IR", capability: "issuer-events", priority: 20, enabled: true, licenseScope: "issuer-publication-link-and-excerpt", allowedUse: "research,display", freshnessSeconds: 21600 },
  { provider: "alpha-vantage-market", category: "Market Data & Estimates", capability: "market-quote", priority: 30, enabled: true, licenseScope: "byo-commercial-or-authorized", allowedUse: "research,display", freshnessSeconds: 900 },
  { provider: "alpha-vantage-consensus", category: "Market Data & Estimates", capability: "consensus", priority: 30, enabled: true, licenseScope: "byo-commercial-or-authorized", allowedUse: "research", freshnessSeconds: 43200 },
];

export async function resolveProviderPlan(workspaceId: string, requests: ProviderRequest[]) {
  const rows = await getD1().prepare("SELECT pr.provider,pr.category,pr.capability,pr.priority,pr.enabled,pr.license_scope AS licenseScope,pr.allowed_use AS allowedUse,pr.max_latency_ms AS maxLatencyMs,pr.max_cost_usd AS maxCostUsd,pr.freshness_seconds AS freshnessSeconds,ps.status AS health,ps.latency_ms AS latencyMs FROM provider_routes pr LEFT JOIN provider_state ps ON ps.provider=pr.provider WHERE pr.workspace_id=?").bind(workspaceId).all<ProviderRoute>();
  const routes = rows.results.length ? rows.results : fallbackRoutes;
  return requests.map((request) => ({ request, ...routeProviders(routes, request) }));
}
