import { apiError } from "../../../../../../lib/auth/context";
import { getD1 } from "../../../../../../db";
import { requireApiClient } from "../../../../../../lib/platform/api-auth";

export async function GET(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiClient(request, "artifacts:read");
    const data = await getD1().prepare("SELECT rav.id,rav.version,rav.status,rav.content_json AS contentJson,rav.source_snapshot_json AS sourceSnapshotJson,rav.checksum,rav.as_of AS asOf,rav.published_at AS publishedAt,ra.logical_id AS logicalId,ra.artifact_type AS artifactType,ra.title FROM research_artifact_versions rav JOIN research_artifacts ra ON ra.id=rav.artifact_id WHERE rav.id=? AND rav.workspace_id=? AND rav.status='published'").bind((await params).versionId, context.workspaceId).first<Record<string, unknown>>();
    if (!data) return Response.json({ error: { code: "ARTIFACT_NOT_FOUND", message: "已发布研究版本不存在", requestId } }, { status: 404 });
    return Response.json({ data: { ...data, content: parse(data.contentJson), sourceSnapshot: parse(data.sourceSnapshotJson), contentJson: undefined, sourceSnapshotJson: undefined }, meta: { requestId } }, { headers: { "cache-control": "private, max-age=60" } });
  } catch (error) { return apiError(error, requestId); }
}

function parse(value: unknown) { if (typeof value !== "string") return null; try { return JSON.parse(value); } catch { return null; } }
