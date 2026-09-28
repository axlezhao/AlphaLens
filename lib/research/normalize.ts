/**
 * Normalizes an SEC XBRL `companyfacts` payload into a small, citable set of
 * point-in-time facts. Pure: no network, no database.
 *
 * Point-in-time rule: companyfacts records only a filing *date*, not a time, so
 * a reported value is usable only when it was filed strictly before the
 * `as_of` date. A filing on the `as_of` day may have been accepted after the
 * `as_of` instant and is excluded.
 *
 * `fy`/`fp` in companyfacts describe the *filing* that reported a value, not the
 * value's own period (a 10-K repeats prior years as comparatives with the new
 * `fy`). They are kept on the citation as filing metadata only; the fact's
 * period is always `periodStart`/`periodEnd`.
 */

export type SecMetricKey = "revenue" | "net_income" | "eps_diluted" | "operating_cash_flow" | "shares_outstanding";
export type SecPeriodicity = "annual" | "quarterly" | "instant";

type MetricSpec = {
  key: SecMetricKey;
  label: string;
  unit: string;
  periodicities: readonly SecPeriodicity[];
  /** Highest priority first; within one period the earlier concept wins. */
  concepts: ReadonlyArray<{ taxonomy: "us-gaap" | "dei"; name: string }>;
};

export const SEC_METRICS: readonly MetricSpec[] = [
  { key: "revenue", label: "Revenue", unit: "USD", periodicities: ["annual", "quarterly"], concepts: [
    { taxonomy: "us-gaap", name: "Revenues" },
    { taxonomy: "us-gaap", name: "RevenueFromContractWithCustomerExcludingAssessedTax" },
    { taxonomy: "us-gaap", name: "RevenueFromContractWithCustomerIncludingAssessedTax" },
    { taxonomy: "us-gaap", name: "SalesRevenueNet" },
  ] },
  { key: "net_income", label: "Net income", unit: "USD", periodicities: ["annual", "quarterly"], concepts: [{ taxonomy: "us-gaap", name: "NetIncomeLoss" }] },
  { key: "eps_diluted", label: "Diluted EPS", unit: "USD/shares", periodicities: ["annual", "quarterly"], concepts: [{ taxonomy: "us-gaap", name: "EarningsPerShareDiluted" }] },
  // 10-Q cash flow statements are year-to-date, so only the annual value is a clean period.
  { key: "operating_cash_flow", label: "Operating cash flow", unit: "USD", periodicities: ["annual"], concepts: [{ taxonomy: "us-gaap", name: "NetCashProvidedByUsedInOperatingActivities" }] },
  { key: "shares_outstanding", label: "Shares outstanding", unit: "shares", periodicities: ["instant"], concepts: [
    { taxonomy: "dei", name: "EntityCommonStockSharesOutstanding" },
    { taxonomy: "us-gaap", name: "CommonStockSharesOutstanding" },
  ] },
];

const FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A"]);
const ANNUAL_DAYS = [350, 380] as const;
const QUARTER_DAYS = [80, 100] as const;
/** A latest period older than this, relative to `as_of`, is flagged stale. */
const STALE_AFTER_DAYS: Record<SecPeriodicity, number> = { annual: 456, quarterly: 190, instant: 190 };
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;

export type SecFactCitation = {
  provider: "sec-edgar";
  /** The companyfacts API document the value was read from. */
  sourceUrl: string;
  /** The EDGAR filing folder for the accession that reported the value. */
  filingUrl: string | null;
  cik: string;
  accession: string;
  form: string;
  filed: string;
  taxonomy: string;
  concept: string;
  unit: string;
  periodStart: string | null;
  periodEnd: string;
  frame: string | null;
  filingFiscalYear: number | null;
  filingFiscalPeriod: string | null;
};

export type NormalizedSecFact = {
  key: SecMetricKey;
  label: string;
  periodicity: SecPeriodicity;
  value: number;
  unit: string;
  periodStart: string | null;
  periodEnd: string;
  citation: SecFactCitation;
};

export type NormalizationIssueCode = "malformed_payload" | "metric_missing" | "ambiguous_value" | "stale_period" | "amended_filing" | "later_filings_excluded";

export type NormalizationIssue = {
  code: NormalizationIssueCode;
  severity: "blocking" | "warning" | "info";
  metric?: SecMetricKey;
  periodicity?: SecPeriodicity;
  message: string;
};

export type SecNormalization = {
  cik: string | null;
  entityName: string | null;
  asOfDate: string;
  facts: NormalizedSecFact[];
  issues: NormalizationIssue[];
};

type Entry = { taxonomy: string; concept: string; priority: number; start: string | null; end: string; val: number; accn: string; form: string; filed: string; frame: string | null; fy: number | null; fp: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function days(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
}

function periodicityOf(entry: Entry): SecPeriodicity | null {
  if (entry.start === null) return "instant";
  const length = days(entry.start, entry.end);
  if (length >= ANNUAL_DAYS[0] && length <= ANNUAL_DAYS[1]) return "annual";
  if (length >= QUARTER_DAYS[0] && length <= QUARTER_DAYS[1]) return "quarterly";
  return null;
}

function readEntries(facts: Record<string, unknown>, spec: MetricSpec): Entry[] {
  const entries: Entry[] = [];
  spec.concepts.forEach(({ taxonomy, name }, priority) => {
    const concept = isRecord(facts[taxonomy]) ? (facts[taxonomy] as Record<string, unknown>)[name] : undefined;
    const rows = isRecord(concept) && isRecord(concept.units) ? concept.units[spec.unit] : undefined;
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const { start, end, val, accn, form, filed, frame, fy, fp } = row;
      if (typeof end !== "string" || !DATE.test(end) || typeof filed !== "string" || !DATE.test(filed)) continue;
      if (start !== undefined && (typeof start !== "string" || !DATE.test(start))) continue;
      if (typeof val !== "number" || !Number.isFinite(val) || typeof accn !== "string" || typeof form !== "string" || !FORMS.has(form)) continue;
      entries.push({ taxonomy, concept: name, priority, start: typeof start === "string" ? start : null, end, val, accn, form, filed, frame: typeof frame === "string" ? frame : null, fy: typeof fy === "number" ? fy : null, fp: typeof fp === "string" ? fp : null });
    }
  });
  return entries;
}

/** Latest period first; within a period, preferred concept, then the latest (restating) filing. */
function compareCandidates(a: Entry, b: Entry) {
  return b.end.localeCompare(a.end) || a.priority - b.priority || b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn);
}

function filingUrl(archiveOrigin: string, cik: string, accession: string) {
  const cikNumber = Number.parseInt(cik, 10);
  if (!Number.isSafeInteger(cikNumber) || !ACCESSION.test(accession)) return null;
  return `${archiveOrigin}/Archives/edgar/data/${cikNumber}/${accession.replaceAll("-", "")}/`;
}

export function normalizeCompanyFacts(payload: unknown, options: { asOf: string; sourceUrl: string; archiveOrigin?: string }): SecNormalization {
  const asOfDate = options.asOf.slice(0, 10);
  const archiveOrigin = options.archiveOrigin ?? "https://www.sec.gov";
  const issues: NormalizationIssue[] = [];
  const facts: NormalizedSecFact[] = [];
  if (!DATE.test(asOfDate) || Number.isNaN(Date.parse(options.asOf))) {
    return { cik: null, entityName: null, asOfDate, facts, issues: [{ code: "malformed_payload", severity: "blocking", message: `as_of is not a valid date: ${options.asOf}` }] };
  }
  if (!isRecord(payload) || !isRecord(payload.facts)) {
    return { cik: null, entityName: null, asOfDate, facts, issues: [{ code: "malformed_payload", severity: "blocking", message: "SEC companyfacts payload has no facts object" }] };
  }
  const cik = typeof payload.cik === "number" || typeof payload.cik === "string" ? String(payload.cik).padStart(10, "0") : null;
  const entityName = typeof payload.entityName === "string" ? payload.entityName : null;
  let excludedLater = 0;

  for (const spec of SEC_METRICS) {
    const entries = readEntries(payload.facts, spec);
    const known = entries.filter((entry) => entry.filed < asOfDate);
    excludedLater += entries.length - known.length;
    for (const periodicity of spec.periodicities) {
      const candidates = known.filter((entry) => periodicityOf(entry) === periodicity).sort(compareCandidates);
      const best = candidates[0];
      if (!best) {
        issues.push({ code: "metric_missing", severity: "warning", metric: spec.key, periodicity, message: `No ${periodicity} ${spec.label} was filed before ${asOfDate}` });
        continue;
      }
      // Multi-class issuers report one value per class for the same filing and period.
      const sameReport = candidates.filter((entry) => entry.concept === best.concept && entry.end === best.end && entry.start === best.start && entry.accn === best.accn);
      if (new Set(sameReport.map((entry) => entry.val)).size > 1) {
        issues.push({ code: "ambiguous_value", severity: "warning", metric: spec.key, periodicity, message: `${spec.label} for ${best.end} has ${sameReport.length} different values in ${best.accn}; not selected` });
        continue;
      }
      if (Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${best.end}T00:00:00Z`) > STALE_AFTER_DAYS[periodicity] * DAY_MS) {
        issues.push({ code: "stale_period", severity: "warning", metric: spec.key, periodicity, message: `Latest ${periodicity} ${spec.label} ends ${best.end}, more than ${STALE_AFTER_DAYS[periodicity]} days before ${asOfDate}` });
      }
      if (best.form.endsWith("/A")) {
        issues.push({ code: "amended_filing", severity: "info", metric: spec.key, periodicity, message: `${spec.label} for ${best.end} comes from amended filing ${best.form} ${best.accn}` });
      }
      facts.push({
        key: spec.key, label: spec.label, periodicity, value: best.val, unit: spec.unit, periodStart: best.start, periodEnd: best.end,
        citation: {
          provider: "sec-edgar", sourceUrl: options.sourceUrl, filingUrl: cik ? filingUrl(archiveOrigin, cik, best.accn) : null, cik: cik ?? "",
          accession: best.accn, form: best.form, filed: best.filed, taxonomy: best.taxonomy, concept: best.concept, unit: spec.unit,
          periodStart: best.start, periodEnd: best.end, frame: best.frame, filingFiscalYear: best.fy, filingFiscalPeriod: best.fp,
        },
      });
    }
  }
  if (excludedLater > 0) issues.push({ code: "later_filings_excluded", severity: "info", message: `${excludedLater} reported values filed on or after ${asOfDate} were excluded` });
  return { cik, entityName, asOfDate, facts, issues };
}

/** Stable per-metric key; a new period or restatement becomes a new evidence version. */
export function secFactNaturalKey(fact: Pick<NormalizedSecFact, "key" | "periodicity">) {
  return `sec-fact:${fact.key}:${fact.periodicity}`;
}

export function secFactClaim(ticker: string, fact: NormalizedSecFact) {
  const period = fact.periodStart ? `${fact.periodStart} to ${fact.periodEnd}` : `as of ${fact.periodEnd}`;
  return `${ticker} ${fact.label} (${fact.periodicity}, ${period}): ${fact.value.toLocaleString("en-US")} ${fact.unit} — ${fact.citation.form} filed ${fact.citation.filed}, ${fact.citation.taxonomy}:${fact.citation.concept}`;
}
