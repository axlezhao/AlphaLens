import type { Freshness, ProviderName } from "../providers/types";
import type { NormalizationIssue, NormalizedSecFact, SecNormalization } from "./normalize";

export type ResearchSnapshotSource = {
  provider: ProviderName;
  asOf: string;
  fetchedAt: string;
  staleAt: string;
  freshness: Freshness;
  cache: "hit" | "miss" | "stale-fallback";
  sourceUrl: string;
  licenseScope: string;
  data: unknown;
};

export type ResearchSnapshotPlan = {
  capability: string;
  selected: ProviderName | null;
  fallbacks: ProviderName[];
  rejected: unknown[];
  explanation: string;
};

export type ResearchSnapshot = {
  schemaVersion: 1;
  sourceMode: "live" | "fixture";
  ticker: string;
  question: string;
  asOf: string;
  generatedAt: string;
  providerPlan: ResearchSnapshotPlan[];
  sources: ResearchSnapshotSource[];
  warnings: string[];
  /** Normalized, cited SEC facts; absent on snapshots written before normalization existed. */
  secFacts: SecNormalization | null;
};

const PROVIDERS: readonly ProviderName[] = ["sec-edgar", "issuer-ir", "alpha-vantage-market", "alpha-vantage-consensus"];
const FRESHNESS: readonly Freshness[] = ["fresh", "stale"];
const CACHES = ["hit", "miss", "stale-fallback"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isProvider(value: unknown): value is ProviderName {
  return typeof value === "string" && PROVIDERS.includes(value as ProviderName);
}

function isFreshness(value: unknown): value is Freshness {
  return typeof value === "string" && FRESHNESS.includes(value as Freshness);
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function providerList(value: unknown): ProviderName[] {
  return Array.isArray(value) ? value.filter(isProvider) : [];
}

function parseSecFacts(value: unknown): SecNormalization | null {
  if (!isRecord(value) || !Array.isArray(value.facts) || !Array.isArray(value.issues)) return null;
  const facts = value.facts.filter((fact): fact is NormalizedSecFact =>
    isRecord(fact) && typeof fact.key === "string" && typeof fact.value === "number" && typeof fact.periodEnd === "string"
    && isRecord(fact.citation) && typeof fact.citation.sourceUrl === "string" && typeof fact.citation.accession === "string");
  const issues = value.issues.filter((issue): issue is NormalizationIssue => isRecord(issue) && typeof issue.code === "string" && typeof issue.message === "string");
  return { cik: typeof value.cik === "string" ? value.cik : null, entityName: typeof value.entityName === "string" ? value.entityName : null, asOfDate: string(value.asOfDate), facts, issues };
}

/**
 * Converts the persisted JSON boundary into the small, stable schema the UI needs.
 * Invalid or incomplete rows are rejected instead of being rendered as live research.
 */
export function parseResearchSnapshot(value: unknown): ResearchSnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  if (!Array.isArray(value.sources) || !Array.isArray(value.providerPlan) || !Array.isArray(value.warnings)) return null;

  const sources: ResearchSnapshotSource[] = [];
  for (const source of value.sources) {
    if (!isRecord(source) || !isProvider(source.provider) || !isFreshness(source.freshness)) return null;
    if (!(CACHES as readonly string[]).includes(string(source.cache)) || !string(source.sourceUrl)) return null;
    sources.push({
      provider: source.provider,
      asOf: string(source.asOf),
      fetchedAt: string(source.fetchedAt),
      staleAt: string(source.staleAt),
      freshness: source.freshness,
      cache: string(source.cache) as ResearchSnapshotSource["cache"],
      sourceUrl: string(source.sourceUrl),
      licenseScope: string(source.licenseScope),
      data: source.data,
    });
  }

  const providerPlan: ResearchSnapshotPlan[] = value.providerPlan.map((plan) => {
    if (!isRecord(plan)) return { capability: "unknown", selected: null, fallbacks: [], rejected: [], explanation: "Invalid provider plan row" };
    return {
      capability: string(plan.capability, "unknown"),
      selected: isProvider(plan.selected) ? plan.selected : null,
      fallbacks: providerList(plan.fallbacks),
      rejected: Array.isArray(plan.rejected) ? plan.rejected : [],
      explanation: string(plan.explanation),
    };
  });

  return {
    schemaVersion: 1,
    sourceMode: value.sourceMode === "fixture" ? "fixture" : "live",
    ticker: string(value.ticker),
    question: string(value.question),
    asOf: string(value.asOf),
    generatedAt: string(value.generatedAt),
    providerPlan,
    sources,
    warnings: value.warnings.filter((warning): warning is string => typeof warning === "string"),
    secFacts: parseSecFacts(value.secFacts),
  };
}

export function safeJsonParse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

export function missingCapabilities(snapshot: ResearchSnapshot): ResearchSnapshotPlan[] {
  const available = new Set(snapshot.sources.map((source) => source.provider));
  return snapshot.providerPlan.filter((plan) => plan.selected !== null && !available.has(plan.selected));
}
