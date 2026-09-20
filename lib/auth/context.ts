import { getChatGPTUser } from "../../app/chatgpt-auth";
import { getD1 } from "../../db";
import { stableId } from "../core/ids";
import { localFixtureUser } from "../runtime/local-fixture";
import { sanitizeAuditMetadata } from "./audit-metadata";

export type WorkspaceRole = "owner" | "editor" | "viewer";
export type AuthenticatedUser = { userId: string; email: string; displayName: string };
export type AuthContext = { userId: string; email: string; workspaceId: string; role: WorkspaceRole };
export type AuditRequestInfo = { requestId: string; ipHash: string | null };

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function roleRank(role: WorkspaceRole) {
  return ROLE_RANK[role];
}

/**
 * Resolves the request identity from the hosting platform or, only on loopback
 * with both local development flags and a `.invalid` account, the fixture
 * identity. Never trusts client-supplied user or role parameters.
 */
export async function requireAuthenticatedUser(request: Request): Promise<AuthenticatedUser> {
  const user = await getChatGPTUser() ?? localFixtureUser(request);
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "请先使用 ChatGPT 登录");
  const normalizedEmail = user.email.trim().toLowerCase();
  const userId = await stableId("usr", normalizedEmail);
  const now = new Date().toISOString();
  await getD1().prepare("INSERT OR IGNORE INTO users (id,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?)").bind(userId, normalizedEmail, user.displayName, now, now).run();
  const deleted = await getD1().prepare("SELECT deleted_at AS deletedAt FROM users WHERE id=?").bind(userId).first<{ deletedAt: string | null }>();
  if (deleted?.deletedAt) throw new HttpError(401, "ACCOUNT_DELETED", "账户已删除，无法继续访问");
  return { userId, email: normalizedEmail, displayName: user.displayName };
}

export async function resolveDefaultWorkspaceForUser(user: Pick<AuthenticatedUser, "email">): Promise<string> {
  return stableId("wsp", user.email.trim().toLowerCase());
}

export async function listAccessibleWorkspaces(user: AuthenticatedUser) {
  const defaultWorkspaceId = await resolveDefaultWorkspaceForUser(user);
  const rows = await getD1().prepare("SELECT w.id,w.name,w.owner_user_id AS ownerUserId,m.role,m.created_at AS joinedAt FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? ORDER BY m.created_at").bind(user.userId).all<{ id: string; name: string; ownerUserId: string; role: WorkspaceRole; joinedAt: string }>();
  return rows.results.map((row) => ({ workspaceId: row.id, name: row.name, role: row.role, isControllingOwner: row.ownerUserId === user.userId, isDefault: row.id === defaultWorkspaceId, joinedAt: row.joinedAt }));
}

async function findMembership(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const row = await getD1().prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?").bind(workspaceId, userId).first<{ role: WorkspaceRole }>();
  return row?.role ?? null;
}

/**
 * Workspace access for URL-addressed resources. Unknown and foreign workspaces
 * both return 404 so callers cannot enumerate other tenants; an authenticated
 * member with an insufficient role gets a consistent 403.
 */
export async function requireWorkspaceAccess(request: Request, workspaceId: string, minimumRole: WorkspaceRole = "viewer"): Promise<AuthContext> {
  const user = await requireAuthenticatedUser(request);
  const role = await findMembership(workspaceId, user.userId);
  if (!role) {
    await auditDenied(request, { userId: user.userId, workspaceId }, "workspace", workspaceId, "WORKSPACE_NOT_ACCESSIBLE");
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace 不存在");
  }
  if (roleRank(role) < roleRank(minimumRole)) {
    await auditDenied(request, { userId: user.userId, workspaceId }, "workspace", workspaceId, "FORBIDDEN");
    throw new HttpError(403, "FORBIDDEN", "无此 Workspace 权限");
  }
  return { userId: user.userId, email: user.email, workspaceId, role };
}

/**
 * Portfolio access is derived from the portfolio's own workspace membership,
 * never from a client-supplied workspace or owner field. Unknown and
 * cross-workspace portfolio ids are both reported as 404.
 */
export async function requirePortfolioAccess(request: Request, portfolioId: string, minimumRole: WorkspaceRole = "viewer"): Promise<AuthContext> {
  const user = await requireAuthenticatedUser(request);
  const portfolio = await getD1().prepare("SELECT workspace_id AS workspaceId FROM portfolios WHERE id=?").bind(portfolioId).first<{ workspaceId: string }>();
  const role = portfolio ? await findMembership(portfolio.workspaceId, user.userId) : null;
  if (!portfolio || !role) {
    await auditDenied(request, { userId: user.userId, workspaceId: portfolio?.workspaceId }, "portfolio", portfolioId, "PORTFOLIO_NOT_ACCESSIBLE");
    throw new HttpError(404, "PORTFOLIO_NOT_FOUND", "组合不存在");
  }
  if (roleRank(role) < roleRank(minimumRole)) {
    await auditDenied(request, { userId: user.userId, workspaceId: portfolio.workspaceId }, "portfolio", portfolioId, "FORBIDDEN");
    throw new HttpError(403, "FORBIDDEN", "无此 Workspace 权限");
  }
  return { userId: user.userId, email: user.email, workspaceId: portfolio.workspaceId, role };
}

/**
 * Backwards-compatible entry point: authenticates, provisions the user's
 * deterministic default workspace (the local fixture workflow depends on it)
 * and honours `x-alphalens-workspace` only after the membership lookup
 * succeeds. The header is a selection hint, never an authorization grant.
 */
export async function requireApiContext(request: Request, minimumRole: WorkspaceRole = "viewer"): Promise<AuthContext> {
  const user = await requireAuthenticatedUser(request);
  const db = getD1();
  const now = new Date().toISOString();
  const defaultWorkspaceId = await resolveDefaultWorkspaceForUser(user);
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO workspaces (id,name,owner_user_id,created_at,updated_at) VALUES (?,?,?,?,?)").bind(defaultWorkspaceId, `${user.displayName} Workspace`, user.userId, now, now),
    db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id,user_id,role,created_at) VALUES (?,?,?,?)").bind(defaultWorkspaceId, user.userId, "owner", now),
  ]);
  const requestedWorkspace = request.headers.get("x-alphalens-workspace") ?? defaultWorkspaceId;
  const role = await findMembership(requestedWorkspace, user.userId);
  if (!role) {
    await auditDenied(request, { userId: user.userId, workspaceId: requestedWorkspace }, "workspace", requestedWorkspace, "WORKSPACE_NOT_ACCESSIBLE");
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace 不存在");
  }
  if (roleRank(role) < roleRank(minimumRole)) {
    await auditDenied(request, { userId: user.userId, workspaceId: requestedWorkspace }, "workspace", requestedWorkspace, "FORBIDDEN");
    throw new HttpError(403, "FORBIDDEN", "无此 Workspace 权限");
  }
  return { userId: user.userId, email: user.email, workspaceId: requestedWorkspace, role };
}

export async function auditRequestInfo(request: Request): Promise<AuditRequestInfo> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  return { requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(), ipHash: await stableId("ip", ip) };
}

export function auditEventStatement(context: Partial<AuthContext>, info: AuditRequestInfo, action: string, resourceType: string, resourceId: string | null, metadata: Record<string, unknown> = {}) {
  return getD1().prepare("INSERT INTO audit_logs (id,workspace_id,actor_user_id,action,resource_type,resource_id,request_id,ip_hash,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), context.workspaceId ?? null, context.userId ?? null, action, resourceType, resourceId, info.requestId, info.ipHash, JSON.stringify(sanitizeAuditMetadata(metadata)), new Date().toISOString());
}

export async function audit(request: Request, context: Partial<AuthContext>, action: string, resourceType: string, resourceId?: string, metadata: Record<string, unknown> = {}) {
  const info = await auditRequestInfo(request);
  await getD1().prepare("INSERT INTO audit_logs (id,workspace_id,actor_user_id,action,resource_type,resource_id,request_id,ip_hash,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), context.workspaceId ?? null, context.userId ?? null, action, resourceType, resourceId ?? null, info.requestId, info.ipHash, JSON.stringify(sanitizeAuditMetadata(metadata)), new Date().toISOString()).run();
}

/**
 * Denial audits are best effort: the rejection itself is already the safe
 * outcome, so a failed audit write must not alter the 401/403/404 response.
 * Only authenticated denials are recorded; unauthenticated traffic carries no
 * attributable actor and is handled by platform-level abuse controls.
 */
export async function auditDenied(request: Request, context: { userId?: string; workspaceId?: string }, resourceType: string, resourceId: string | null, outcome: string) {
  try {
    await audit(request, { userId: context.userId, workspaceId: context.workspaceId }, "access.denied", resourceType, resourceId ?? undefined, { outcome });
  } catch (error) {
    console.error("audit_denied_write_failed", { resourceType, resourceId, outcome, error });
  }
}

export function apiError(error: unknown, requestId = crypto.randomUUID()): Response {
  if (error instanceof HttpError) return Response.json({ error: { code: error.code, message: error.message, requestId } }, { status: error.status });
  console.error("api_error", { requestId, error });
  return Response.json({ error: { code: "INTERNAL", message: "服务暂时不可用", requestId } }, { status: 500 });
}
