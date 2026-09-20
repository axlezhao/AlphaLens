import { getD1 } from "../../db";
import { webhookDeliveryInsert } from "./service";

/**
 * Business-event coupling. When a research job finalises, the corresponding
 * outbox deliveries are prepared here and appended to the *same* batch as the
 * job's status update, so the business change and the notification cannot
 * diverge (the outbox survives a crash that follows a successful commit).
 */

export const RESEARCH_COMPLETED_EVENT = "research.completed";
export const RESEARCH_FAILED_EVENT = "research.failed";

export async function buildResearchOutboxDeliveries(workspaceId: string, jobId: string, ticker: string, status: "succeeded" | "failed") {
  const eventType = status === "succeeded" ? RESEARCH_COMPLETED_EVENT : RESEARCH_FAILED_EVENT;
  const subs = await getD1().prepare("SELECT id,endpoint_url AS endpointUrl FROM webhook_subscriptions WHERE workspace_id=? AND enabled=1 AND event_types_json LIKE ?").bind(workspaceId, `%"${eventType}"%`).all<{ id: string }>();
  return Promise.all(subs.results.map((sub) => webhookDeliveryInsert({
    workspaceId,
    subscriptionId: sub.id,
    eventId: `${jobId}:${eventType}`,
    eventType,
    payload: { jobId, ticker, status },
    idempotencyKey: `${jobId}:${eventType}`,
  })));
}
