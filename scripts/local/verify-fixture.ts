const baseUrl = (process.env.ALPHALENS_LOCAL_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { accept: "application/json", ...init.headers } });
  const body = await response.json().catch(() => null) as { data?: Record<string, unknown>; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${body?.error?.message ?? "unknown error"}`);
  return body?.data ?? {};
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

  const cancellable = jobId(await api("/api/v1/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: "MSFT", question: `Local fixture cancellation verification ${runId}`, asOf }) }));
  await api(`/api/v1/research/${encodeURIComponent(cancellable)}`, { method: "DELETE" });
  const cancelledJob = await api(`/api/v1/research/${encodeURIComponent(cancellable)}`);
  if (cancelledJob.status !== "cancelled") throw new Error("Fixture research job did not remain cancelled");

  console.log(JSON.stringify({ ok: true, completedJob: completed, draftVersion: draft.versionId, draftFacts: draftContent.facts.length, cancelledJob: cancellable, sourceMode: snapshot.sourceMode }, null, 2));
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
