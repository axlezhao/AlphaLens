import { apiError, audit, HttpError, requireApiContext } from "../../../../../../../../lib/auth/context";
import { acknowledgeDraftIssue } from "../../../../../../../../lib/research/draft";

/** Acknowledges an open warning or info issue with a note (editor+). Blocking issues are refused. */
export async function PATCH(request: Request, { params }: { params: Promise<{ jobId: string; issueId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request, "editor");
    const { jobId, issueId } = await params;
    const body = await request.json().catch(() => null) as { status?: unknown; note?: unknown } | null;
    if (body?.status !== "acknowledged" || typeof body.note !== "string") throw new HttpError(400, "INVALID_ARGUMENT", "需要 status=acknowledged 与 note");
    const draft = await acknowledgeDraftIssue(context, jobId, issueId, body.note);
    await audit(request, context, "research.draft.issue.acknowledge", "verification_issue", issueId, { jobId });
    return Response.json({ data: draft, meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
