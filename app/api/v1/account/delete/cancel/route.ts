import { apiError, audit, requireAuthenticatedUser } from "../../../../../../lib/auth/context";
import { cancelDeletion } from "../../../../../../lib/account/deletion";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const user = await requireAuthenticatedUser(request);
    const result = await cancelDeletion(user.userId);
    if (!result) return Response.json({ error: { code: "NO_OPEN_REQUEST", message: "没有待处理的删除请求", requestId } }, { status: 404 });
    await audit(request, { userId: user.userId }, "account.deletion_cancelled", "deletion_request", undefined, { status: result.status });
    return Response.json({ data: { status: result.status }, meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
