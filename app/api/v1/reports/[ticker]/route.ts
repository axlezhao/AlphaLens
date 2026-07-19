import { apiError, audit, requireApiContext } from "../../../../../lib/auth/context";
import { reportMarkdown, reportPdf, reportXlsx } from "../../../../../lib/workbench/exports";
import { buildReport } from "../../../../../lib/workbench/service";

export async function GET(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const context = await requireApiContext(request); const ticker = (await params).ticker.toUpperCase(); const format = new URL(request.url).searchParams.get("format") ?? "markdown"; const report = await buildReport(context, ticker); let body: BodyInit; let contentType: string; let extension: string;
    if (format === "markdown" || format === "md") { body = reportMarkdown(report); contentType = "text/markdown; charset=utf-8"; extension = "md"; }
    else if (format === "pdf") { body = Uint8Array.from(reportPdf(report)).buffer; contentType = "application/pdf"; extension = "pdf"; }
    else if (format === "excel" || format === "xlsx") { body = Uint8Array.from(reportXlsx(report)).buffer; contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; extension = "xlsx"; }
    else return Response.json({ error: { code: "INVALID_FORMAT", message: "仅支持 markdown、pdf 或 xlsx", requestId } }, { status: 400 });
    await audit(request, context, "report.export", "security", ticker, { format });
    return new Response(body, { headers: { "content-type": contentType, "content-disposition": `attachment; filename="AlphaLens-${ticker}-${report.asOf.slice(0, 10)}.${extension}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return apiError(error, requestId); }
}
