export async function GET() {
  const configured = {
    database: true,
    secEdgar: Boolean(process.env.SEC_USER_AGENT?.includes("@")),
    issuerIr: true,
    marketAndConsensus: Boolean(process.env.ALPHA_VANTAGE_API_KEY && process.env.ALPHA_VANTAGE_LICENSE_ACK === "commercial-or-authorized"),
    asyncWorker: Boolean(process.env.WORKER_SHARED_SECRET),
  };
  const ready = configured.database && configured.secEdgar && configured.asyncWorker;
  return Response.json({ status: ready ? "ok" : "degraded", service: "alphalens-web", version: "0.2.0-beta", mode: "beta", configured, timestamp: new Date().toISOString() }, { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}
