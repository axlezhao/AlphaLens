import { apiError, requireApiContext } from "../../../../../../lib/auth/context";
import { getWorkflowRun } from "../../../../../../lib/platform/orchestrator";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request);
    const data = await getWorkflowRun(context.workspaceId, (await params).runId);
    if (!data) return Response.json({ error: { code: "RUN_NOT_FOUND", message: "Workflow Run 不存在", requestId } }, { status: 404 });
    return Response.json({ data, meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
