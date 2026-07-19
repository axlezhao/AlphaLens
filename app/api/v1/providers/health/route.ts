import { getD1 } from "../../../../../db";
import { apiError, requireApiContext } from "../../../../../lib/auth/context";

const expected = ["sec-edgar", "issuer-ir", "alpha-vantage-market", "alpha-vantage-consensus"];

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await requireApiContext(request);
    const result = await getD1().prepare("SELECT provider,status,consecutive_failures AS consecutiveFailures,circuit_opened_at AS circuitOpenedAt,last_success_at AS lastSuccessAt,last_failure_at AS lastFailureAt,last_error AS lastError,latency_ms AS latencyMs,checked_at AS checkedAt FROM provider_state").all<Record<string, unknown>>();
    const byProvider = new Map(result.results.map((row: Record<string, unknown>) => [row.provider, row]));
    const providers = expected.map((provider) => byProvider.get(provider) ?? { provider, status: provider.startsWith("alpha-vantage") && (!process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHA_VANTAGE_LICENSE_ACK !== "commercial-or-authorized") ? "disabled" : "unknown", checkedAt: null });
    return Response.json({ data: providers, meta: { requestId, timestamp: new Date().toISOString() } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
