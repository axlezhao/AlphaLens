import { claimNextWebhook, completeWebhook, failWebhook, recoverExpiredWebhooks } from "../../../../lib/outbox/service";
import { deliverWebhook, deliveryFailureMeta } from "../../../../lib/outbox/deliver";
import { isLocalFixtureRequest } from "../../../../lib/runtime/local-fixture";

/**
 * Outbox worker. Authenticated with the shared worker secret (or the loopback
 * fixture seam in local development). Each run recovers expired leases and then
 * claims, delivers and finalises due webhook deliveries. Delivery is
 * at-least-once: consumers deduplicate via the stable event id.
 */
export async function POST(request: Request) {
  const configured = process.env.WORKER_SHARED_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!isLocalFixtureRequest(request) && (!configured || !supplied || supplied !== configured)) return Response.json({ error: { code: "UNAUTHORIZED", message: "Invalid worker credential" } }, { status: 401 });

  const workerId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const limit = Math.min(Number(request.headers.get("x-worker-limit") ?? 10) || 10, 25);

  await recoverExpiredWebhooks();
  const results: Array<{ id: string; status: string }> = [];
  for (let index = 0; index < limit; index++) {
    const delivery = await claimNextWebhook(workerId);
    if (!delivery) break;
    try {
      const result = await deliverWebhook(delivery);
      await completeWebhook(delivery.id, result.status, result.body);
      results.push({ id: delivery.id, status: "delivered" });
    } catch (error) {
      const { retryable } = deliveryFailureMeta(error);
      await failWebhook(delivery.id, error, retryable);
      results.push({ id: delivery.id, status: retryable ? "queued" : "dead_letter" });
      if (!retryable) {
        // Non-retryable failures (unsafe destination, oversized payload) stop
        // the loop to avoid hot-looping on a permanently bad subscription.
        break;
      }
    }
  }
  return Response.json({ data: { claimed: results.length, results }, meta: { workerId, timestamp: new Date().toISOString() } }, { headers: { "cache-control": "no-store" } });
}
