import { apiError, audit, requireApiContext } from "../../../../lib/auth/context";
import { enqueueResearch } from "../../../../lib/research/queue";

const tickerPattern = /^[A-Z][A-Z0-9.-]{0,9}$/;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request, "editor");
    const body = await request.json() as { ticker?: unknown; question?: unknown; asOf?: unknown };
    const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const asOf = typeof body.asOf === "string" && !Number.isNaN(Date.parse(body.asOf)) ? new Date(body.asOf).toISOString() : new Date().toISOString();
    if (!tickerPattern.test(ticker) || question.length < 8 || question.length > 1200) return Response.json({ error: { code: "INVALID_ARGUMENT", message: "ticker 或研究问题格式不正确", requestId } }, { status: 400 });
    if (Date.parse(asOf) > Date.now() + 60_000) return Response.json({ error: { code: "INVALID_AS_OF", message: "as_of 不能在未来", requestId } }, { status: 400 });
    const suppliedKey = request.headers.get("idempotency-key")?.trim();
    if (suppliedKey && suppliedKey.length > 200) return Response.json({ error: { code: "INVALID_IDEMPOTENCY_KEY", message: "幂等键过长", requestId } }, { status: 400 });
    const job = await enqueueResearch(context, { ticker, question, asOf, idempotencyKey: suppliedKey });
    await audit(request, context, "research.enqueue", "research_job", String(job?.id), { ticker, asOf });
    return Response.json({ data: normalizeJob(job), meta: { requestId, mode: "beta", pollAfterMs: 1500 } }, { status: 202, headers: { "cache-control": "no-store", location: `/api/v1/research/${job?.id}` } });
  } catch (error) { return apiError(error, requestId); }
}

function normalizeJob(job: Record<string, unknown> | null) { return job ? { ...job, snapshot: typeof job.snapshotJson === "string" ? JSON.parse(job.snapshotJson) : null, snapshotJson: undefined } : null; }
