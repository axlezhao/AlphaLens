import { getD1 } from "../../../../../../db";
import { apiError, auditEventStatement, auditRequestInfo, requireWorkspaceAccess } from "../../../../../../lib/auth/context";
import { HttpError } from "../../../../../../lib/auth/context";

const ROLES = new Set(["owner", "editor", "viewer"]);

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { workspaceId } = await params;
    const context = await requireWorkspaceAccess(request, workspaceId, "owner");
    const members = await getD1().prepare("SELECT m.user_id AS userId,m.role,m.created_at AS joinedAt,u.display_name AS displayName,CASE WHEN w.owner_user_id=m.user_id THEN 1 ELSE 0 END AS isControllingOwner FROM workspace_members m JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=? ORDER BY m.created_at").bind(context.workspaceId).all<Record<string, unknown>>();
    return Response.json({ data: { members: members.results }, meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { workspaceId } = await params;
    const context = await requireWorkspaceAccess(request, workspaceId, "owner");
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const role = typeof body.role === "string" ? body.role : "";
    if (!userId || userId.length > 200) return Response.json({ error: { code: "INVALID_ARGUMENT", message: "userId 不能为空", requestId } }, { status: 400 });
    if (!ROLES.has(role)) return Response.json({ error: { code: "INVALID_ARGUMENT", message: "role 仅支持 owner、editor 或 viewer", requestId } }, { status: 400 });
    const db = getD1();
    const target = await db.prepare("SELECT id FROM users WHERE id=?").bind(userId).first<{ id: string }>();
    if (!target) throw new HttpError(404, "USER_NOT_FOUND", "用户不存在；仅可添加已存在的用户");
    const existing = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(context.workspaceId, userId).first<{ role: string }>();
    if (existing) throw new HttpError(409, "MEMBER_ALREADY_EXISTS", "用户已是当前 Workspace 成员");
    const info = await auditRequestInfo(request);
    await db.batch([
      db.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,created_at) VALUES (?,?,?,?)").bind(context.workspaceId, userId, role, new Date().toISOString()),
      auditEventStatement(context, info, "workspace.member.add", "workspace_member", `${context.workspaceId}:${userId}`, { role }),
    ]);
    return Response.json({ data: { workspaceId: context.workspaceId, userId, role }, meta: { requestId } }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
