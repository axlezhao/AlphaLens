import { claimNextDeletion, completeDeletion, executeDeletion, failDeletion } from "../../../../lib/account/deletion";
import { isLocalFixtureRequest } from "../../../../lib/runtime/local-fixture";

/**
 * Deletion worker. Authenticated with the shared worker secret (or the
 * loopback fixture seam locally). Runs the soft-delete for due deletion
 * requests; execution is idempotent so a crashed worker retrying the same
 * request cannot double-delete or corrupt related workspace data.
 */
export async function POST(request: Request) {
  const configured = process.env.WORKER_SHARED_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!isLocalFixtureRequest(request) && (!configured || !supplied || supplied !== configured)) return Response.json({ error: { code: "UNAUTHORIZED", message: "Invalid worker credential" } }, { status: 401 });

  const workerId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const limit = Math.min(Number(request.headers.get("x-worker-limit") ?? 5) || 5, 20);
  const results: Array<{ id: string; status: string }> = [];
  for (let index = 0; index < limit; index++) {
    const claim = await claimNextDeletion();
    if (!claim) break;
    try {
      await executeDeletion(claim.userId);
      await completeDeletion(claim.id);
      results.push({ id: claim.id, status: "completed" });
    } catch (error) {
      await failDeletion(claim.id, error);
      results.push({ id: claim.id, status: "rejected" });
    }
  }
  return Response.json({ data: { claimed: results.length, results }, meta: { workerId, timestamp: new Date().toISOString() } }, { headers: { "cache-control": "no-store" } });
}
