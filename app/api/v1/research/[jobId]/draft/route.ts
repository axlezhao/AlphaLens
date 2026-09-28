import { apiError, audit, requireApiContext } from "../../../../../../lib/auth/context";
import { createResearchDraft, getResearchDraft } from "../../../../../../lib/research/draft";

/** Latest evidence draft for a research job. Any workspace member may read it. */
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request);
    const { jobId } = await params;
    const draft = await getResearchDraft(context.workspaceId, jobId);
    if (!draft) return Response.json({ error: { code: "NOT_FOUND", message: "研究草稿不存在", requestId } }, { status: 404 });
    return Response.json({ data: draft, meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}

/** Builds the deterministic evidence draft for a succeeded job. Idempotent: 201 when created, 200 when it already existed. */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request, "editor");
    const { jobId } = await params;
    const { created, draft } = await createResearchDraft(context, jobId);
    if (created) await audit(request, context, "research.draft.create", "research_artifact_version", draft.versionId, { jobId });
    return Response.json({ data: draft, meta: { requestId, created } }, { status: created ? 201 : 200, headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
