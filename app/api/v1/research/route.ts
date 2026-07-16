import { DemoResearchProvider } from "../../../../lib/research/demo-adapter";

const tickerPattern = /^[A-Z][A-Z0-9.-]{0,9}$/;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const body = await request.json() as { ticker?: unknown; question?: unknown; asOf?: unknown };
    const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!tickerPattern.test(ticker) || question.length < 8 || question.length > 1200) {
      return Response.json({ error: { code: "INVALID_ARGUMENT", message: "ticker 或研究问题格式不正确", requestId } }, { status: 400 });
    }
    const provider = new DemoResearchProvider();
    const job = await provider.start({ ticker, question, asOf: typeof body.asOf === "string" ? body.asOf : undefined });
    return Response.json({ data: job, meta: { requestId, mode: "demo" } }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "请求体必须是有效 JSON", requestId } }, { status: 400 });
  }
}
