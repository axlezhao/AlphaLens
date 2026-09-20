import { getD1 } from "../../../../../../../db";
import { apiError, audit, requireWorkspaceAccess } from "../../../../../../../lib/auth/context";
import { HttpError } from "../../../../../../../lib/auth/context";
import { requeueWebhookDeadLetter } from "../../../../../../../lib/outbox/service";

/**
 * Re-queues a dead-lettered webhook delivery. Restricted to the controlling
 * owner of the workspace that owns the delivery: only the owning workspace's
 * owner may retry; other roles and other workspaces receive a consistent
 * 403/404 without leaking whether the delivery exists. Every requeue is
 * audited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ deliveryId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { deliveryId } = await params;
    const db = getD1();
    // Derive the owning workspace from the delivery's subscription; never trust
    // a client-supplied workspace.
    const delivery = await db.prepare("SELECT d.id,s.workspace_id AS workspaceId FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id=d.subscription_id WHERE d.id=?").bind(deliveryId).first<{ id: string; workspaceId: string }>();
    if (!delivery) throw new HttpError(404, "DELIVERY_NOT_FOUND", "投递记录不存在");

    // Owner-only. requireWorkspaceAccess returns 403 for non-owners and 404 for
    // foreign workspaces — a uniform, non-enumerating boundary.
    const context = await requireWorkspaceAccess(request, delivery.workspaceId, "owner");

    const requeued = await requeueWebhookDeadLetter(context.workspaceId, deliveryId);
    if (!requeued) throw new HttpError(409, "NOT_DEAD_LETTERED", "该投递不在 dead-letter 状态，无法重投");

    await audit(request, context, "webhook.delivery.requeue", "webhook_delivery", deliveryId);

    return Response.json({ data: { id: deliveryId, status: "queued" }, meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
