import { apiError, audit, requireAuthenticatedUser } from "../../../../../lib/auth/context";
import { DeletionBlockedError, requestDeletion } from "../../../../../lib/account/deletion";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const confirmation = typeof body.confirmation === "string" ? body.confirmation : "";
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    try {
      const result = await requestDeletion(user.userId, { confirmation, reason });
      await audit(request, { userId: user.userId }, "account.deletion_requested", "deletion_request", result.id, { status: result.status });
      return Response.json({ data: { id: result.id, status: result.status, scheduledFor: result.scheduledFor }, meta: { requestId } }, { status: 202, headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof DeletionBlockedError) {
        return Response.json({ error: { code: error.code, message: error.message, requestId } }, { status: 409 });
      }
      throw error;
    }
  } catch (error) { return apiError(error, requestId); }
}
