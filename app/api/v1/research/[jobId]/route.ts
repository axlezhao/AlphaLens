import { apiError, audit, requireApiContext } from "../../../../../lib/auth/context";
import { cancelJob, getJob } from "../../../../../lib/research/queue";
import { parseResearchSnapshot, safeJsonParse } from "../../../../../lib/research/snapshot";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request);
    const { jobId } = await params;
    const job = await getJob(context.workspaceId, jobId);
    if (!job) return Response.json({ error: { code: "NOT_FOUND", message: "研究任务不存在", requestId } }, { status: 404 });
    return Response.json({ data: normalize(job), meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request, "editor");
    const { jobId } = await params;
    const job = await cancelJob(context.workspaceId, jobId);
    if (!job) return Response.json({ error: { code: "NOT_CANCELLABLE", message: "任务不存在或已结束", requestId } }, { status: 409 });
    await audit(request, context, "research.cancel", "research_job", jobId);
    return Response.json({ data: normalize(job), meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}

function normalize(job: Record<string, unknown>) {
  return { ...job, snapshot: parseResearchSnapshot(safeJsonParse(job.snapshotJson)), snapshotJson: undefined };
}
