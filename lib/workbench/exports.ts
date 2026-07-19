export type ReportEvidence = { kind: string; claim: string; source: string; asOf: string; confidence: number; isStale?: boolean };
export type ReportModel = {
  ticker: string;
  issuerName?: string | null;
  asOf: string;
  thesis?: { statement: string; status: string; conviction: number; version: number } | null;
  falsifiers: Array<{ label: string; status: string; threshold?: number | null; unit?: string | null }>;
  catalysts: Array<{ title: string; eventAt?: string | null; dateStatus: string; status: string }>;
  evidence: ReportEvidence[];
  peers: Array<{ ticker: string; metrics: Record<string, number | string | null>; asOf?: string | null }>;
  warnings: string[];
};

export function reportMarkdown(report: ReportModel): string {
  const lines = [
    `# ${report.ticker} 投资研究报告`, "",
    `- 公司：${report.issuerName ?? report.ticker}`,
    `- 研究时点（as_of）：${report.asOf}`,
    "- 用途：研究与学习，不构成投资建议", "",
    "## 当前论点", "",
    report.thesis ? `${report.thesis.statement}\n\n状态：${report.thesis.status}｜信念度：${Math.round(report.thesis.conviction * 100)}%｜版本：v${report.thesis.version}` : "尚未建立论点。", "",
    "## 证伪条件", "",
    ...tableOrEmpty(report.falsifiers.map((item) => `- [${item.status === "triggered" ? "x" : " "}] ${item.label}${item.threshold == null ? "" : `（${item.threshold}${item.unit ?? ""}）`} · ${item.status}`)), "",
    "## 催化剂", "",
    ...tableOrEmpty(report.catalysts.map((item) => `- ${item.eventAt ?? "日期待定"}｜${item.title}｜${item.dateStatus}/${item.status}`)), "",
    "## 证据台账", "",
    "| 类型 | 结论 | 来源 | as_of | 置信度 | 新鲜度 |",
    "|---|---|---|---|---:|---|",
    ...report.evidence.map((item) => `| ${cell(item.kind)} | ${cell(item.claim)} | ${cell(item.source)} | ${cell(item.asOf)} | ${Math.round(item.confidence * 100)}% | ${item.isStale ? "陈旧" : "有效"} |`), "",
    "## 同行比较", "",
    ...peerMarkdown(report.peers), "",
    "## 数据与方法警告", "",
    ...tableOrEmpty(report.warnings.map((warning) => `- ${warning}`)), "",
  ];
  return lines.join("\n");
}

export function reportPdf(report: ReportModel): Uint8Array {
  const lines = wrapText(reportMarkdown(report).replace(/[#|`]/g, "").replace(/^- /gm, "• "), 52);
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 42) pages.push(lines.slice(index, index + 42));
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalogId = add("");
  const pagesId = add("");
  const fontId = add("<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [ << /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >> ] >>");
  const pageIds: number[] = [];
  for (const page of pages.length ? pages : [[report.ticker]]) {
    const commands = ["BT", "/F1 10 Tf", "44 800 Td", "14 TL", ...page.flatMap((line, index) => [`<${utf16beHex(line)}> Tj`, index < page.length - 1 ? "T*" : ""]), "ET"].filter(Boolean).join("\n");
    const contentId = add(`<< /Length ${byteLength(commands)} >>\nstream\n${commands}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  let document = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(byteLength(document)); document += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(document);
}

export function reportXlsx(report: ReportModel): Uint8Array {
  const rows: Array<Array<string | number>> = [
    ["AlphaLens Investment Research Report"], ["Ticker", report.ticker], ["Issuer", report.issuerName ?? report.ticker], ["as_of", report.asOf], [],
    ["Thesis", report.thesis?.statement ?? "Not established"], ["Status", report.thesis?.status ?? "n/a"], ["Conviction", report.thesis?.conviction ?? 0], [],
    ["Evidence type", "Claim", "Source", "as_of", "Confidence", "Freshness"],
    ...report.evidence.map((item) => [item.kind, item.claim, item.source, item.asOf, item.confidence, item.isStale ? "stale" : "current"]), [],
    ["Catalyst", "Event at", "Date status", "Status"], ...report.catalysts.map((item) => [item.title, item.eventAt ?? "", item.dateStatus, item.status]), [],
    ["Falsifier", "Status", "Threshold", "Unit"], ...report.falsifiers.map((item) => [item.label, item.status, item.threshold ?? "", item.unit ?? ""]), [],
    ["Peer", "Metrics JSON", "as_of"], ...report.peers.map((item) => [item.ticker, JSON.stringify(item.metrics), item.asOf ?? ""]), [],
    ["Warnings"], ...report.warnings.map((item) => [item]),
  ];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => typeof value === "number" ? `<c r="${column(c)}${r + 1}"><v>${value}</v></c>` : `<c r="${column(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  return zipStore([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Research" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", sheet],
  ]);
}

function peerMarkdown(peers: ReportModel["peers"]) {
  if (!peers.length) return ["暂无可用同行快照。"]; const keys = [...new Set(peers.flatMap((peer) => Object.keys(peer.metrics)))];
  return [`| 公司 | ${keys.map(cell).join(" | ")} | as_of |`, `|---|${keys.map(() => "---:").join("|")}|---|`, ...peers.map((peer) => `| ${peer.ticker} | ${keys.map((key) => cell(peer.metrics[key] ?? "—")).join(" | ")} | ${peer.asOf ?? "—"} |`)];
}
function tableOrEmpty(items: string[]) { return items.length ? items : ["暂无数据。"]; }
function cell(value: unknown) { return String(value).replace(/\|/g, "\\|").replace(/\n/g, " "); }
function wrapText(value: string, max: number) { return value.split("\n").flatMap((line) => line.length ? Array.from({ length: Math.ceil([...line].length / max) }, (_, index) => [...line].slice(index * max, (index + 1) * max).join("")) : [""]); }
function utf16beHex(value: string) { return "FEFF" + [...value].map((character) => character.codePointAt(0)!).flatMap((code) => code <= 0xffff ? [code] : [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)]).map((code) => code.toString(16).padStart(4, "0")).join("").toUpperCase(); }
function byteLength(value: string) { return new TextEncoder().encode(value).length; }
function xml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function column(index: number) { let result = ""; for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result; return result; }

function zipStore(files: Array<[string, string]>): Uint8Array {
  const encoder = new TextEncoder(); const parts: Uint8Array[] = []; const directory: Uint8Array[] = []; let offset = 0;
  for (const [name, value] of files) {
    const nameBytes = encoder.encode(name); const data = encoder.encode(value); const crc = crc32(data);
    const local = concat(header(0x04034b50, 20, 0, 0, 0, 0, crc, data.length, data.length, nameBytes.length, 0), nameBytes, data); parts.push(local);
    directory.push(concat(header(0x02014b50, 20, 20, 0, 0, 0, 0, crc, data.length, data.length, nameBytes.length, 0, 0, 0, 0, 0, offset), nameBytes)); offset += local.length;
  }
  const central = concat(...directory); const end = header(0x06054b50, 0, 0, files.length, files.length, central.length, offset, 0); return concat(...parts, central, end);
}
function header(...values: number[]) { const size = values.length <= 8 ? 22 : values.length <= 11 ? 30 : 46; const output = new Uint8Array(size); const view = new DataView(output.buffer); const fields = size === 22 ? [[0,4],[4,2],[6,2],[8,2],[10,2],[12,4],[16,4],[20,2]] : size === 30 ? [[0,4],[4,2],[6,2],[8,2],[10,2],[12,2],[14,4],[18,4],[22,4],[26,2],[28,2]] : [[0,4],[4,2],[6,2],[8,2],[10,2],[12,2],[14,2],[16,4],[20,4],[24,4],[28,2],[30,2],[32,2],[34,2],[36,2],[38,4],[42,4]]; fields.forEach(([position, bytes], index) => bytes === 4 ? view.setUint32(position, values[index] ?? 0, true) : view.setUint16(position, values[index] ?? 0, true)); return output; }
function concat(...arrays: Uint8Array[]) { const output = new Uint8Array(arrays.reduce((sum, value) => sum + value.length, 0)); let offset = 0; arrays.forEach((value) => { output.set(value, offset); offset += value.length; }); return output; }
function crc32(data: Uint8Array) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let index = 0; index < 8; index++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
