import { apiError } from "../../../../lib/auth/context";
import { syncWorkflowRuns } from "../../../../lib/platform/orchestrator";
import { drainWebhookDeliveries } from "../../../../lib/platform/webhooks";
import { runNextJobs } from "../../../../lib/research/runner";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const expected = process.env.WORKER_SHARED_SECRET;
    if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) return Response.json({ error: { code: "UNAUTHORIZED", message: "worker token 无效", requestId } }, { status: 401 });
    const researchJobs = await runNextJobs(`platform-worker:${requestId}`, 6);
    const workflowRuns = await syncWorkflowRuns(20);
    const webhooks = await drainWebhookDeliveries(30);
    return Response.json({ data: { researchJobs, workflowRuns, webhooks }, meta: { requestId, executedAt: new Date().toISOString() } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
