import { claimNextDeletion, completeDeletion, executeDeletion, failDeletion, hasSharedControllingOwnership, recoverExpiredDeletions } from "../../../../lib/account/deletion";
import { isLocalFixtureRequest } from "../../../../lib/runtime/local-fixture";

/**
 * Deletion worker. Authenticated with the shared worker secret (or the
 * loopback fixture seam locally). Recovers expired leases, then claims and runs
 * the soft-delete for due deletion requests. Execution is idempotent so a
 * crashed worker retrying the same request cannot double-delete or corrupt
 * related workspace data. Ownership is re-checked immediately before deletion
 * so a transfer that happened after the request aborts rather than deletes a
 * shared workspace.
 */
export async function POST(request: Request) {
  const configured = process.env.WORKER_SHARED_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!isLocalFixtureRequest(request) && (!configured || !supplied || supplied !== configured)) return Response.json({ error: { code: "UNAUTHORIZED", message: "Invalid worker credential" } }, { status: 401 });

  const workerId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const limit = Math.min(Number(request.headers.get("x-worker-limit") ?? 5) || 5, 20);
  await recoverExpiredDeletions();
  const results: Array<{ id: string; status: string }> = [];
  for (let index = 0; index < limit; index++) {
    const claim = await claimNextDeletion(workerId);
    if (!claim) break;
    try {
      // Ownership re-check: a transfer after the request must abort, not delete.
      if (await hasSharedControllingOwnership(claim.userId)) {
        await failDeletion(claim.id, claim.leaseToken, new Error("User gained controlling ownership after request"), false);
        results.push({ id: claim.id, status: "rejected" });
        continue;
      }
      const executed = await executeDeletion(claim);
      const completed = executed ? await completeDeletion(claim.id, claim.leaseToken) : false;
      results.push({ id: claim.id, status: completed ? "completed" : "stale" });
    } catch (error) {
      const outcome = await failDeletion(claim.id, claim.leaseToken, error, true);
      results.push({ id: claim.id, status: outcome });
    }
  }
  return Response.json({ data: { claimed: results.length, results }, meta: { workerId, timestamp: new Date().toISOString() } }, { headers: { "cache-control": "no-store" } });
}
