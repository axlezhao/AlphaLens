import { getChatGPTUser } from "../../app/chatgpt-auth";
import { getD1 } from "../../db";
import { stableId } from "../core/ids";
import { localFixtureUser } from "../runtime/local-fixture";

export type WorkspaceRole = "owner" | "editor" | "viewer";
export type AuthContext = { userId: string; email: string; workspaceId: string; role: WorkspaceRole };

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function requireApiContext(request: Request, minimumRole: WorkspaceRole = "viewer"): Promise<AuthContext> {
  const user = await getChatGPTUser() ?? localFixtureUser(request);
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "请先使用 ChatGPT 登录");

  const db = getD1();
  const now = new Date().toISOString();
  const normalizedEmail = user.email.trim().toLowerCase();
  const userId = await stableId("usr", normalizedEmail);
  const defaultWorkspaceId = await stableId("wsp", normalizedEmail);
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO users (id,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?)").bind(userId, normalizedEmail, user.displayName, now, now),
    db.prepare("INSERT OR IGNORE INTO workspaces (id,name,owner_user_id,created_at,updated_at) VALUES (?,?,?,?,?)").bind(defaultWorkspaceId, `${user.displayName} Workspace`, userId, now, now),
    db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id,user_id,role,created_at) VALUES (?,?,?,?)").bind(defaultWorkspaceId, userId, "owner", now),
  ]);

  const requestedWorkspace = request.headers.get("x-alphalens-workspace") ?? defaultWorkspaceId;
  const member = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(requestedWorkspace, userId).first<{ role: WorkspaceRole }>();
  if (!member || roleRank(member.role) < roleRank(minimumRole)) throw new HttpError(403, "FORBIDDEN", "无此 Workspace 权限");
  return { userId, email: normalizedEmail, workspaceId: requestedWorkspace, role: member.role };
}

export async function audit(request: Request, context: Partial<AuthContext>, action: string, resourceType: string, resourceId?: string, metadata: Record<string, unknown> = {}) {
  const db = getD1();
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const ipHash = await stableId("ip", ip);
  await db.prepare("INSERT INTO audit_logs (id,workspace_id,actor_user_id,action,resource_type,resource_id,request_id,ip_hash,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), context.workspaceId ?? null, context.userId ?? null, action, resourceType, resourceId ?? null, requestId, ipHash, JSON.stringify(metadata), new Date().toISOString()).run();
}

export function apiError(error: unknown, requestId = crypto.randomUUID()): Response {
  if (error instanceof HttpError) return Response.json({ error: { code: error.code, message: error.message, requestId } }, { status: error.status });
  console.error("api_error", { requestId, error });
  return Response.json({ error: { code: "INTERNAL", message: "服务暂时不可用", requestId } }, { status: 500 });
}

function roleRank(role: WorkspaceRole) { return { viewer: 1, editor: 2, owner: 3 }[role]; }
