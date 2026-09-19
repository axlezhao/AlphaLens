import { runNextJobs } from "../../../../lib/research/runner";
import { isLocalFixtureRequest } from "../../../../lib/runtime/local-fixture";

export async function POST(request: Request) {
  const configured = process.env.WORKER_SHARED_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!isLocalFixtureRequest(request) && (!configured || !supplied || supplied !== configured)) return Response.json({ error: { code: "UNAUTHORIZED", message: "Invalid worker credential" } }, { status: 401 });
  const workerId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const results = await runNextJobs(workerId, 3);
  return Response.json({ data: { claimed: results.length, results }, meta: { workerId, timestamp: new Date().toISOString() } }, { headers: { "cache-control": "no-store" } });
}
