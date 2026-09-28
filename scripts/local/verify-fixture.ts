const baseUrl = (process.env.ALPHALENS_LOCAL_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { accept: "application/json", ...init.headers } });
  const body = await response.json().catch(() => null) as { data?: Record<string, unknown>; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${body?.error?.message ?? "unknown error"}`);
  return body?.data ?? {};
}

/** Asserts that a request is refused with the given API error code. */
async function expectRefusal(path: string, init: RequestInit, code: string) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { accept: "application/json", "content-type": "application/json", ...init.headers } });
  const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  if (response.ok || body?.error?.code !== code) throw new Error(`${init.method ?? "GET"} ${path} should be refused with ${code}, got ${response.status} ${body?.error?.code ?? ""}`);
}

function jobId(value: Record<string, unknown>) {
  if (typeof value.id !== "string") throw new Error("Research API response did not include a job id");
  return value.id;
}

async function main() {
  const runId = crypto.randomUUID();
  const asOf = new Date().toISOString();
  const completed = jobId(await api("/api/v1/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: "AAPL", question: `Local fixture evidence verification ${runId}`, asOf }) }));
  await api("/api/internal/research-worker", { method: "POST" });
  const completedJob = await api(`/api/v1/research/${encodeURIComponent(completed)}`);
  const snapshot = completedJob.snapshot as { sourceMode?: unknown; sources?: unknown; secFacts?: { facts?: unknown } | null } | null;
  if (completedJob.status !== "succeeded" || snapshot?.sourceMode !== "fixture" || !Array.isArray(snapshot.sources) || snapshot.sources.length === 0) throw new Error("Fixture research job did not finish with a fixture snapshot");
  if (!Array.isArray(snapshot.secFacts?.facts) || snapshot.secFacts.facts.length === 0) throw new Error("Fixture research job did not record normalized SEC facts");

  const draft = await api(`/api/v1/research/${encodeURIComponent(completed)}/draft`, { method: "POST" });
  const draftContent = draft.content as { kind?: unknown; facts?: unknown; thesis?: { status?: unknown } } | undefined;
  if (draft.status !== "draft" || draftContent?.kind !== "evidence_draft" || !Array.isArray(draftContent.facts) || draftContent.facts.length === 0 || draftContent.thesis?.status !== "needs_author") throw new Error("Fixture research job did not produce a cited evidence draft");
  const reread = await api(`/api/v1/research/${encodeURIComponent(completed)}/draft`);
  if (reread.versionId !== draft.versionId) throw new Error("Evidence draft could not be read back");

  // Phase 1 gate: the draft is verified, every fact is cited, and only human review publishes it.
  const facts = draftContent.facts as Array<{ evidenceId?: unknown; citation?: { accession?: unknown; filed?: unknown } }>;
  if (facts.some((fact) => typeof fact.evidenceId !== "string" || typeof fact.citation?.accession !== "string" || typeof fact.citation.filed !== "string")) throw new Error("Evidence draft contains an uncited fact");
  const summary = draft.issueSummary as { blockingOpen?: unknown } | undefined;
  if (!draft.verifiedAt || summary?.blockingOpen !== 0) throw new Error("Fixture evidence draft was not verified clean");
  const reviewPath = `/api/v1/research/${encodeURIComponent(completed)}/draft/review`;
  const review = (action: string) => api(reviewPath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
  await expectRefusal(reviewPath, { method: "POST", body: JSON.stringify({ action: "publish" }) }, "NOT_APPROVED");
  if ((await review("request")).status !== "in_review") throw new Error("Evidence draft did not enter review");
  if ((await review("approve")).status !== "approved") throw new Error("Evidence draft was not approved");
  const published = await review("publish");
  if (published.status !== "published") throw new Error("Evidence draft was not published");

  const cancellable = jobId(await api("/api/v1/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: "MSFT", question: `Local fixture cancellation verification ${runId}`, asOf }) }));
  await api(`/api/v1/research/${encodeURIComponent(cancellable)}`, { method: "DELETE" });
  const cancelledJob = await api(`/api/v1/research/${encodeURIComponent(cancellable)}`);
  if (cancelledJob.status !== "cancelled") throw new Error("Fixture research job did not remain cancelled");

  console.log(JSON.stringify({ ok: true, completedJob: completed, draftVersion: draft.versionId, draftFacts: draftContent.facts.length, draftStatus: published.status, cancelledJob: cancellable, sourceMode: snapshot.sourceMode }, null, 2));
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
