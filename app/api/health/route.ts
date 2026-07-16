export async function GET() {
  return Response.json({
    status: "ok",
    service: "alphalens-web",
    version: "0.1.0",
    mode: process.env.ALPHALENS_MODE ?? "demo",
    timestamp: new Date().toISOString(),
  }, { headers: { "cache-control": "no-store" } });
}
