import { getD1 } from "../../../../../db";
import { apiError, audit, requireApiContext } from "../../../../../lib/auth/context";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request, "owner");
    const now = new Date().toISOString(); const id = crypto.randomUUID();
    await getD1().batch([
      getD1().prepare("INSERT INTO deletion_requests (id,user_id,status,requested_at) VALUES (?,?,'requested',?)").bind(id, context.userId, now),
      getD1().prepare("UPDATE users SET deletion_requested_at=?,updated_at=? WHERE id=?").bind(now, now, context.userId),
    ]);
    await audit(request, context, "account.deletion_requested", "deletion_request", id);
    return Response.json({ data: { id, status: "requested", requestedAt: now }, meta: { requestId } }, { status: 202 });
  } catch (error) { return apiError(error, requestId); }
}
