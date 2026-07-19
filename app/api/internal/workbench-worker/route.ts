import { apiError } from "../../../../lib/auth/context";
import { drainNotificationOutbox } from "../../../../lib/workbench/connectors";
import { queueDueCatalystNotifications, refreshDueCatalysts } from "../../../../lib/workbench/service";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const expected = process.env.WORKER_SHARED_SECRET; const supplied = request.headers.get("authorization");
    if (!expected || supplied !== `Bearer ${expected}`) return Response.json({ error: { code: "UNAUTHORIZED", message: "worker token 无效", requestId } }, { status: 401 });
    const catalysts = await refreshDueCatalysts(10); const queuedNotifications = await queueDueCatalystNotifications(); const notifications = await drainNotificationOutbox(20);
    return Response.json({ data: { catalysts, queuedNotifications, notifications }, meta: { requestId, executedAt: new Date().toISOString() } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, requestId); }
}
