import { apiError, audit, requireApiContext } from "../../../../../../../lib/auth/context";
import { reverifyResearchDraft } from "../../../../../../../lib/research/draft";

/** Re-runs the automated checks on the job's latest draft version (editor+). */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request, "editor");
    const { jobId } = await params;
    const draft = await reverifyResearchDraft(context, jobId);
    await audit(request, context, "research.draft.verify", "research_artifact_version", draft.versionId, { jobId, ...draft.issueSummary });
    return Response.json({ data: draft, meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
