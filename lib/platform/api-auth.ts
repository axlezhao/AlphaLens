import { getD1 } from "../../db";
import type { AuthContext } from "../auth/context";
import { HttpError } from "../auth/context";
import { contentHash } from "../core/ids";

export type ApiContext = AuthContext & { clientId: string; scopes: string[] };
export async function requireApiClient(request: Request, requiredScope: string): Promise<ApiContext> {
  const authorization = request.headers.get("authorization") ?? ""; if (!authorization.startsWith("Bearer alp_")) throw new HttpError(401, "INVALID_API_KEY", "需要 AlphaLens API Key"); const token = authorization.slice(7); const hash = await contentHash(token); const now = new Date().toISOString();
  const client = await getD1().prepare("SELECT ac.id,ac.workspace_id AS workspaceId,ac.created_by_user_id AS userId,ac.scopes_json AS scopesJson,u.email FROM api_clients ac JOIN users u ON u.id=ac.created_by_user_id WHERE ac.secret_hash=? AND ac.enabled=1 AND ac.revoked_at IS NULL AND (ac.expires_at IS NULL OR ac.expires_at>?)").bind(hash, now).first<{ id: string; workspaceId: string; userId: string; scopesJson: string; email: string }>(); if (!client) throw new HttpError(401, "INVALID_API_KEY", "API Key 无效、已过期或已撤销"); const scopes = parseScopes(client.scopesJson); if (!scopes.includes(requiredScope) && !scopes.includes("*")) throw new HttpError(403, "INSUFFICIENT_SCOPE", `API Key 缺少 ${requiredScope} scope`); await getD1().prepare("UPDATE api_clients SET last_used_at=?,updated_at=? WHERE id=?").bind(now, now, client.id).run(); return { clientId: client.id, workspaceId: client.workspaceId, userId: client.userId, email: client.email, role: "editor", scopes };
}
function parseScopes(value: string) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }
