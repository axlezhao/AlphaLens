import type { DraftEvidenceLink, DraftFact, ResearchDraftContent } from "./draft";
import { SEC_METRICS, type NormalizedSecFact } from "./normalize";

/**
 * Automated checks on a deterministic evidence draft. Pure: the caller loads
 * the cited evidence rows (workspace-scoped) and persists the findings.
 *
 * - blocking: the draft cannot be approved or published while one is open, and
 *   it closes only when a re-check no longer finds it (never by acknowledgement).
 * - warning: a gap a reviewer must see; an editor may acknowledge it with a note.
 * - info: context for the reviewer.
 *
 * Bump VERIFIER_VERSION whenever a check's behaviour changes.
 */
export const VERIFIER_VERSION = "draft-checks-v1";

/** Annual diluted EPS may differ from net income / shares outstanding by this much before it is flagged. */
const EPS_CROSS_CHECK_TOLERANCE = 0.25;

export type VerificationSeverity = "blocking" | "warning" | "info";

export type VerificationFinding = {
  fingerprint: string;
  checkCode: string;
  severity: VerificationSeverity;
  subject: Record<string, string>;
  message: string;
};

export type CitedEvidence = { id: string; securityId: string; kind: string; value: unknown };

const UNIT_BY_METRIC = new Map(SEC_METRICS.map((spec) => [spec.key, spec.unit]));
const WARNING_UNKNOWNS = new Set(["metric_missing", "ambiguous_value", "stale_period", "stale_source", "missing_capability", "provider_failure", "uncited_fact"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finding(checkCode: string, severity: VerificationSeverity, subject: Record<string, string>, message: string): VerificationFinding {
  const subjectKey = Object.keys(subject).sort().map((key) => `${key}=${subject[key]}`).join("&");
  return { fingerprint: `${checkCode}:${subjectKey}`, checkCode, severity, subject, message };
}

function factSubject(fact: DraftFact) {
  return { section: "facts", key: fact.key, periodicity: fact.periodicity, evidenceId: fact.evidenceId };
}

/** The draft's number, unit, period and citation must equal what the evidence row stored. */
function tieOutFailures(fact: DraftFact, stored: unknown): string[] {
  if (!isRecord(stored) || !isRecord(stored.citation)) return ["evidence value is not a normalized SEC fact"];
  const value = stored as unknown as NormalizedSecFact;
  const failures: string[] = [];
  if (value.key !== fact.key || value.periodicity !== fact.periodicity) failures.push(`metric ${value.key}/${value.periodicity}`);
  if (value.value !== fact.value) failures.push(`value ${value.value}`);
  if (value.unit !== fact.unit) failures.push(`unit ${value.unit}`);
  if (value.periodStart !== fact.periodStart || value.periodEnd !== fact.periodEnd) failures.push(`period ${value.periodStart ?? ""}..${value.periodEnd}`);
  if (value.citation.accession !== fact.citation.accession || value.citation.concept !== fact.citation.concept) failures.push(`citation ${value.citation.accession} ${value.citation.concept}`);
  return failures;
}

function checkLink(section: "facts" | "marketData" | "expectations", link: DraftFact | DraftEvidenceLink, evidence: Map<string, CitedEvidence>, securityId: string, out: VerificationFinding[]) {
  const subject = "periodicity" in link ? factSubject(link) : { section, key: link.key, evidenceId: link.evidenceId };
  const row = evidence.get(link.evidenceId);
  if (!row) { out.push(finding("evidence_not_found", "blocking", subject, `Cited evidence ${link.evidenceId} does not exist in this workspace`)); return null; }
  if (row.securityId !== securityId) out.push(finding("evidence_security_mismatch", "blocking", subject, `Cited evidence ${link.evidenceId} belongs to a different security`));
  const expectedKind = section === "expectations" ? "EXPECTATION" : "FACT";
  if (row.kind !== expectedKind) out.push(finding("evidence_kind_mismatch", "blocking", subject, `${section} must cite ${expectedKind} evidence, but ${link.evidenceId} is ${row.kind}`));
  return row;
}

export function verifyDraft(content: ResearchDraftContent, evidence: Map<string, CitedEvidence>): VerificationFinding[] {
  const out: VerificationFinding[] = [];
  const cutoff = content.time.filingCutoff;
  const securityId = content.identity.securityId;

  if (!content.facts.length) out.push(finding("no_facts", "blocking", { section: "facts" }, "The draft contains no cited SEC facts"));

  for (const fact of content.facts) {
    const subject = factSubject(fact);
    const row = checkLink("facts", fact, evidence, securityId, out);
    if (row) {
      const failures = tieOutFailures(fact, row.value);
      if (failures.length) out.push(finding("value_tieout_failed", "blocking", subject, `${fact.label} (${fact.periodicity}) does not match its evidence: ${failures.join("; ")}`));
    }
    const expectedUnit = UNIT_BY_METRIC.get(fact.key);
    if (expectedUnit !== fact.unit) out.push(finding("unit_mismatch", "blocking", subject, `${fact.label} is in ${fact.unit}; expected ${expectedUnit ?? "a known metric"}`));
    const { citation } = fact;
    if (!citation.accession || !citation.sourceUrl || !citation.filed || !citation.concept) out.push(finding("citation_incomplete", "blocking", subject, `${fact.label} (${fact.periodicity}) is missing accession, source, filing date or concept`));
    if (citation.filed >= cutoff) out.push(finding("filed_after_cutoff", "blocking", subject, `${fact.label} was filed ${citation.filed}, not before the ${cutoff} cutoff`));
    if (fact.periodEnd > cutoff) out.push(finding("period_after_cutoff", "blocking", subject, `${fact.label} period ends ${fact.periodEnd}, after the ${cutoff} cutoff`));
  }
  for (const link of content.marketData) checkLink("marketData", link, evidence, securityId, out);
  for (const link of content.expectations) checkLink("expectations", link, evidence, securityId, out);

  // Cross-source numeric tie-out: annual diluted EPS ≈ annual net income / shares outstanding.
  const annual = (key: string) => content.facts.find((fact) => fact.key === key && fact.periodicity === "annual");
  const eps = annual("eps_diluted"); const income = annual("net_income");
  const shares = content.facts.find((fact) => fact.key === "shares_outstanding");
  if (eps && income && shares && shares.value > 0 && eps.value !== 0) {
    const implied = income.value / shares.value;
    const divergence = Math.abs(implied - eps.value) / Math.abs(eps.value);
    if (divergence > EPS_CROSS_CHECK_TOLERANCE) {
      out.push(finding("cross_check_divergence", "warning", { section: "facts", key: "eps_diluted", periodicity: "annual" }, `Diluted EPS ${eps.value} differs by ${(divergence * 100).toFixed(0)}% from net income / shares outstanding (${implied.toFixed(2)}); check share count timing and dilution`));
    }
  }

  for (const unknown of content.unknowns) {
    if (unknown.code === "normalization_failed") out.push(finding("normalization_failed", "blocking", { section: "unknowns", message: unknown.message }, unknown.message));
    else if (WARNING_UNKNOWNS.has(unknown.code)) out.push(finding(unknown.code, "warning", { section: "unknowns", message: unknown.message }, unknown.message));
  }
  for (const issue of content.normalizationIssues) {
    if (issue.severity === "info") out.push(finding(issue.code, "info", { section: "normalization", message: issue.message }, issue.message));
  }
  if (content.thesis.statement === null) out.push(finding("thesis_not_authored", "info", { section: "thesis" }, "No thesis has been written; this draft is an evidence pack only"));

  const seen = new Set<string>();
  return out.filter((item) => !seen.has(item.fingerprint) && !!seen.add(item.fingerprint));
}

export function summarizeFindings(findings: Array<{ severity: VerificationSeverity; status?: string }>) {
  const open = findings.filter((item) => (item.status ?? "open") === "open");
  return {
    blockingOpen: open.filter((item) => item.severity === "blocking").length,
    warningsOpen: open.filter((item) => item.severity === "warning").length,
    acknowledged: findings.filter((item) => item.status === "acknowledged").length,
  };
}
