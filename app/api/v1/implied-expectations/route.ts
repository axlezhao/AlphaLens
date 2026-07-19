import { apiError, requireApiContext } from "../../../../lib/auth/context";
import { reverseImpliedExpectations, type ImpliedExpectationsInput } from "../../../../lib/workbench/analytics";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try { await requireApiContext(request); const input = await request.json() as ImpliedExpectationsInput; const data = reverseImpliedExpectations(input); return Response.json({ data: { ...data, impliedCagrPercent: data.impliedCagr * 100 }, meta: { requestId, warning: "这是基于用户输入假设的代数反推，不是目标价或投资建议。" } }); }
  catch (error) { return apiError(error, requestId); }
}
