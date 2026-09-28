import { apiError, audit, HttpError, requireApiContext } from "../../../../../../../lib/auth/context";
import { mutatePlatform } from "../../../../../../../lib/platform/service";
import { getResearchDraft } from "../../../../../../../lib/research/draft";

const DECISIONS = { approve: "approved", request_changes: "changes_requested", reject: "rejected" } as const;
type ReviewAction = "request" | keyof typeof DECISIONS | "publish";

/**
 * Human review of the job's latest draft version. Delegates to the platform
 * approval and publish actions, which enforce the verification gate (no open
 * blocking issue) and the owner-only approval role.
 */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request, "editor");
    const { jobId } = await params;
    const body = await request.json().catch(() => null) as { action?: unknown; note?: unknown } | null;
    const action = body?.action as ReviewAction;
    if (!["request", "approve", "request_changes", "reject", "publish"].includes(action)) throw new HttpError(400, "INVALID_ARGUMENT", "action 不合法");
    const draft = await getResearchDraft(context.workspaceId, jobId);
    if (!draft) throw new HttpError(404, "NOT_FOUND", "研究草稿不存在");
    if (action === "request") await mutatePlatform(context, { action: "approval.request", artifactVersionId: draft.versionId, requiredRole: "owner" });
    else if (action === "publish") await mutatePlatform(context, { action: "artifact.publish", artifactVersionId: draft.versionId });
    else {
      if (draft.approval?.status !== "pending") throw new HttpError(409, "NO_PENDING_APPROVAL", "当前版本没有待处理的审批请求");
      await mutatePlatform(context, { action: "approval.decide", id: draft.approval.id, decision: DECISIONS[action], note: typeof body?.note === "string" ? body.note : undefined });
    }
    await audit(request, context, `research.draft.review.${action}`, "research_artifact_version", draft.versionId, { jobId });
    return Response.json({ data: await getResearchDraft(context.workspaceId, jobId), meta: { requestId } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
