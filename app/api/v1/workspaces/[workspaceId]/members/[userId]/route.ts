import { getD1 } from "../../../../../../../db";
import { apiError, auditEventStatement, auditRequestInfo, requireWorkspaceAccess } from "../../../../../../../lib/auth/context";
import { HttpError } from "../../../../../../../lib/auth/context";

const ROLES = new Set(["owner", "editor", "viewer"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ workspaceId: string; userId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { workspaceId, userId } = await params;
    const context = await requireWorkspaceAccess(request, workspaceId, "owner");
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const role = typeof body.role === "string" ? body.role : "";
    if (!ROLES.has(role)) return Response.json({ error: { code: "INVALID_ARGUMENT", message: "role 仅支持 owner、editor 或 viewer", requestId } }, { status: 400 });
    const db = getD1();
    const workspace = await db.prepare("SELECT owner_user_id AS ownerUserId FROM workspaces WHERE id=?").bind(context.workspaceId).first<{ ownerUserId: string }>();
    const member = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(context.workspaceId, userId).first<{ role: string }>();
    if (!member) throw new HttpError(404, "MEMBER_NOT_FOUND", "成员不存在");
    if (workspace?.ownerUserId === userId && role !== "owner") throw new HttpError(409, "CONTROLLING_OWNER_PROTECTED", "控制性 Owner 不能被降级；请先转移 Workspace 所有权");
    const info = await auditRequestInfo(request);
    await db.batch([
      db.prepare("UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?").bind(role, context.workspaceId, userId),
      auditEventStatement(context, info, "workspace.member.update", "workspace_member", `${context.workspaceId}:${userId}`, { previousRole: member.role, role }),
    ]);
    return Response.json({ data: { workspaceId: context.workspaceId, userId, role }, meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ workspaceId: string; userId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { workspaceId, userId } = await params;
    const context = await requireWorkspaceAccess(request, workspaceId, "owner");
    const db = getD1();
    const workspace = await db.prepare("SELECT owner_user_id AS ownerUserId FROM workspaces WHERE id=?").bind(context.workspaceId).first<{ ownerUserId: string }>();
    const member = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(context.workspaceId, userId).first<{ role: string }>();
    if (!member) throw new HttpError(404, "MEMBER_NOT_FOUND", "成员不存在");
    if (workspace?.ownerUserId === userId) throw new HttpError(409, "CONTROLLING_OWNER_PROTECTED", "控制性 Owner 不能被移除；请先转移 Workspace 所有权");
    const info = await auditRequestInfo(request);
    await db.batch([
      db.prepare("DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(context.workspaceId, userId),
      auditEventStatement(context, info, "workspace.member.remove", "workspace_member", `${context.workspaceId}:${userId}`, { previousRole: member.role }),
    ]);
    return Response.json({ data: { workspaceId: context.workspaceId, userId }, meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
