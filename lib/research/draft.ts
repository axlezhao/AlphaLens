import { getD1 } from "../../db";
import { HttpError, type AuthContext } from "../auth/context";
import { contentHash, stableId } from "../core/ids";
import type { ProviderName } from "../providers/types";
import { secFactNaturalKey, type NormalizationIssue, type SecFactCitation, type SecMetricKey, type SecPeriodicity } from "./normalize";
import { missingCapabilities, parseResearchSnapshot, safeJsonParse, type EvidenceRef, type ResearchSnapshot } from "./snapshot";
import { summarizeFindings, VERIFIER_VERSION, verifyDraft, type CitedEvidence, type VerificationFinding, type VerificationSeverity } from "./verify";

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

export type DraftIssue = { id: string; checkCode: string; severity: VerificationSeverity; status: "open" | "acknowledged" | "resolved"; subject: unknown; message: string; verifierVersion: string; resolutionNote: string | null; resolvedAt: string | null };

export type ResearchDraftVersion = {
  artifactId: string; versionId: string; version: number; status: string; checksum: string; asOf: string; createdAt: string;
  verifiedAt: string | null; verifierVersion: string | null; content: unknown;
  issues: DraftIssue[]; issueSummary: ReturnType<typeof summarizeFindings>;
};

async function draftIds(workspaceId: string, jobId: string) {
  const logicalId = await stableId("ral", `${workspaceId}:research-job-draft:${jobId}`);
  const artifactId = await stableId("rat", `${workspaceId}:${logicalId}`);
  return { logicalId, artifactId };
}

async function loadDraftableJob(workspaceId: string, jobId: string): Promise<DraftableJob | null> {
  const row = await getD1().prepare("SELECT j.id,j.status,j.question,j.as_of AS asOf,j.security_id AS securityId,j.snapshot_json AS snapshotJson,s.ticker FROM research_jobs j JOIN securities s ON s.id=j.security_id WHERE j.id=? AND j.workspace_id=?").bind(jobId, workspaceId).first<{ id: string; status: string; question: string; asOf: string; securityId: string; snapshotJson: string | null; ticker: string }>();
  return row ? { id: row.id, status: row.status, ticker: row.ticker, securityId: row.securityId, question: row.question, asOf: row.asOf, snapshot: parseResearchSnapshot(safeJsonParse(row.snapshotJson)) } : null;
}

/** Cited evidence rows, scoped to the workspace so foreign ids are simply absent. */
async function loadCitedEvidence(workspaceId: string, ids: string[]): Promise<Map<string, CitedEvidence>> {
  if (!ids.length) return new Map();
  const rows = await getD1().prepare(`SELECT id,security_id AS securityId,kind,value_json AS valueJson FROM evidence WHERE workspace_id=? AND id IN (${ids.map(() => "?").join(",")})`).bind(workspaceId, ...ids).all<{ id: string; securityId: string; kind: string; valueJson: string | null }>();
  return new Map(rows.results.map((row) => [row.id, { id: row.id, securityId: row.securityId, kind: row.kind, value: safeJsonParse(row.valueJson) }]));
}

/**
 * Statements that make the stored issues of a version equal `findings`: new
 * findings are inserted, findings that reappear after being resolved reopen,
 * acknowledged warnings stay acknowledged, and open issues that are no longer
 * found are resolved by the verifier. Callers batch these with their own writes.
 */
function issueStatements(workspaceId: string, versionId: string, findings: VerificationFinding[], now: string) {
  const db = getD1();
  const statements = findings.map((item) => db.prepare("INSERT INTO verification_issues (id,workspace_id,artifact_version_id,fingerprint,check_code,severity,status,subject_json,message,verifier_version,created_at,updated_at) VALUES (?,?,?,?,?,?,'open',?,?,?,?,?) ON CONFLICT(artifact_version_id,fingerprint) DO UPDATE SET status=CASE WHEN verification_issues.status='resolved' THEN 'open' ELSE verification_issues.status END,severity=excluded.severity,message=excluded.message,verifier_version=excluded.verifier_version,resolution_note=CASE WHEN verification_issues.status='resolved' THEN NULL ELSE verification_issues.resolution_note END,resolved_by_user_id=CASE WHEN verification_issues.status='resolved' THEN NULL ELSE verification_issues.resolved_by_user_id END,resolved_at=CASE WHEN verification_issues.status='resolved' THEN NULL ELSE verification_issues.resolved_at END,updated_at=excluded.updated_at")
    .bind(crypto.randomUUID(), workspaceId, versionId, item.fingerprint, item.checkCode, item.severity, JSON.stringify(item.subject), item.message, VERIFIER_VERSION, now, now));
  const fingerprints = findings.map((item) => item.fingerprint);
  statements.push(db.prepare(`UPDATE verification_issues SET status='resolved',resolution_note=?,resolved_by_user_id=NULL,resolved_at=?,updated_at=? WHERE artifact_version_id=? AND workspace_id=? AND status<>'resolved'${fingerprints.length ? ` AND fingerprint NOT IN (${fingerprints.map(() => "?").join(",")})` : ""}`)
    .bind(`No longer detected by ${VERIFIER_VERSION}`, now, now, versionId, workspaceId, ...fingerprints));
  return statements;
}

async function listIssues(workspaceId: string, versionId: string): Promise<DraftIssue[]> {
  const rows = await getD1().prepare("SELECT id,check_code AS checkCode,severity,status,subject_json AS subjectJson,message,verifier_version AS verifierVersion,resolution_note AS resolutionNote,resolved_at AS resolvedAt FROM verification_issues WHERE workspace_id=? AND artifact_version_id=? ORDER BY CASE severity WHEN 'blocking' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,check_code,fingerprint").bind(workspaceId, versionId).all<Omit<DraftIssue, "subject"> & { subjectJson: string }>();
  return rows.results.map(({ subjectJson, ...row }) => ({ ...row, subject: safeJsonParse(subjectJson) }));
}

/** Latest version of the job's draft artifact with its verification issues, or null. Tenant-scoped. */
export async function getResearchDraft(workspaceId: string, jobId: string): Promise<ResearchDraftVersion | null> {
  const { artifactId } = await draftIds(workspaceId, jobId);
  const row = await getD1().prepare("SELECT artifact_id AS artifactId,id AS versionId,version,status,checksum,as_of AS asOf,created_at AS createdAt,verified_at AS verifiedAt,verifier_version AS verifierVersion,content_json AS contentJson FROM research_artifact_versions WHERE artifact_id=? AND workspace_id=? ORDER BY version DESC LIMIT 1").bind(artifactId, workspaceId).first<Omit<ResearchDraftVersion, "content" | "issues" | "issueSummary"> & { contentJson: string }>();
  if (!row) return null;
  const { contentJson, ...version } = row;
  const issues = await listIssues(workspaceId, version.versionId);
  return { ...version, content: safeJsonParse(contentJson), issues, issueSummary: summarizeFindings(issues) };
}

/**
 * Creates version 1 of the job's draft artifact, or returns the existing draft.
 * The artifact, its first version and that version's verification issues are
 * written in one batch with stable ids, so concurrent or repeated calls
 * converge on a single, already-verified draft. Every cited evidence row must
 * exist in the same workspace and security.
 */
export async function createResearchDraft(context: AuthContext, jobId: string): Promise<{ created: boolean; draft: ResearchDraftVersion }> {
  const job = await loadDraftableJob(context.workspaceId, jobId);
  if (!job) throw new HttpError(404, "NOT_FOUND", "研究任务不存在");
  const existing = await getResearchDraft(context.workspaceId, jobId);
  if (existing) return { created: false, draft: existing };

  let content: ResearchDraftContent;
  try { content = buildResearchDraft(job); }
  catch (error) { if (error instanceof DraftPreconditionError) throw new HttpError(409, error.code, error.message); throw error; }

  const evidenceIds = draftEvidenceIds(content);
  const evidence = await loadCitedEvidence(context.workspaceId, evidenceIds);
  if (evidenceIds.some((id) => evidence.get(id)?.securityId !== job.securityId)) throw new HttpError(409, "EVIDENCE_MISSING", "草稿引用的证据不存在或不属于当前 Workspace");
  const findings = verifyDraft(content, evidence);

  const db = getD1();
  const { logicalId, artifactId } = await draftIds(context.workspaceId, jobId);
  const versionId = await stableId("rav", `${artifactId}:1`);
  const now = new Date().toISOString();
  const [, versionResult] = await db.batch([
    db.prepare("INSERT OR IGNORE INTO research_artifacts (id,workspace_id,workflow_run_id,security_id,logical_id,artifact_type,title,owner_user_id,research_job_id,created_at,updated_at) VALUES (?,?,NULL,?,?,'report',?,?,?,?,?)").bind(artifactId, context.workspaceId, job.securityId, logicalId, `${job.ticker} evidence draft · as of ${content.time.filingCutoff}`, context.userId, job.id, now, now),
    db.prepare("INSERT OR IGNORE INTO research_artifact_versions (id,artifact_id,workspace_id,version,content_json,source_snapshot_json,checksum,status,as_of,created_by_user_id,supersedes_id,verified_at,verifier_version,created_at,updated_at) VALUES (?,?,?,1,?,?,?,'draft',?,?,NULL,?,?,?,?)").bind(versionId, artifactId, context.workspaceId, JSON.stringify(content), JSON.stringify({ jobId, snapshotGeneratedAt: content.time.snapshotGeneratedAt, sourceMode: content.sourceMode }), await contentHash(content), job.asOf, context.userId, now, VERIFIER_VERSION, now, now),
    // Content is a pure function of the job, so a concurrent loser computes the
    // same findings and its upserts are no-ops.
    ...issueStatements(context.workspaceId, versionId, findings, now),
  ]);
  const created = (versionResult?.meta.changes ?? 0) > 0;
  const draft = await getResearchDraft(context.workspaceId, jobId);
  if (!draft) throw new Error("Research draft was not persisted");
  return { created, draft };
}

/**
 * Re-runs the checks on the latest draft version (for example after a
 * verifier upgrade). Only drafts and versions in review can be re-checked;
 * approved and published versions are frozen.
 */
export async function reverifyResearchDraft(context: AuthContext, jobId: string): Promise<ResearchDraftVersion> {
  const draft = await getResearchDraft(context.workspaceId, jobId);
  if (!draft) throw new HttpError(404, "NOT_FOUND", "研究草稿不存在");
  if (draft.status !== "draft" && draft.status !== "in_review") throw new HttpError(409, "VERSION_LOCKED", "已审批或发布的版本不能重新校验");
  const content = draft.content as ResearchDraftContent;
  if (!content || content.kind !== "evidence_draft") throw new HttpError(409, "NOT_AN_EVIDENCE_DRAFT", "该版本不是证据草稿");
  const findings = verifyDraft(content, await loadCitedEvidence(context.workspaceId, draftEvidenceIds(content)));
  const db = getD1(); const now = new Date().toISOString();
  await db.batch([
    ...issueStatements(context.workspaceId, draft.versionId, findings, now),
    db.prepare("UPDATE research_artifact_versions SET verified_at=?,verifier_version=?,updated_at=? WHERE id=? AND workspace_id=? AND status IN ('draft','in_review')").bind(now, VERIFIER_VERSION, now, draft.versionId, context.workspaceId),
  ]);
  return (await getResearchDraft(context.workspaceId, jobId))!;
}

/** An editor acknowledges an open warning or info issue with a note. Blocking issues cannot be acknowledged. */
export async function acknowledgeDraftIssue(context: AuthContext, jobId: string, issueId: string, note: string) {
  const trimmed = note.trim();
  if (!trimmed || trimmed.length > 1000) throw new HttpError(400, "INVALID_ARGUMENT", "note 需要 1–1000 个字符");
  const draft = await getResearchDraft(context.workspaceId, jobId);
  const issue = draft?.issues.find((item) => item.id === issueId);
  if (!draft || !issue) throw new HttpError(404, "NOT_FOUND", "校验问题不存在");
  if (issue.severity === "blocking") throw new HttpError(409, "BLOCKING_NOT_ACKNOWLEDGEABLE", "阻断性问题只能通过重新校验关闭，不能确认忽略");
  if (issue.status !== "open") throw new HttpError(409, "ISSUE_NOT_OPEN", "该问题不是待处理状态");
  const now = new Date().toISOString();
  const result = await getD1().prepare("UPDATE verification_issues SET status='acknowledged',resolution_note=?,resolved_by_user_id=?,resolved_at=?,updated_at=? WHERE id=? AND workspace_id=? AND artifact_version_id=? AND status='open' AND severity<>'blocking'").bind(trimmed, context.userId, now, now, issueId, context.workspaceId, draft.versionId).run();
  if (!result.meta.changes) throw new HttpError(409, "ISSUE_NOT_OPEN", "该问题不是待处理状态");
  return (await getResearchDraft(context.workspaceId, jobId))!;
}
