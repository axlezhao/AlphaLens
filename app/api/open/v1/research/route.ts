import { waitUntil } from "cloudflare:workers";
import { apiError, audit, HttpError } from "../../../../../lib/auth/context";
import { requireApiClient } from "../../../../../lib/platform/api-auth";
import { startWorkflowRun } from "../../../../../lib/platform/orchestrator";
import { runNextJobs } from "../../../../../lib/research/runner";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiClient(request, "research:write");
    const input = await request.json() as Record<string, unknown>;
    if (typeof input.question !== "string" || input.question.trim().length < 8 || input.question.length > 1200) throw new HttpError(400, "INVALID_QUESTION", "question 需要 8–1200 个字符");
    const asOf = typeof input.asOf === "string" && !Number.isNaN(Date.parse(input.asOf)) ? new Date(input.asOf).toISOString() : new Date().toISOString();
    const data = await startWorkflowRun(context, { workflowVersionId: typeof input.workflowVersionId === "string" ? input.workflowVersionId : null, ticker: typeof input.ticker === "string" ? input.ticker : null, question: input.question.trim(), asOf, idempotencyKey: request.headers.get("idempotency-key") });
    const result = data as Record<string, unknown> | null;
    await audit(request, context, "open_api.workflow.run", "workflow_run", typeof result?.id === "string" ? result.id : undefined, { clientId: context.clientId });
    waitUntil(runNextJobs(`open-api:${requestId}`, 3).catch((error) => console.error("open_api_worker_failed", { requestId, error })));
    return Response.json({ data, meta: { requestId } }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
