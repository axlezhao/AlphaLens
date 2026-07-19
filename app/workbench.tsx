"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type WorkbenchData = {
  watchlists: Array<{ id: string; name: string; items: Array<{ ticker: string; issuerName?: string }> }>;
  thesisTimeline: Array<{ id: string; logicalId: string; version: number; statement: string; status: string; conviction: number; asOf: string }>;
  earnings: Array<{ id: string; ticker: string; workflowType: string; fiscalPeriod: string; status: string }>;
  catalysts: Array<{ id: string; ticker: string; title: string; eventAt?: string; dateStatus: string; isStale?: boolean }>;
  notificationChannels: Array<{ id: string; label: string; destinationHint: string; verificationStatus: string }>;
  peers: Array<{ ticker: string; metrics?: Record<string, number | string>; metricsAsOf?: string }>;
  biasStats: Array<{ bias: string; count: number }>;
  capabilityStatus: { email: boolean; wecomWebhook: boolean; wechatOfficial: boolean };
};

const empty: WorkbenchData = { watchlists: [], thesisTimeline: [], earnings: [], catalysts: [], notificationChannels: [], peers: [], biasStats: [], capabilityStatus: { email: false, wecomWebhook: true, wechatOfficial: false } };

export default function PersonalWorkbench({ ticker }: { ticker: string }) {
  const [data, setData] = useState<WorkbenchData>(empty); const [loading, setLoading] = useState(true); const [message, setMessage] = useState("");
  const [watchTicker, setWatchTicker] = useState(""); const [thesis, setThesis] = useState(""); const [falsifier, setFalsifier] = useState(""); const [period, setPeriod] = useState("FY27 Q2");
  const [channelType, setChannelType] = useState("email"); const [destination, setDestination] = useState(""); const [peerTickers, setPeerTickers] = useState("AMD, AVGO, INTC");
  const [price, setPrice] = useState(172.41); const [eps, setEps] = useState(4.2); const [terminalPe, setTerminalPe] = useState(30); const [years, setYears] = useState(3); const [implied, setImplied] = useState<number | null>(null);
  const [decision, setDecision] = useState(""); const [biases, setBiases] = useState("confirmation, anchoring");

  const load = useCallback(async () => {
    try { const response = await fetch(`/api/v1/workbench?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" }); const payload = await response.json() as { data?: WorkbenchData; error?: { message: string } }; if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "工作台读取失败"); setData(payload.data); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "工作台读取失败"); }
    finally { setLoading(false); }
  }, [ticker]);
  useEffect(() => {
    let active = true;
    fetch(`/api/v1/workbench?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" })
      .then(async (response) => { const payload = await response.json() as { data?: WorkbenchData; error?: { message: string } }; if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "工作台读取失败"); return payload.data; })
      .then((next) => { if (active) { setData(next); setMessage(""); } })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "工作台读取失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ticker]);

  async function mutate(body: Record<string, unknown>) {
    setMessage("正在保存…"); const response = await fetch("/api/v1/workbench", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const payload = await response.json() as { error?: { message: string } }; if (!response.ok) { setMessage(payload.error?.message ?? "保存失败"); return false; } setMessage("已保存并写入审计日志"); await load(); return true;
  }

  async function calculateImplied() {
    const response = await fetch("/api/v1/implied-expectations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "eps", price, currentEps: eps, terminalPe, years }) }); const payload = await response.json() as { data?: { impliedCagrPercent: number }; error?: { message: string } }; if (!response.ok || !payload.data) return setMessage(payload.error?.message ?? "计算失败"); setImplied(payload.data.impliedCagrPercent);
  }

  const activeThesis = data.thesisTimeline[0]; const defaultWatchlist = data.watchlists[0];
  const latestEarnings = useMemo(() => data.earnings.filter((item) => item.ticker === ticker).slice(0, 4), [data.earnings, ticker]);

  return <>
    <section className="page-title workbench-title"><div><p className="section-kicker">PERSONAL RESEARCH WORKBENCH / P1</p><h1>把研究过程，<em>变成可积累的决策系统。</em></h1><p>观察、验证、财报、提醒、估值和复盘共享同一个 as_of 与证据链。</p></div><div className="workbench-state"><span className="pulse" />{loading ? "正在同步" : "Workspace 已同步"}<small>{message || "所有写操作均审计"}</small></div></section>
    {message.includes("登录") && <div className="auth-banner">真实 P1 数据需要登录后写入个人 Workspace。<a href="/signin-with-chatgpt?return_to=%2F">使用 ChatGPT 登录 →</a></div>}

    <section className="wb-grid wb-grid-3">
      <article className="panel wb-card"><div className="panel-head"><div>自定义观察池</div><span>{defaultWatchlist?.items.length ?? 0} 只</span></div><div className="wb-list">{defaultWatchlist?.items.length ? defaultWatchlist.items.map((item) => <div key={item.ticker}><strong>{item.ticker}</strong><span>{item.issuerName ?? "US Equity"}</span><button onClick={() => mutate({ action: "watchlist.remove", watchlistId: defaultWatchlist.id, ticker: item.ticker })}>移除</button></div>) : <p className="wb-empty">登录后建立你的第一组观察标的。</p>}</div><form className="wb-inline" onSubmit={(event) => { event.preventDefault(); if (defaultWatchlist && watchTicker) void mutate({ action: "watchlist.add", watchlistId: defaultWatchlist.id, ticker: watchTicker }); }}><input value={watchTicker} onChange={(event) => setWatchTicker(event.target.value.toUpperCase())} placeholder="输入代码，如 META"/><button>加入</button></form></article>
      <article className="panel wb-card thesis-timeline"><div className="panel-head"><div>论点版本时间线</div><span>{data.thesisTimeline.length} 个版本</span></div>{activeThesis ? <><blockquote>{activeThesis.statement}</blockquote><div className="timeline-list">{data.thesisTimeline.slice(0, 4).map((item) => <div key={item.id}><i/><strong>v{item.version}</strong><span>{item.status} · {Math.round(item.conviction * 100)}%</span><time>{item.asOf.slice(0, 10)}</time></div>)}</div></> : <p className="wb-empty padded">尚未建立可版本化论点。</p>}<form className="wb-stack" onSubmit={(event) => { event.preventDefault(); void mutate({ action: "thesis.save", ticker, logicalId: activeThesis?.logicalId, statement: thesis, conviction: .7, status: "active", falsifiers: falsifier ? [{ label: falsifier, operator: "manual" }] : [] }); }}><textarea value={thesis} onChange={(event) => setThesis(event.target.value)} placeholder="更新核心论点；保存时自动生成新版本"/><input value={falsifier} onChange={(event) => setFalsifier(event.target.value)} placeholder="可编辑证伪条件"/><button>保存新版本</button></form></article>
      <article className="panel wb-card"><div className="panel-head"><div>财报工作流</div><span>异步队列</span></div><input className="wb-full-input" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="财报期间"/><div className="earnings-actions"><button onClick={() => mutate({ action: "earnings.create", ticker, workflowType: "preview", fiscalPeriod: period })}><strong>Preview</strong><small>预期 · KPI · 分歧 · 情景</small></button><button onClick={() => mutate({ action: "earnings.create", ticker, workflowType: "deep_dive", fiscalPeriod: period })}><strong>Deep Dive</strong><small>实际 vs 预期 · 论点变化</small></button></div><div className="wb-list compact">{latestEarnings.map((item) => <div key={item.id}><strong>{item.fiscalPeriod}</strong><span>{item.workflowType}</span><b className={`job-${item.status}`}>{item.status}</b></div>)}</div></article>
    </section>

    <section className="wb-grid wb-grid-2">
      <article className="panel wb-card"><div className="panel-head"><div>催化剂自动刷新</div><button onClick={() => mutate({ action: "catalyst.refresh", ticker })}>立即刷新 ↻</button></div><div className="catalyst-table">{data.catalysts.filter((item) => item.ticker === ticker).slice(0, 6).map((item) => <div key={item.id}><time>{item.eventAt?.slice(0, 10) ?? "TBD"}</time><strong>{item.title}</strong><span>{item.dateStatus}{item.isStale ? " · 陈旧" : ""}</span></div>)}{!data.catalysts.some((item) => item.ticker === ticker) && <p className="wb-empty">配置公司官方 IR Feed 后，每 6 小时自动刷新；也可手动写入事件。</p>}</div><small className="source-boundary">只使用公司官方 IR 与已授权来源；失败会重试并标记 degraded/stale。</small></article>
      <article className="panel wb-card"><div className="panel-head"><div>提醒通道</div><span>邮件 · 微信 · 企业微信</span></div><div className="channel-status"><span className={data.capabilityStatus.email ? "on" : "off"}>邮件 {data.capabilityStatus.email ? "ready" : "需密钥"}</span><span className="on">企业微信 ready</span><span className={data.capabilityStatus.wechatOfficial ? "on" : "off"}>微信 {data.capabilityStatus.wechatOfficial ? "ready" : "需官方账号"}</span></div><form className="wb-stack" onSubmit={(event) => { event.preventDefault(); void mutate({ action: "notification.channel.save", channelType, destination }); }}><select value={channelType} onChange={(event) => setChannelType(event.target.value)}><option value="email">邮件</option><option value="wecom_webhook">企业微信机器人</option><option value="wechat_official">微信公众号</option></select><input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder={channelType === "email" ? "name@example.com" : channelType === "wecom_webhook" ? "官方 qyapi.weixin.qq.com webhook" : "已授权 OpenID"}/><button>安全保存通道</button></form><div className="wb-list compact">{data.notificationChannels.map((channel) => <div key={channel.id}><strong>{channel.label}</strong><span>{channel.destinationHint}</span><b>{channel.verificationStatus}</b></div>)}</div></article>
    </section>

    <section className="wb-grid wb-grid-2">
      <article className="panel wb-card"><div className="panel-head"><div>同行业横向比较</div><span>来源与 as_of 不可省略</span></div><form className="wb-inline" onSubmit={(event) => { event.preventDefault(); void mutate({ action: "peers.save", ticker, metricKeys: ["revenueGrowth", "grossMargin", "forwardPe"], members: peerTickers.split(",").map((symbol) => ({ ticker: symbol.trim().toUpperCase(), asOf: new Date().toISOString(), metrics: {} })).filter((item) => item.ticker) }); }}><input value={peerTickers} onChange={(event) => setPeerTickers(event.target.value)} placeholder="AMD, AVGO, INTC"/><button>保存同行组</button></form><table className="peer-table"><thead><tr><th>公司</th><th>收入增速</th><th>毛利率</th><th>Forward P/E</th><th>as_of</th></tr></thead><tbody>{data.peers.map((peer) => <tr key={peer.ticker}><td>{peer.ticker}</td><td>{peer.metrics?.revenueGrowth ?? "—"}</td><td>{peer.metrics?.grossMargin ?? "—"}</td><td>{peer.metrics?.forwardPe ?? "—"}</td><td>{peer.metricsAsOf?.slice(0, 10) ?? "待补"}</td></tr>)}</tbody></table></article>
      <article className="panel wb-card"><div className="panel-head"><div>当前价格隐含预期反推</div><span>EPS 框架</span></div><div className="assumption-grid"><label>当前价格<input type="number" value={price} onChange={(event) => setPrice(Number(event.target.value))}/></label><label>当前 EPS<input type="number" value={eps} onChange={(event) => setEps(Number(event.target.value))}/></label><label>终值 P/E<input type="number" value={terminalPe} onChange={(event) => setTerminalPe(Number(event.target.value))}/></label><label>年数<input type="number" value={years} onChange={(event) => setYears(Number(event.target.value))}/></label></div><button className="wb-primary" onClick={calculateImplied}>反推市场要求的 EPS CAGR</button><div className="implied-result"><span>隐含年复合增长</span><strong>{implied == null ? "—" : `${implied.toFixed(1)}%`}</strong><small>由价格与终值假设代数反推，不是目标价。</small></div></article>
    </section>

    <section className="wb-grid wb-grid-2">
      <article className="panel wb-card"><div className="panel-head"><div>复盘模板</div><span>认知偏差可统计</span></div><form className="wb-stack" onSubmit={(event: FormEvent) => { event.preventDefault(); void mutate({ action: "review.create", ticker, reviewType: "decision", decision, confidence: .7, biases: biases.split(",").map((item) => item.trim()), expectedOutcome: "记录当时可验证的预期", asOf: new Date().toISOString() }); }}><textarea value={decision} onChange={(event) => setDecision(event.target.value)} placeholder="当时基于哪些信息做了什么决定？"/><input value={biases} onChange={(event) => setBiases(event.target.value)} placeholder="confirmation, anchoring"/><button>保存复盘快照</button></form><div className="bias-bars">{data.biasStats.slice(0, 5).map((item) => <div key={item.bias}><span>{item.bias}</span><i><b style={{ width: `${Math.min(100, item.count * 20)}%` }}/></i><strong>{item.count}</strong></div>)}</div></article>
      <article className="panel wb-card export-card"><div className="panel-head"><div>研究报告导出</div><span>实时读取证据台账</span></div><p>导出内容带 as_of、来源、新鲜度、论点版本、证伪条件、催化剂与同行快照。</p><div className="export-actions"><a href={`/api/v1/reports/${ticker}?format=markdown`}>MARKDOWN<span>.md</span></a><a href={`/api/v1/reports/${ticker}?format=pdf`}>PDF<span>.pdf</span></a><a href={`/api/v1/reports/${ticker}?format=xlsx`}>EXCEL<span>.xlsx</span></a></div><small>文件按请求即时生成，不把用户报告上传到第三方对象存储。</small></article>
    </section>
  </>;
}
