import type { ResearchSnapshot, ResearchSnapshotPlan, ResearchSnapshotSource } from "../lib/research/snapshot";
import { missingCapabilities } from "../lib/research/snapshot";

export type ResearchResultJob = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  ticker: string;
  question: string;
  asOf: string;
  createdAt?: string;
  updatedAt?: string;
  attempts?: number;
  maxAttempts?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  snapshot: ResearchSnapshot | null;
};

const providerNames: Record<ResearchSnapshotSource["provider"], string> = {
  "sec-edgar": "SEC EDGAR",
  "issuer-ir": "公司 IR",
  "alpha-vantage-market": "Alpha Vantage · 行情",
  "alpha-vantage-consensus": "Alpha Vantage · 一致预期",
};

function date(value: string | undefined) {
  if (!value) return "未记录";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

function sourceHref(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch { return null; }
}

function statusCopy(status: ResearchResultJob["status"]) {
  return ({ queued: "排队中", running: "采集中", succeeded: "采集完成", failed: "采集失败", cancelled: "已取消" })[status];
}

function sourceFor(plan: ResearchSnapshotPlan, snapshot: ResearchSnapshot) {
  return plan.selected ? snapshot.sources.find((source) => source.provider === plan.selected) ?? null : null;
}

export default function ResearchResult({ job, onBack }: { job: ResearchResultJob; onBack: () => void }) {
  const snapshot = job.snapshot;
  const missing = snapshot ? missingCapabilities(snapshot) : [];
  const isComplete = job.status === "succeeded" && !!snapshot;

  return <>
    <section className="page-title research-result-title">
      <div>
        <p className="section-kicker">RESEARCH RESULT / {job.ticker}</p>
        <h1>{isComplete ? "研究证据快照" : "研究任务状态"}<em> · 可核查，而非自动结论。</em></h1>
        <p>{job.question}</p>
      </div>
      <button className="outline-button" onClick={onBack}>返回研究台</button>
    </section>

    <section className={`panel result-status ${isComplete ? "complete" : "incomplete"}`}>
      <div><span className="result-label">{snapshot?.sourceMode === "fixture" ? "本地 fixture 任务" : "真实任务数据"}</span><strong>{statusCopy(job.status)}</strong></div>
      <dl>
        <div><dt>任务 ID</dt><dd>{job.id}</dd></div>
        <div><dt>研究 as_of</dt><dd>{date(job.asOf)}</dd></div>
        <div><dt>任务更新</dt><dd>{date(job.updatedAt)}</dd></div>
        <div><dt>尝试次数</dt><dd>{job.attempts ?? 0} / {job.maxAttempts ?? "—"}</dd></div>
      </dl>
    </section>

    {!isComplete && <section className="panel result-exception" role="status">
      <h2>{job.status === "failed" ? "研究未完成，不能展示为研究结论" : "正在等待可核查的来源快照"}</h2>
      <p>{job.errorMessage ?? "该任务尚未生成完整 snapshot。请稍后刷新；在来源快照可用前，AlphaLens 不会把样例卡片或推测内容标记为本次研究结果。"}</p>
      {job.errorCode && <code>{job.errorCode}</code>}
    </section>}

    {snapshot && <>
      <section className="panel result-disclosure">
        <span className="type neutral">{snapshot.sourceMode === "fixture" ? "本地 fixture" : "证据快照"}</span>
        <div><h2>{snapshot.sourceMode === "fixture" ? "这是本地合成数据，未访问外部数据源。" : "这是来源采集结果，不是投资建议或 AI 自动论点。"}</h2><p>{snapshot.sourceMode === "fixture" ? "Fixture 用于验证创建、执行、查询、取消和来源展示链路。它不是行情、公司披露、投资建议或回测数据。" : "本次任务未调用外部 LLM，也未从原始数据自动生成多空结论、目标价或证伪条件。请先核验下面的来源、时间边界和警告，再进行人工研究。"}</p></div>
      </section>

      <section className="result-metrics">
        <article className="metric-card"><div className="card-label">实际来源</div><div className="metric-main"><strong>{snapshot.sources.length}</strong><span>个</span></div><p>只统计本任务保存的 Provider snapshot</p></article>
        <article className="metric-card"><div className="card-label">陈旧来源</div><div className="metric-main"><strong>{snapshot.sources.filter((source) => source.freshness === "stale").length}</strong><span>个</span></div><p>陈旧数据不应视为当前市场事实</p></article>
        <article className="metric-card"><div className="card-label">缺失能力</div><div className="metric-main"><strong>{missing.length}</strong><span>项</span></div><p>已选择但本次未获得来源的能力</p></article>
        <article className="metric-card"><div className="card-label">运行警告</div><div className="metric-main"><strong>{snapshot.warnings.length}</strong><span>条</span></div><p>Provider 失败或降级信息</p></article>
      </section>

      <section className="panel provenance-table">
        <div className="panel-head"><div>来源与新鲜度</div><span>实际任务 snapshot</span></div>
        <div className="source-table-head"><span>Provider / 能力</span><span>状态</span><span>抓取与 as_of</span><span>来源</span></div>
        {snapshot.providerPlan.map((plan) => {
          const source = sourceFor(plan, snapshot);
          return <div className="source-table-row" key={plan.capability}>
            <div><strong>{plan.selected ? providerNames[plan.selected] : "未配置 Provider"}</strong><small>{plan.capability}</small><p>{plan.explanation || "未提供路由说明"}</p></div>
            <div>{source ? <span className={`source-state ${source.freshness}`}>{source.freshness === "fresh" ? "新鲜" : "陈旧"}</span> : <span className="source-state missing">缺失</span>}<small>{source ? `缓存：${source.cache}` : "本次未取得此来源"}</small></div>
            <div><strong>抓取：{source ? date(source.fetchedAt) : "—"}</strong><small>as_of：{source ? date(source.asOf) : date(snapshot.asOf)}</small>{source?.freshness === "stale" && <small>陈旧阈值：{date(source.staleAt)}</small>}</div>
            <div>{source && sourceHref(source.sourceUrl) ? <a href={sourceHref(source.sourceUrl) ?? undefined} target="_blank" rel="noreferrer">打开原始来源 ↗</a> : <span>无可用 URL</span>}{source && <small>{source.licenseScope}</small>}</div>
          </div>;
        })}
      </section>

      <section className="result-bottom-grid">
        <article className="panel result-warnings"><div className="panel-head"><div>警告与缺口</div><span>{snapshot.warnings.length + missing.length}</span></div>{snapshot.warnings.length === 0 && missing.length === 0 ? <p className="empty-state">本次任务没有记录 Provider 警告或已选能力缺口；这不等于来源正确、完整或适合投资决策。</p> : <ul>{snapshot.warnings.map((warning, index) => <li key={`warning-${index}`}>{warning}</li>)}{missing.map((plan) => <li key={`missing-${plan.capability}`}>{plan.capability}：已选择 {plan.selected ?? "Provider"}，但本次没有保存来源快照。</li>)}</ul>}</article>
        <article className="panel result-boundary"><div className="panel-head"><div>本次可确认 / 不可确认</div><span>研究边界</span></div><dl><div><dt>可确认</dt><dd>该任务实际调用并保存的来源、抓取时间、as_of、缓存状态与异常。</dd></div><div><dt>不可确认</dt><dd>本次没有自动生成论点、估值、财务数字 tie-out 或投资行动条件。</dd></div><div><dt>下一步</dt><dd>人工核验关键披露后，再创建可引用的研究草稿与论点版本。</dd></div></dl></article>
      </section>
    </>}
  </>;
}
