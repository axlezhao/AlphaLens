"use client";

import { useCallback, useEffect, useState } from "react";
import type { DraftIssue, ResearchDraftContent, ResearchDraftVersion } from "../lib/research/draft";

type ReviewAction = "request" | "approve" | "request_changes" | "reject" | "publish";

const statusCopy: Record<string, string> = { draft: "草稿", in_review: "审阅中", approved: "已批准", rejected: "已驳回", published: "已发布", superseded: "已被取代" };
const severityCopy: Record<DraftIssue["severity"], string> = { blocking: "阻断", warning: "警告", info: "提示" };
const issueStatusCopy: Record<DraftIssue["status"], string> = { open: "待处理", acknowledged: "已确认", resolved: "已关闭" };
const periodicityCopy = { annual: "年度", quarterly: "季度", instant: "时点" } as const;

function formatValue(value: number, unit: string) {
  if (unit === "USD" && Math.abs(value) >= 1e6) return `$${(value / 1e9).toLocaleString("en-US", { maximumFractionDigits: 2 })}B`;
  if (unit === "shares") return `${(value / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M 股`;
  if (unit === "USD/shares") return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `${value.toLocaleString("en-US")} ${unit}`;
}

function safeHref(value: string | null | undefined) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null; } catch { return null; }
}

async function call(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const payload = await response.json().catch(() => null) as { data?: ResearchDraftVersion; error?: { code?: string; message?: string } } | null;
  return { status: response.status, data: payload?.data ?? null, error: payload?.error ?? null };
}

/**
 * Evidence draft for a completed research job: creation, verification issues,
 * cited facts, and the human review flow. Every gate is enforced by the API;
 * the disabled states here only explain it.
 */
export default function ResearchDraftPanel({ jobId, jobSucceeded }: { jobId: string; jobSucceeded: boolean }) {
  const [draft, setDraft] = useState<ResearchDraftVersion | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const base = `/api/v1/research/${encodeURIComponent(jobId)}/draft`;

  const run = useCallback(async (label: string, request: () => Promise<Awaited<ReturnType<typeof call>>>) => {
    setBusy(label); setError(null);
    try {
      const result = await request();
      if (result.data) setDraft(result.data);
      else if (result.status !== 404) setError(result.error?.message ?? "操作失败");
    } catch { setError("网络错误，请稍后重试"); }
    finally { setBusy(null); setLoaded(true); }
  }, []);

  useEffect(() => {
    if (!jobSucceeded) return;
    let cancelled = false;
    call(base)
      .then((result) => { if (cancelled) return; setDraft(result.data); if (!result.data && result.status !== 404) setError(result.error?.message ?? "草稿加载失败"); })
      .catch(() => { if (!cancelled) setError("网络错误，请稍后重试"); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [base, jobSucceeded]);

  if (!jobSucceeded) return null;
  const review = (action: ReviewAction) => run(action, () => call(`${base}/review`, { method: "POST", body: JSON.stringify({ action }) }));
  const acknowledge = (issue: DraftIssue) => run(issue.id, () => call(`${base}/issues/${encodeURIComponent(issue.id)}`, { method: "PATCH", body: JSON.stringify({ status: "acknowledged", note: notes[issue.id] ?? "" }) }));

  if (!draft) {
    return <section className="panel draft-panel">
      <div className="panel-head"><div>证据草稿</div><span>无 LLM · 确定性生成</span></div>
      <div className="draft-empty">
        <p>把本次任务的 SEC 事实整理为可审阅草稿：每个数字都链接到证据与原始披露，缺口列为待核实项，论点与证伪条件留给人工撰写。生成后会立即运行自动校验。</p>
        <button className="outline-button" disabled={!loaded || !!busy} onClick={() => run("create", () => call(base, { method: "POST" }))}>{busy === "create" ? "生成中…" : "生成证据草稿"}</button>
        {error && <p className="draft-error" role="alert">{error}</p>}
      </div>
    </section>;
  }

  const content = draft.content as ResearchDraftContent;
  const { blockingOpen, warningsOpen, acknowledged } = draft.issueSummary;
  const blocked = blockingOpen > 0;
  const pending = draft.approval?.status === "pending";
  const openIssues = draft.issues.filter((issue) => issue.status !== "resolved");
  const resolvedCount = draft.issues.length - openIssues.length;

  return <section className="panel draft-panel">
    <div className="panel-head"><div>证据草稿 · v{draft.version}</div><span>{statusCopy[draft.status] ?? draft.status}</span></div>

    <div className="draft-summary">
      <div className={`draft-gate ${blocked ? "blocked" : "clear"}`}>
        <strong>{blocked ? `${blockingOpen} 个阻断问题` : "无阻断问题"}</strong>
        <small>{blocked ? "阻断问题关闭前不能批准或发布；只能通过修正来源后重新校验关闭。" : "可以提交审阅。批准与发布仍需 Owner 人工确认。"}</small>
      </div>
      <dl>
        <div><dt>待处理警告</dt><dd>{warningsOpen}</dd></div>
        <div><dt>已确认</dt><dd>{acknowledged}</dd></div>
        <div><dt>引用事实</dt><dd>{content.facts.length}</dd></div>
        <div><dt>校验器</dt><dd>{draft.verifierVersion ?? "未校验"}</dd></div>
      </dl>
    </div>

    <div className="draft-actions">
      {(draft.status === "draft" || draft.status === "in_review") && <button className="outline-button" disabled={!!busy} onClick={() => run("verify", () => call(`${base}/verify`, { method: "POST" }))}>{busy === "verify" ? "校验中…" : "重新校验"}</button>}
      {draft.status === "draft" && <button className="outline-button" disabled={!!busy} onClick={() => review("request")}>提交审阅</button>}
      {pending && <>
        <button className="outline-button" disabled={!!busy || blocked} title={blocked ? "存在阻断问题" : undefined} onClick={() => review("approve")}>批准</button>
        <button className="outline-button" disabled={!!busy} onClick={() => review("request_changes")}>要求修改</button>
        <button className="outline-button" disabled={!!busy} onClick={() => review("reject")}>驳回</button>
      </>}
      {draft.status === "approved" && <button className="outline-button" disabled={!!busy || blocked} onClick={() => review("publish")}>发布</button>}
      {draft.approval && !pending && <small>最近审批：{draft.approval.status}{draft.approval.decisionNote ? ` · ${draft.approval.decisionNote}` : ""}</small>}
    </div>
    {error && <p className="draft-error" role="alert">{error}</p>}

    <div className="draft-issues">
      <h3>校验问题 <small>{openIssues.length} 待处理或已确认 · {resolvedCount} 已关闭</small></h3>
      {openIssues.length === 0 ? <p className="empty-state">没有未关闭的校验问题。这不代表结论正确，只代表自动检查没有发现问题。</p> : <ul>
        {openIssues.map((issue) => <li key={issue.id} className={`issue ${issue.severity}`}>
          <div><span className={`source-state ${issue.severity === "blocking" ? "missing" : issue.severity === "warning" ? "stale" : "fresh"}`}>{severityCopy[issue.severity]}</span><code>{issue.checkCode}</code><em>{issueStatusCopy[issue.status]}</em></div>
          <p>{issue.message}</p>
          {issue.status === "acknowledged" && issue.resolutionNote && <small>确认说明：{issue.resolutionNote}</small>}
          {issue.status === "open" && issue.severity !== "blocking" && <div className="issue-ack">
            <input aria-label={`确认说明 ${issue.checkCode}`} placeholder="确认说明（必填）" value={notes[issue.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [issue.id]: event.target.value }))} />
            <button className="outline-button" disabled={!!busy || !(notes[issue.id] ?? "").trim()} onClick={() => acknowledge(issue)}>确认</button>
          </div>}
        </li>)}
      </ul>}
    </div>

    <div className="draft-facts">
      <h3>SEC 事实 <small>截至 {content.time.filingCutoff} 之前提交的披露 · {content.identity.entityName ?? content.identity.ticker}</small></h3>
      <div className="fact-row head"><span>指标</span><span>期间</span><span>数值</span><span>引用</span></div>
      {content.facts.map((fact) => <div className="fact-row" key={`${fact.key}-${fact.periodicity}`}>
        <span><strong>{fact.label}</strong><small>{periodicityCopy[fact.periodicity]}</small></span>
        <span>{fact.periodStart ? `${fact.periodStart} → ${fact.periodEnd}` : fact.periodEnd}</span>
        <span className="fact-value">{formatValue(fact.value, fact.unit)}</span>
        <span>{safeHref(fact.citation.filingUrl) ? <a href={safeHref(fact.citation.filingUrl) ?? undefined} target="_blank" rel="noreferrer">{fact.citation.form} · {fact.citation.filed} ↗</a> : `${fact.citation.form} · ${fact.citation.filed}`}<small>{fact.citation.taxonomy}:{fact.citation.concept} · {fact.citation.accession}</small><small>evidence {fact.evidenceId}</small></span>
      </div>)}
    </div>

    <div className="draft-columns">
      <div><h3>市场数据</h3>{content.marketData.length ? <ul>{content.marketData.map((item) => <li key={item.evidenceId}>{item.key} · <code>{item.evidenceId}</code></li>)}</ul> : <p className="empty-state">无</p>}</div>
      <div><h3>市场预期</h3>{content.expectations.length ? <ul>{content.expectations.map((item) => <li key={item.evidenceId}>{item.key} · <code>{item.evidenceId}</code></li>)}</ul> : <p className="empty-state">无</p>}</div>
      <div><h3>论点</h3><p className="empty-state">待人工撰写。草稿不包含 AI 生成的论点、情景、目标价或证伪条件。</p></div>
    </div>
    <p className="draft-disclaimer">{content.disclaimer}</p>
  </section>;
}
