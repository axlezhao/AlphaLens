import { getD1 } from "../../db";
import { contentHash, stableId } from "../core/ids";
import type { ProviderEnvelope } from "../providers/types";

export async function saveSource(workspaceId: string, envelope: ProviderEnvelope<unknown>, title: string, publisher: string, sourceType: "sec" | "ir" | "market" | "consensus") {
  const db = getD1(); const now = new Date().toISOString();
  const hash = await contentHash({ provider: envelope.provider, url: envelope.sourceUrl, asOf: envelope.asOf, data: envelope.data });
  const id = await stableId("src", `${workspaceId}:${hash}`);
  await db.prepare("INSERT OR IGNORE INTO sources (id,workspace_id,provider,source_type,title,canonical_url,publisher,accessed_at,as_of,stale_at,is_stale,license_scope,content_hash,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, workspaceId, envelope.provider, sourceType, title, envelope.sourceUrl, publisher, envelope.fetchedAt, envelope.asOf, envelope.staleAt, envelope.freshness === "stale" ? 1 : 0, envelope.licenseScope, hash, JSON.stringify({ cache: envelope.cache }), now, now).run();
  return id;
}

export async function saveVersionedEvidence(input: { workspaceId: string; securityId: string; sourceId: string; naturalKey: string; kind: "FACT" | "EXPECTATION" | "INFERENCE" | "USER_VIEW" | "UNVERIFIED"; claim: string; value?: unknown; observedAt: string; asOf: string; confidence: number }) {
  const db = getD1(); const now = new Date().toISOString();
  const logicalId = await stableId("evl", `${input.workspaceId}:${input.securityId}:${input.naturalKey}`);
  const hash = await contentHash({ claim: input.claim, value: input.value, asOf: input.asOf, sourceId: input.sourceId });
  const duplicate = await db.prepare("SELECT id FROM evidence WHERE workspace_id=? AND content_hash=?").bind(input.workspaceId, hash).first<{ id: string }>();
  if (duplicate) return duplicate.id;
  const previous = await db.prepare("SELECT id,version FROM evidence WHERE logical_id=? ORDER BY version DESC LIMIT 1").bind(logicalId).first<{ id: string; version: number }>();
  const version = (previous?.version ?? 0) + 1;
  const id = await stableId("evd", `${logicalId}:v${version}`);
  await db.prepare("INSERT INTO evidence (id,logical_id,version,workspace_id,security_id,source_id,kind,claim,value_json,observed_at,as_of,confidence,supersedes_id,content_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, logicalId, version, input.workspaceId, input.securityId, input.sourceId, input.kind, input.claim, input.value === undefined ? null : JSON.stringify(input.value), input.observedAt, input.asOf, input.confidence, previous?.id ?? null, hash, now, now).run();
  return id;
}

export async function saveVersionedThesis(input: { workspaceId: string; securityId: string; naturalKey: string; statement: string; status: string; conviction: number; falsifiers: unknown[]; asOf: string }) {
  const db = getD1(); const now = new Date().toISOString();
  const logicalId = await stableId("thl", `${input.workspaceId}:${input.securityId}:${input.naturalKey}`);
  const previous = await db.prepare("SELECT id,version FROM theses WHERE logical_id=? ORDER BY version DESC LIMIT 1").bind(logicalId).first<{ id: string; version: number }>();
  const version = (previous?.version ?? 0) + 1;
  const id = await stableId("ths", `${logicalId}:v${version}`);
  await db.prepare("INSERT INTO theses (id,logical_id,version,workspace_id,security_id,statement,status,conviction,falsifiers_json,supersedes_id,as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, logicalId, version, input.workspaceId, input.securityId, input.statement, input.status, input.conviction, JSON.stringify(input.falsifiers), previous?.id ?? null, input.asOf, now, now).run();
  return id;
}
