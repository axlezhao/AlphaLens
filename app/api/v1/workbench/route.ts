import { waitUntil } from "cloudflare:workers";
import { apiError, audit, requireApiContext } from "../../../../lib/auth/context";
import { runNextJobs } from "../../../../lib/research/runner";
import { getWorkbench, mutateWorkbench } from "../../../../lib/workbench/service";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try { const context = await requireApiContext(request); const ticker = new URL(request.url).searchParams.get("ticker")?.toUpperCase(); const data = await getWorkbench(context, ticker); return Response.json({ data, meta: { requestId } }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return apiError(error, requestId); }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request, "editor"); const input = await request.json() as Record<string, unknown>; const data = await mutateWorkbench(context, input);
    const result = data as Record<string, unknown>;
    await audit(request, context, `workbench.${String(input.action ?? "unknown")}`, "workbench", typeof result.id === "string" ? result.id : undefined, { ticker: input.ticker });
    if (input.action === "earnings.create") waitUntil(runNextJobs(`earnings:${requestId}`, 1).catch((error) => console.error("earnings_worker_failed", { requestId, error })));
    return Response.json({ data, meta: { requestId } }, { status: input.action === "earnings.create" ? 202 : 200, headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
