import { getD1 } from "../../db";
import { HttpError, type AuthContext } from "../auth/context";
import { contentHash, stableId } from "../core/ids";
import type { ProviderName } from "../providers/types";
import { secFactNaturalKey, type NormalizationIssue, type SecFactCitation, type SecMetricKey, type SecPeriodicity } from "./normalize";
import { missingCapabilities, parseResearchSnapshot, safeJsonParse, type EvidenceRef, type ResearchSnapshot } from "./snapshot";

/**
 * Deterministic evidence draft: the first reviewable research artifact built
 * from a completed job's snapshot, without any model call. It only arranges
 * what the job already collected; every value links to an evidence row, and
 * every judgement section (thesis, scenarios, falsifiers) is left empty for a
 * person to author. Built from the snapshot alone, so the same job always
 * yields the same content and checksum.
 */

export const DRAFT_GENERATOR = { name: "deterministic-evidence-draft", version: "1" } as const;
export const DRAFT_DISCLAIMER = "Research draft for review only. Not investment advice. No orders are placed. Verify every source, timestamp and number independently.";

export type DraftFact = {
  evidenceId: string;
  key: SecMetricKey;
  label: string;
  periodicity: SecPeriodicity;
  value: number;
  unit: string;
  periodStart: string | null;
  periodEnd: string;
  citation: SecFactCitation;
};

export type DraftEvidenceLink = { evidenceId: string; key: string; provider: ProviderName; sourceUrl: string };

export type DraftUnknown = {
  code: "metric_missing" | "ambiguous_value" | "stale_period" | "uncited_fact" | "missing_capability" | "stale_source" | "provider_failure" | "normalization_failed";
  message: string;
};

export type ResearchDraftContent = {
  schemaVersion: 1;
  kind: "evidence_draft";
  generator: typeof DRAFT_GENERATOR;
  jobId: string;
  sourceMode: "live" | "fixture";
  identity: { ticker: string; securityId: string; entityName: string | null; cik: string | null };
  time: { asOf: string; filingCutoff: string; snapshotGeneratedAt: string };
  question: string;
  evidenceSummary: {
    sources: Array<{ provider: ProviderName; sourceUrl: string; fetchedAt: string; freshness: "fresh" | "stale" }>;
    counts: { sources: number; staleSources: number; missingCapabilities: number; facts: number; unknowns: number };
  };
  /** Reported SEC values only. */
  facts: DraftFact[];
  /** Market data is kept apart from issuer-reported facts. */
  marketData: DraftEvidenceLink[];
  /** Third-party expectations are never mixed with facts. */
  expectations: DraftEvidenceLink[];
  thesis: { status: "needs_author"; statement: null; variantPerception: null; supportingEvidenceIds: string[]; contradictingEvidenceIds: string[] };
  scenarios: [];
  falsifiers: [];
  catalysts: [];
  unknowns: DraftUnknown[];
  normalizationIssues: NormalizationIssue[];
  review: { status: "unreviewed"; modelVersion: null; promptVersion: null; formulaVersion: null };
  disclaimer: string;
};

export type DraftableJob = { id: string; status: string; ticker: string; securityId: string; question: string; asOf: string; snapshot: ResearchSnapshot | null };

/** Why a job cannot become a draft. Codes are stable API error codes. */
export class DraftPreconditionError extends Error {
  readonly code: "JOB_NOT_SUCCEEDED" | "SNAPSHOT_MISSING" | "NO_NORMALIZED_FACTS" | "NO_EVIDENCE_REFS";
  constructor(code: DraftPreconditionError["code"], message: string) { super(message); this.name = "DraftPreconditionError"; this.code = code; }
}

const UNKNOWN_ISSUES = new Set<NormalizationIssue["code"]>(["metric_missing", "ambiguous_value", "stale_period"]);

export function buildResearchDraft(job: DraftableJob): ResearchDraftContent {
  if (job.status !== "succeeded") throw new DraftPreconditionError("JOB_NOT_SUCCEEDED", `Research job is ${job.status}; only a succeeded job can become a draft`);
  const snapshot = job.snapshot;
  if (!snapshot) throw new DraftPreconditionError("SNAPSHOT_MISSING", "Research job has no valid snapshot");
  if (!snapshot.secFacts) throw new DraftPreconditionError("NO_NORMALIZED_FACTS", "Snapshot predates SEC normalization; re-run the research job");
  if (!snapshot.evidenceRefs.length) throw new DraftPreconditionError("NO_EVIDENCE_REFS", "Snapshot has no evidence references; re-run the research job");

  const refByKey = new Map<string, EvidenceRef>(snapshot.evidenceRefs.map((ref) => [ref.naturalKey, ref]));
  const unknowns: DraftUnknown[] = [];
  const facts: DraftFact[] = [];
  for (const fact of snapshot.secFacts.facts) {
    const ref = refByKey.get(secFactNaturalKey(fact));
    if (!ref) { unknowns.push({ code: "uncited_fact", message: `${fact.label} (${fact.periodicity}) has no evidence row and was left out` }); continue; }
    facts.push({ evidenceId: ref.evidenceId, key: fact.key, label: fact.label, periodicity: fact.periodicity, value: fact.value, unit: fact.unit, periodStart: fact.periodStart, periodEnd: fact.periodEnd, citation: fact.citation });
  }

  for (const issue of snapshot.secFacts.issues) {
    if (issue.severity === "blocking") unknowns.push({ code: "normalization_failed", message: issue.message });
    else if (UNKNOWN_ISSUES.has(issue.code)) unknowns.push({ code: issue.code as DraftUnknown["code"], message: issue.message });
  }
  for (const plan of missingCapabilities(snapshot)) unknowns.push({ code: "missing_capability", message: `No ${plan.capability} data: ${plan.selected} returned nothing` });
  for (const source of snapshot.sources) if (source.freshness === "stale") unknowns.push({ code: "stale_source", message: `${source.provider} data is stale (fetched ${source.fetchedAt})` });
  for (const warning of snapshot.warnings) unknowns.push({ code: "provider_failure", message: warning });

  const link = (ref: EvidenceRef): DraftEvidenceLink => ({ evidenceId: ref.evidenceId, key: ref.naturalKey, provider: ref.provider, sourceUrl: ref.sourceUrl });
  const marketData = snapshot.evidenceRefs.filter((ref) => ref.kind === "FACT" && ref.provider !== "sec-edgar").map(link);
  const expectations = snapshot.evidenceRefs.filter((ref) => ref.kind === "EXPECTATION").map(link);
  const staleSources = snapshot.sources.filter((source) => source.freshness === "stale").length;

  return {
    schemaVersion: 1,
    kind: "evidence_draft",
    generator: DRAFT_GENERATOR,
    jobId: job.id,
    sourceMode: snapshot.sourceMode,
    identity: { ticker: job.ticker, securityId: job.securityId, entityName: snapshot.secFacts.entityName, cik: snapshot.secFacts.cik },
    time: { asOf: job.asOf, filingCutoff: snapshot.secFacts.asOfDate, snapshotGeneratedAt: snapshot.generatedAt },
    question: job.question,
    evidenceSummary: {
      sources: snapshot.sources.map((source) => ({ provider: source.provider, sourceUrl: source.sourceUrl, fetchedAt: source.fetchedAt, freshness: source.freshness })),
      counts: { sources: snapshot.sources.length, staleSources, missingCapabilities: missingCapabilities(snapshot).length, facts: facts.length, unknowns: unknowns.length },
    },
    facts,
    marketData,
    expectations,
    thesis: { status: "needs_author", statement: null, variantPerception: null, supportingEvidenceIds: [], contradictingEvidenceIds: [] },
    scenarios: [],
    falsifiers: [],
    catalysts: [],
    unknowns,
    normalizationIssues: snapshot.secFacts.issues,
    review: { status: "unreviewed", modelVersion: null, promptVersion: null, formulaVersion: null },
    disclaimer: DRAFT_DISCLAIMER,
  };
}

export function draftEvidenceIds(content: ResearchDraftContent) {
  return [...new Set([...content.facts, ...content.marketData, ...content.expectations].map((item) => item.evidenceId))];
}

export type ResearchDraftVersion = { artifactId: string; versionId: string; version: number; status: string; checksum: string; asOf: string; createdAt: string; content: unknown };

async function draftIds(workspaceId: string, jobId: string) {
  const logicalId = await stableId("ral", `${workspaceId}:research-job-draft:${jobId}`);
  const artifactId = await stableId("rat", `${workspaceId}:${logicalId}`);
  return { logicalId, artifactId };
}

async function loadDraftableJob(workspaceId: string, jobId: string): Promise<DraftableJob | null> {
  const row = await getD1().prepare("SELECT j.id,j.status,j.question,j.as_of AS asOf,j.security_id AS securityId,j.snapshot_json AS snapshotJson,s.ticker FROM research_jobs j JOIN securities s ON s.id=j.security_id WHERE j.id=? AND j.workspace_id=?").bind(jobId, workspaceId).first<{ id: string; status: string; question: string; asOf: string; securityId: string; snapshotJson: string | null; ticker: string }>();
  return row ? { id: row.id, status: row.status, ticker: row.ticker, securityId: row.securityId, question: row.question, asOf: row.asOf, snapshot: parseResearchSnapshot(safeJsonParse(row.snapshotJson)) } : null;
}

/** Latest version of the job's draft artifact, or null. Tenant-scoped. */
export async function getResearchDraft(workspaceId: string, jobId: string): Promise<ResearchDraftVersion | null> {
  const { artifactId } = await draftIds(workspaceId, jobId);
  const row = await getD1().prepare("SELECT artifact_id AS artifactId,id AS versionId,version,status,checksum,as_of AS asOf,created_at AS createdAt,content_json AS contentJson FROM research_artifact_versions WHERE artifact_id=? AND workspace_id=? ORDER BY version DESC LIMIT 1").bind(artifactId, workspaceId).first<Omit<ResearchDraftVersion, "content"> & { contentJson: string }>();
  if (!row) return null;
  const { contentJson, ...version } = row;
  return { ...version, content: safeJsonParse(contentJson) };
}

/**
 * Creates version 1 of the job's draft artifact, or returns the existing draft.
 * The artifact and its first version are written in one batch with stable ids,
 * so concurrent or repeated calls converge on a single draft. Every cited
 * evidence row must exist in the same workspace and security.
 */
export async function createResearchDraft(context: AuthContext, jobId: string): Promise<{ created: boolean; draft: ResearchDraftVersion }> {
  const job = await loadDraftableJob(context.workspaceId, jobId);
  if (!job) throw new HttpError(404, "NOT_FOUND", "研究任务不存在");
  const existing = await getResearchDraft(context.workspaceId, jobId);
  if (existing) return { created: false, draft: existing };

  let content: ResearchDraftContent;
  try { content = buildResearchDraft(job); }
  catch (error) { if (error instanceof DraftPreconditionError) throw new HttpError(409, error.code, error.message); throw error; }

  const db = getD1();
  const evidenceIds = draftEvidenceIds(content);
  const found = await db.prepare(`SELECT COUNT(*) AS c FROM evidence WHERE workspace_id=? AND security_id=? AND id IN (${evidenceIds.map(() => "?").join(",")})`).bind(context.workspaceId, job.securityId, ...evidenceIds).first<{ c: number }>();
  if (Number(found?.c) !== evidenceIds.length) throw new HttpError(409, "EVIDENCE_MISSING", "草稿引用的证据不存在或不属于当前 Workspace");

  const { logicalId, artifactId } = await draftIds(context.workspaceId, jobId);
  const versionId = await stableId("rav", `${artifactId}:1`);
  const now = new Date().toISOString();
  const [, versionResult] = await db.batch([
    db.prepare("INSERT OR IGNORE INTO research_artifacts (id,workspace_id,workflow_run_id,security_id,logical_id,artifact_type,title,owner_user_id,created_at,updated_at) VALUES (?,?,NULL,?,?,'report',?,?,?,?)").bind(artifactId, context.workspaceId, job.securityId, logicalId, `${job.ticker} evidence draft · as of ${content.time.filingCutoff}`, context.userId, now, now),
    db.prepare("INSERT OR IGNORE INTO research_artifact_versions (id,artifact_id,workspace_id,version,content_json,source_snapshot_json,checksum,status,as_of,created_by_user_id,supersedes_id,created_at,updated_at) VALUES (?,?,?,1,?,?,?,'draft',?,?,NULL,?,?)").bind(versionId, artifactId, context.workspaceId, JSON.stringify(content), JSON.stringify({ jobId, snapshotGeneratedAt: content.time.snapshotGeneratedAt, sourceMode: content.sourceMode }), await contentHash(content), job.asOf, context.userId, now, now),
  ]);
  const draft = await getResearchDraft(context.workspaceId, jobId);
  if (!draft) throw new Error("Research draft was not persisted");
  return { created: (versionResult?.meta.changes ?? 0) > 0, draft };
}
