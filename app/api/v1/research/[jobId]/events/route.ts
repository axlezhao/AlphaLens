import { apiError, requireApiContext } from "../../../../../../lib/auth/context";
import { getJob, listEvents } from "../../../../../../lib/research/queue";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request);
    const { jobId } = await params;
    if (!await getJob(context.workspaceId, jobId)) return Response.json({ error: { code: "NOT_FOUND", message: "研究任务不存在", requestId } }, { status: 404 });
    const after = Number(new URL(request.url).searchParams.get("after") ?? request.headers.get("last-event-id") ?? "0") || 0;
    const result = await listEvents(context.workspaceId, jobId, after);
    const body = result.results.map((event: Record<string, unknown>) => `id: ${event.sequence}\nevent: ${event.eventType}\ndata: ${event.payloadJson}\n\n`).join("") + ": reconnect after 1500ms\n\n";
    return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
  } catch (error) { return apiError(error, requestId); }
}
