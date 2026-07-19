import { waitUntil } from "cloudflare:workers";
import { apiError, audit, requireApiContext } from "../../../../lib/auth/context";
import { getPlatform, mutatePlatform } from "../../../../lib/platform/service";
import { runNextJobs } from "../../../../lib/research/runner";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request);
    const runId = new URL(request.url).searchParams.get("runId");
    const data = await getPlatform(context, runId);
    return Response.json({ data, meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request, "editor");
    const input = await request.json() as Record<string, unknown>;
    const data = await mutatePlatform(context, input) as Record<string, unknown>;
    await audit(request, context, `platform.${String(input.action ?? "unknown")}`, "research_platform", typeof data.id === "string" ? data.id : undefined, { action: input.action });
    if (input.action === "workflow.run") waitUntil(runNextJobs(`platform:${requestId}`, 3).catch((error) => console.error("platform_worker_failed", { requestId, error })));
    return Response.json({ data, meta: { requestId } }, { status: input.action === "workflow.run" ? 202 : 200, headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
