import { apiError, audit, requireApiContext } from "../../../../lib/auth/context";
import { getPortfolioWorkbench, mutatePortfolio } from "../../../../lib/portfolio/service";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try { const context = await requireApiContext(request); const portfolioId = new URL(request.url).searchParams.get("portfolioId"); const data = await getPortfolioWorkbench(context, portfolioId); return Response.json({ data, meta: { requestId } }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return apiError(error, requestId); }
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const context = await requireApiContext(request, "editor"); const input = await request.json() as Record<string, unknown>; const data = await mutatePortfolio(context, input);
    await audit(request, context, `portfolio.${String(input.action ?? "unknown")}`, "portfolio", typeof data.id === "string" ? data.id : typeof input.portfolioId === "string" ? input.portfolioId : undefined, { executionPolicy: "conditions_only_no_order_execution" });
    return Response.json({ data, meta: { requestId, executionPolicy: "conditions_only_no_order_execution" } });
  } catch (error) { return apiError(error, requestId); }
}
