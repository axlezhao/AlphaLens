import { createMigratedD1, type D1Shim } from "./d1-shim";
import { contentHash } from "../../lib/core/ids";

/**
 * Dual-tenant test harness. Identity switches happen by repointing the local
 * fixture environment variables — the exact mechanism the A2 local workflow
 * already exposes — so tests exercise the production authentication path
 * (loopback + dual flag + `.invalid` account) instead of a private backdoor.
 * This file is only ever loaded by `node --test`; nothing here is reachable
 * from a deployed worker.
 */

declare global {
  var __TEST_CLOUDFLARE_ENV__: Record<string, unknown> | undefined;
  var __TEST_NEXT_HEADERS__: Map<string, string> | undefined;
}

export const OWNER_A = "owner-a@local.invalid";
export const EDITOR_A = "editor-a@local.invalid";
export const VIEWER_A = "viewer-a@local.invalid";
export const OWNER_B = "owner-b@local.invalid";

export const WORKER_SECRET = "test-worker-secret";

export type Tenant = { email: string; userId: string; workspaceId: string };

let db: D1Shim;

export function installHarness() {
  db = createMigratedD1();
  globalThis.__TEST_CLOUDFLARE_ENV__ = { DB: db };
  globalThis.__TEST_NEXT_HEADERS__ = new Map();
  process.env.ALPHALENS_LOCAL_DEVELOPMENT = "true";
  process.env.ALPHALENS_FIXTURE_MODE = "true";
  process.env.ALPHALENS_LOCAL_MANUAL_WORKER = "true";
  process.env.WORKER_SHARED_SECRET = WORKER_SECRET;
  return db;
}

export function teardownHarness() {
  db?.close();
  globalThis.__TEST_CLOUDFLARE_ENV__ = undefined;
  globalThis.__TEST_NEXT_HEADERS__ = undefined;
  delete process.env.ALPHALENS_LOCAL_DEVELOPMENT;
  delete process.env.ALPHALENS_FIXTURE_MODE;
  delete process.env.ALPHALENS_LOCAL_MANUAL_WORKER;
  delete process.env.ALPHALENS_LOCAL_AUTH_EMAIL;
  delete process.env.ALPHALENS_LOCAL_AUTH_NAME;
  delete process.env.WORKER_SHARED_SECRET;
}

export function getDb() {
  return db;
}

/** Repoints the fixture identity. The next request is authenticated as `email`. */
export function asUser(email: string) {
  process.env.ALPHALENS_LOCAL_AUTH_EMAIL = email;
  process.env.ALPHALENS_LOCAL_AUTH_NAME = email.split("@")[0];
}

export function apiRequest(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; host?: string } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  return new Request(`http://${init.host ?? "localhost"}${path}`, { method: init.method ?? "GET", headers, body });
}

export async function responseBody(response: Response) {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

/**
 * Provisions a tenant by running one authenticated request through the real
 * API context (which creates the user, the deterministic default workspace
 * and the owner membership), then returns the derived ids.
 */
export async function provisionTenant(email: string): Promise<Tenant> {
  asUser(email);
  const { requireApiContext } = await import("../../lib/auth/context");
  const context = await requireApiContext(apiRequest("/api/v1/workbench"));
  return { email, userId: context.userId, workspaceId: context.workspaceId };
}

export async function addMember(workspaceId: string, email: string, role: "owner" | "editor" | "viewer") {
  asUser(email);
  const { requireAuthenticatedUser } = await import("../../lib/auth/context");
  const user = await requireAuthenticatedUser(apiRequest("/api/v1/workbench"));
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,created_at) VALUES (?,?,?,?)").bind(workspaceId, user.userId, role, now).run();
  return user.userId;
}

export async function seedApiClient(tenant: Tenant, token: string, scopes: string[]) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO api_clients (id,workspace_id,name,key_prefix,secret_hash,scopes_json,created_by_user_id,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)")
    .bind(id, tenant.workspaceId, "test-client", token.slice(0, 8), await contentHash(token), JSON.stringify(scopes), tenant.userId, now, now)
    .run();
  return id;
}

export async function auditRows(action?: string) {
  const sql = action ? "SELECT * FROM audit_logs WHERE action=? ORDER BY created_at" : "SELECT * FROM audit_logs ORDER BY created_at";
  const statement = db.prepare(sql);
  const rows = action ? await statement.bind(action).all<Record<string, unknown>>() : await statement.all<Record<string, unknown>>();
  return rows.results;
}

export async function defaultPortfolioId(workspaceId: string) {
  const row = await db.prepare("SELECT id FROM portfolios WHERE workspace_id=? ORDER BY created_at LIMIT 1").bind(workspaceId).first<{ id: string }>();
  return row?.id ?? null;
}
