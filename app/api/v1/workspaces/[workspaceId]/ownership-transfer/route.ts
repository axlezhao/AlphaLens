import { getD1 } from "../../../../../../db";
import { apiError, auditEventStatement, auditRequestInfo, requireWorkspaceAccess } from "../../../../../../lib/auth/context";
import { HttpError } from "../../../../../../lib/auth/context";

/**
 * Transfers controlling ownership of a Workspace to one of its existing
 * members. Only the current controlling owner may transfer. The target must
 * already be a member of this Workspace (cross-workspace and unknown users are
 * rejected without leaking other tenants), and the transfer is atomic: the
 * target is promoted to `owner` and `workspaces.owner_user_id` is updated in a
 * single batch so no intermediate "controlling owner is not an owner member"
 * state can exist. The previous controlling owner stays an ordinary `owner`
 * member.
 */
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const { workspaceId } = await params;
    const context = await requireWorkspaceAccess(request, workspaceId, "owner");
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const targetUserId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!targetUserId || targetUserId.length > 200) {
      return Response.json({ error: { code: "INVALID_ARGUMENT", message: "userId 不能为空", requestId } }, { status: 400 });
    }

    const db = getD1();
    const workspace = await db.prepare("SELECT owner_user_id AS ownerUserId FROM workspaces WHERE id=?").bind(context.workspaceId).first<{ ownerUserId: string }>();
    if (!workspace) throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace 不存在");

    if (workspace.ownerUserId === targetUserId) {
      throw new HttpError(409, "ALREADY_CONTROLLING_OWNER", "该用户已是当前 Workspace 的控制性 Owner");
    }

    // Target membership is the only source of truth; client role/owner fields are ignored.
    const target = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(context.workspaceId, targetUserId).first<{ role: string }>();
    if (!target) throw new HttpError(409, "TARGET_NOT_MEMBER", "目标用户必须是当前 Workspace 的成员");

    const info = await auditRequestInfo(request);
    const now = new Date().toISOString();
    // Atomic: promote the target to owner, then repoint ownership. The
    // `workspaces_transfer_requires_member` trigger re-verifies membership and
    // the role promotion is guarded by `workspace_members_role_update_guard`.
    await db.batch([
      db.prepare("UPDATE workspace_members SET role='owner' WHERE workspace_id=? AND user_id=?").bind(context.workspaceId, targetUserId),
      db.prepare("UPDATE workspaces SET owner_user_id=?, updated_at=? WHERE id=?").bind(targetUserId, now, context.workspaceId),
      auditEventStatement(context, info, "workspace.ownership.transfer", "workspace", context.workspaceId, { previousOwnerUserId: workspace.ownerUserId, newOwnerUserId: targetUserId }),
    ]);
    return Response.json({ data: { workspaceId: context.workspaceId, previousOwnerUserId: workspace.ownerUserId, newOwnerUserId: targetUserId }, meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
