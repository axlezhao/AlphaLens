import { getD1 } from "../../../../db";
import { apiError, auditEventStatement, auditRequestInfo, listAccessibleWorkspaces, requireAuthenticatedUser } from "../../../../lib/auth/context";
import { contentHash, stableId } from "../../../../lib/core/ids";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const user = await requireAuthenticatedUser(request);
    const workspaces = await listAccessibleWorkspaces(user);
    return Response.json({ data: { workspaces }, meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) return Response.json({ error: { code: "INVALID_ARGUMENT", message: "Workspace 名称需要 1–80 个字符", requestId } }, { status: 400 });
    const db = getD1();
    const now = new Date().toISOString();
    const id = await stableId("wsp", `custom:${await contentHash(`${user.userId}:${crypto.randomUUID()}`)}`);
    const info = await auditRequestInfo(request);
    await db.batch([
      db.prepare("INSERT INTO workspaces (id,name,owner_user_id,created_at,updated_at) VALUES (?,?,?,?,?)").bind(id, name, user.userId, now, now),
      auditEventStatement({ userId: user.userId, workspaceId: id, email: user.email, role: "owner" }, info, "workspace.create", "workspace", id, { name }),
    ]);
    return Response.json({ data: { workspaceId: id, name, role: "owner" }, meta: { requestId } }, { status: 201, headers: { "cache-control": "no-store", location: `/api/v1/workspaces/${id}/members` } });
  } catch (error) { return apiError(error, requestId); }
}
