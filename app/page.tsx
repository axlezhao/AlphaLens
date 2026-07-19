"use client";

import { FormEvent, useMemo, useState } from "react";
import { researchIdempotencyKey } from "../lib/research/idempotency";

type Ticker = "NVDA" | "MSFT" | "AMZN";
type View = "desk" | "thesis" | "scenario" | "evidence";

const stocks: Record<Ticker, {
  name: string; price: number; change: number; status: string; readiness: number;
  thesis: string; next: string; target: number; revenue: number; multiple: number;
}> = {
  NVDA: {
    name: "NVIDIA", price: 172.41, change: 2.84, status: "论点增强", readiness: 92,
    thesis: "市场低估了推理需求对数据中心收入持续性的贡献，但高估值压缩了容错空间。",
    next: "Q2 FY27 财报", target: 196, revenue: 38, multiple: 31,
  },
  MSFT: {
    name: "Microsoft", price: 503.72, change: 0.61, status: "等待验证", readiness: 86,
    thesis: "Azure AI 增长与 Copilot 商业化能够抵消基础设施折旧压力，关键分歧在利润率。",
    next: "FY27 Q1 财报", target: 548, revenue: 17, multiple: 29,
  },
  AMZN: {
    name: "Amazon", price: 232.18, change: -0.74, status: "论点稳定", readiness: 88,
    thesis: "AWS 增长再加速与零售效率改善尚未被完全计入，但资本开支是核心风险。",
    next: "AWS re:Invent", target: 264, revenue: 14, multiple: 24,
  },
};

const nav: { id: View; label: string; short: string }[] = [
  { id: "desk", label: "今日研究台", short: "01" },
  { id: "thesis", label: "投资论点", short: "02" },
  { id: "scenario", label: "情景实验室", short: "03" },
  { id: "evidence", label: "证据库", short: "04" },
];

const evidence = [
  { type: "FACT", title: "数据中心收入同比增长 73%", source: "FY27 Q1 10-Q · SEC", time: "2小时前", tone: "positive", quote: "增长由加速计算与生成式 AI 的持续需求推动。" },
  { type: "EXPECTATION", title: "市场隐含未来两年收入 CAGR 约 34%", source: "一致预期快照 · 17 Jul", time: "4小时前", tone: "neutral", quote: "当前价格要求增长保持在历史高位区间。" },
  { type: "FACT", title: "下一代架构量产进度符合计划", source: "财报电话会 · 公司 IR", time: "昨日", tone: "positive", quote: "供应约束预计在下两个季度逐步缓解。" },
  { type: "RISK", title: "客户自研芯片投入继续提升", source: "Hyperscaler CapEx 交叉核验", time: "昨日", tone: "negative", quote: "替代不会立即发生，但可能限制远期市场份额。" },
];

const catalysts = [
  { day: "28", month: "AUG", title: "Q2 FY27 财报", tag: "高影响", detail: "收入指引 · 毛利率 · Blackwell 供给" },
  { day: "15", month: "SEP", title: "行业供应链数据", tag: "验证", detail: "HBM 出货 · 先进封装利用率" },
  { day: "06", month: "OCT", title: "开发者大会", tag: "催化", detail: "新品路线图 · 推理平台进展" },
];

function MiniBars({ negative = false }: { negative?: boolean }) {
  const heights = negative ? [62, 54, 69, 47, 42, 55, 38, 34] : [32, 44, 39, 56, 51, 68, 73, 86];
  return <div className="mini-bars" aria-hidden="true">{heights.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>;
}

export default function Home() {
  const [view, setView] = useState<View>("desk");
  const [ticker, setTicker] = useState<Ticker>("NVDA");
  const [query, setQuery] = useState("");
  const [researching, setResearching] = useState(false);
  const [toast, setToast] = useState("");
  const [revenue, setRevenue] = useState(stocks.NVDA.revenue);
  const [multiple, setMultiple] = useState(stocks.NVDA.multiple);
  const [filter, setFilter] = useState("ALL");
  const stock = stocks[ticker];

  const scenarioPrice = useMemo(() => {
    const growthEffect = 1 + (revenue - stock.revenue) * 0.018;
    const multipleEffect = multiple / stock.multiple;
    return Math.round(stock.target * growthEffect * multipleEffect);
  }, [multiple, revenue, stock]);

  const upside = Math.round(((scenarioPrice / stock.price) - 1) * 100);

  function chooseTicker(next: Ticker) {
    setTicker(next);
    setRevenue(stocks[next].revenue);
    setMultiple(stocks[next].multiple);
  }

  async function runResearch(event?: FormEvent) {
    event?.preventDefault();
    const normalized = query.trim().toUpperCase();
    if (normalized in stocks) chooseTicker(normalized as Ticker);
    setResearching(true);
    setToast("");
    try {
      const selectedTicker = normalized in stocks ? normalized : ticker;
      const question = query.trim().length >= 8 ? query.trim() : `核验 ${selectedTicker} 的核心投资论点、估值假设与未来催化剂`;
      const asOf = new Date().toISOString();
      const idempotencyKey = await researchIdempotencyKey({ ticker: selectedTicker, question, asOfDate: asOf.slice(0, 10) });
      const response = await fetch("/api/v1/research", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ ticker: selectedTicker, question, asOf }) });
      const payload = await response.json() as { data?: { id: string; status: string }; error?: { message: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "研究任务创建失败");
      setToast(`研究任务已进入队列 · ${payload.data.id.slice(-8)}`);
      const final = await pollJob(payload.data.id);
      setView("thesis");
      setToast(final === "succeeded" ? "研究完成：证据快照已保存" : final === "queued" || final === "running" ? "研究正在后台执行，可稍后查看任务状态" : `研究任务状态：${final}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "研究服务暂时不可用");
    } finally {
      setResearching(false);
      window.setTimeout(() => setToast(""), 5200);
    }
  }

  async function pollJob(jobId: string) {
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      const response = await fetch(`/api/v1/research/${jobId}`, { cache: "no-store" });
      if (!response.ok) break;
      const payload = await response.json() as { data?: { status?: string } };
      const status = payload.data?.status ?? "queued";
      if (["succeeded", "failed", "cancelled"].includes(status)) return status;
    }
    return "queued";
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">A</span><div><strong>AlphaLens</strong><small>INVESTMENT OS</small></div></div>
        <nav aria-label="主导航">
          {nav.map((item) => (
            <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}>
              <span>{item.short}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="watch-label"><span>观察池</span><button aria-label="添加标的">+</button></div>
        <div className="watch-list">
          {(Object.keys(stocks) as Ticker[]).map((symbol) => {
            const item = stocks[symbol];
            return <button key={symbol} className={ticker === symbol ? "watch-item selected" : "watch-item"} onClick={() => chooseTicker(symbol)}>
              <span className="ticker-avatar">{symbol.slice(0, 1)}</span>
              <span><strong>{symbol}</strong><small>{item.name}</small></span>
              <span className={item.change >= 0 ? "price-up" : "price-down"}>{item.change >= 0 ? "+" : ""}{item.change}%</span>
            </button>;
          })}
        </div>
        <div className="system-state"><span className="pulse" /><div><strong>Research engine</strong><small>7 个数据源在线</small></div></div>
        <div className="legal-note">研究与学习用途，不构成投资建议</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <form className="command" onSubmit={runResearch}>
            <span>⌕</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入代码或研究问题，例如：NVDA 的增长是否已被充分计价？" aria-label="研究问题" />
            <kbd>⌘ K</kbd>
          </form>
          <button className="research-button" onClick={() => runResearch()} disabled={researching}>
            {researching ? <><i className="spinner" />研究进行中</> : <><span>✦</span> 发起深度研究</>}
          </button>
          <button className="icon-button" aria-label="通知">◌<i>3</i></button>
          <a className="avatar" href="/signin-with-chatgpt?return_to=%2F" title="使用 ChatGPT 登录">登录</a>
        </header>

        <div className="content">
          <div className="eyebrow"><span>ALPHALENS / {view.toUpperCase()}</span><span>数据截至 2026.07.17 · 16:00 ET</span></div>

          {view === "desk" && <Desk stock={stock} ticker={ticker} setView={setView} />}
          {view === "thesis" && <Thesis stock={stock} ticker={ticker} setView={setView} />}
          {view === "scenario" && <Scenario stock={stock} ticker={ticker} revenue={revenue} multiple={multiple} scenarioPrice={scenarioPrice} upside={upside} setRevenue={setRevenue} setMultiple={setMultiple} />}
          {view === "evidence" && <Evidence filter={filter} setFilter={setFilter} />}
        </div>
      </section>

      {researching && <div className="research-overlay" role="status" aria-live="polite"><div className="research-card"><div className="scan-line" /><span className="ai-orb">✦</span><h2>正在构建投资论点</h2><p>检索 SEC 文件、公司材料、市场预期与行业信号</p><ol><li className="done">识别证券与研究意图</li><li className="done">核验权威来源</li><li className="active-step">提取 KPI 与关键分歧</li><li>生成情景估值与反方审查</li></ol></div></div>}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}

function Desk({ stock, ticker, setView }: { stock: typeof stocks.NVDA; ticker: Ticker; setView: (v: View) => void }) {
  return <>
    <section className="hero-row">
      <div><p className="section-kicker">GOOD AFTERNOON, TRACY</p><h1>先看证据，<em>再做判断。</em></h1><p className="hero-copy">今天有 <strong>3 个论点更新</strong>、<strong>2 个高影响催化剂</strong>需要你关注。</p></div>
      <div className="market-status"><span className="pulse" />美股盘前 <strong>04:32:18</strong><small>S&amp;P 500 FUTURES +0.24%</small></div>
    </section>

    <section className="metric-grid">
      <article className="metric-card feature"><div className="card-label">研究完备度</div><div className="metric-main"><strong>{stock.readiness}</strong><span>/100</span></div><div className="progress"><i style={{ width: `${stock.readiness}%` }} /></div><p>证据可靠性与正反观点覆盖良好</p></article>
      <article className="metric-card"><div className="card-label">组合观察</div><div className="metric-main"><strong>12</strong><span>只股票</span></div><MiniBars /><p><b className="good">↑ 3</b> 个论点本周增强</p></article>
      <article className="metric-card"><div className="card-label">风险温度</div><div className="metric-main"><strong>42</strong><span>/100</span></div><MiniBars negative /><p><b className="warn">中性</b> 事件集中度略有上升</p></article>
      <article className="metric-card"><div className="card-label">本周研究时间</div><div className="metric-main"><strong>6.4</strong><span>小时</span></div><div className="saved-time">节省 11.8h</div><p>相较手工研究流程</p></article>
    </section>

    <section className="dashboard-grid">
      <article className="panel thesis-preview">
        <div className="panel-head"><div><span className="live-dot" />重点论点</div><button onClick={() => setView("thesis")}>查看完整论点 →</button></div>
        <div className="stock-head"><div className="stock-symbol">N</div><div><span>{ticker} · NASDAQ</span><h2>{stock.name}</h2></div><div className="quote"><strong>${stock.price}</strong><span className={stock.change >= 0 ? "price-up" : "price-down"}>{stock.change >= 0 ? "+" : ""}{stock.change}%</span></div></div>
        <div className="status-row"><span className="status-chip">{stock.status}</span><span>目标价 <strong>${stock.target}</strong></span><span>潜在空间 <strong className="good">+{Math.round((stock.target / stock.price - 1) * 100)}%</strong></span></div>
        <blockquote>“{stock.thesis}”</blockquote>
        <div className="evidence-balance"><div><span>支持证据</span><strong>8</strong><i className="green-line" /></div><div><span>反对证据</span><strong>4</strong><i className="red-line" /></div><div><span>待验证</span><strong>3</strong><i className="gray-line" /></div></div>
        <div className="next-trigger"><span>下一验证点</span><strong>{stock.next}</strong><small>42 天后</small></div>
      </article>

      <article className="panel catalyst-panel">
        <div className="panel-head"><div>催化剂日历</div><button>全部事件 →</button></div>
        <div className="catalyst-list">{catalysts.map((item) => <div className="catalyst" key={item.title}><div className="date"><strong>{item.day}</strong><span>{item.month}</span></div><div><div><h3>{item.title}</h3><span>{item.tag}</span></div><p>{item.detail}</p></div></div>)}</div>
        <div className="event-risk"><span>未来 60 天事件风险</span><div><i /><i /><i className="hot" /><i className="hot" /><i /><i /></div><strong>偏高</strong></div>
      </article>
    </section>

    <section className="panel signal-feed"><div className="panel-head"><div>实时证据信号 <span className="count">24</span></div><button onClick={() => setView("evidence")}>进入证据库 →</button></div><div className="signal-row">{evidence.slice(0, 3).map((item) => <article key={item.title}><span className={`type ${item.tone}`}>{item.type}</span><h3>{item.title}</h3><p>{item.source}</p><time>{item.time}</time></article>)}</div></section>
  </>;
}

function Thesis({ stock, ticker, setView }: { stock: typeof stocks.NVDA; ticker: Ticker; setView: (v: View) => void }) {
  return <>
    <section className="page-title"><div><p className="section-kicker">THESIS TRACKER / {ticker}</p><h1>投资论点不是结论，<em>而是待验证的假设。</em></h1></div><button className="outline-button" onClick={() => setView("scenario")}>打开情景实验室 ↗</button></section>
    <section className="thesis-layout">
      <article className="panel core-thesis"><div className="panel-head"><div>核心分歧</div><span className="status-chip">{stock.status}</span></div><h2>{stock.thesis}</h2><div className="thesis-meta"><span>建立于 2026.05.29</span><span>最后核验 2 小时前</span><span>版本 v1.8</span></div><div className="conviction"><span>当前确信度</span><strong>74%</strong><div className="progress"><i style={{ width: "74%" }} /></div><small>较建立时 +9pt</small></div></article>
      <article className="panel decision-card"><div className="panel-head"><div>决策状态</div><span>系统建议</span></div><div className="decision-state">保持观察</div><p>基本面证据继续增强，但当前价格未提供足够安全边际。</p><div className="decision-numbers"><div><span>现价</span><strong>${stock.price}</strong></div><div><span>关注区间</span><strong>${Math.round(stock.price * .86)}–${Math.round(stock.price * .92)}</strong></div><div><span>基础目标</span><strong>${stock.target}</strong></div></div></article>
    </section>
    <section className="argument-grid"><article className="panel argument support"><div className="argument-title"><span>↑</span><div><h2>支持论点</h2><p>8 条已核验证据</p></div></div>{["推理工作负载带来更持续的加速计算需求", "新架构供应约束逐季缓解", "云厂商 AI 资本开支指引继续上调"].map((t, i) => <div className="argument-item" key={t}><span>0{i + 1}</span><div><strong>{t}</strong><small>高可信 · 权威来源交叉核验</small></div><b>+{9 - i * 2}</b></div>)}</article><article className="panel argument oppose"><div className="argument-title"><span>↓</span><div><h2>反对论点</h2><p>4 条风险证据</p></div></div>{["当前估值隐含长期高增长，容错空间有限", "主要客户自研芯片的替代风险上升", "出口限制可能压缩可服务市场"].map((t, i) => <div className="argument-item" key={t}><span>0{i + 1}</span><div><strong>{t}</strong><small>持续监测 · 尚未触发证伪</small></div><b>-{8 - i * 2}</b></div>)}</article></section>
    <section className="panel falsifiers"><div className="panel-head"><div>证伪条件 <span className="count">3</span></div><span>满足任一条件，论点自动降级</span></div><div className="falsifier-grid"><div><span>KPI 01</span><strong>数据中心收入增速</strong><p>连续两个季度低于 30%</p><i>当前 73% · 安全</i></div><div><span>KPI 02</span><strong>调整后毛利率</strong><p>跌破 68% 且无一次性解释</p><i>当前 72.4% · 关注</i></div><div><span>KPI 03</span><strong>Hyperscaler CapEx</strong><p>合计指引同比转负</p><i>当前 +31% · 安全</i></div></div></section>
  </>;
}

function Scenario({ stock, ticker, revenue, multiple, scenarioPrice, upside, setRevenue, setMultiple }: { stock: typeof stocks.NVDA; ticker: Ticker; revenue: number; multiple: number; scenarioPrice: number; upside: number; setRevenue: (v: number) => void; setMultiple: (v: number) => void }) {
  const cases = [{ name: "Bear", probability: 20, growth: revenue - 13, margin: 66, price: Math.round(scenarioPrice * .68), tone: "bear" }, { name: "Base", probability: 55, growth: revenue, margin: 72, price: scenarioPrice, tone: "base" }, { name: "Bull", probability: 25, growth: revenue + 11, margin: 76, price: Math.round(scenarioPrice * 1.31), tone: "bull" }];
  return <>
    <section className="page-title"><div><p className="section-kicker">SCENARIO LAB / {ticker}</p><h1>价格是结果，<em>假设才是决策。</em></h1><p>调整关键驱动，实时查看估值与风险收益变化。</p></div><div className="live-model"><span className="pulse" />模型实时计算</div></section>
    <section className="scenario-layout"><article className="panel controls"><div className="panel-head"><div>基础情景参数</div><button onClick={() => { setRevenue(stock.revenue); setMultiple(stock.multiple); }}>重置</button></div><label><span><b>未来两年收入 CAGR</b><strong>{revenue}%</strong></span><input type="range" min="10" max="60" value={revenue} onChange={(e) => setRevenue(Number(e.target.value))} /><small><span>10%</span><span>60%</span></small></label><label><span><b>远期市盈率</b><strong>{multiple}×</strong></span><input type="range" min="15" max="50" value={multiple} onChange={(e) => setMultiple(Number(e.target.value))} /><small><span>15×</span><span>50×</span></small></label><div className="assumption"><span>利润率假设</span><strong>72%</strong><small>基于管理层指引中值</small></div><div className="assumption"><span>稀释后股数</span><strong>24.6B</strong><small>最近季度加权平均</small></div></article><article className="panel model-output"><span>基础情景目标价</span><strong className="giant-price">${scenarioPrice}</strong><div className={upside >= 0 ? "upside positive" : "upside negative"}>{upside >= 0 ? "+" : ""}{upside}% <small>相对现价 ${stock.price}</small></div><div className="price-track"><i style={{ left: `${Math.min(88, Math.max(8, (stock.price / scenarioPrice) * 60))}%` }}><span>现价</span></i><b style={{ left: "72%" }}><span>目标</span></b></div><p>当前价格隐含收入 CAGR 约 <strong>{Math.max(8, revenue - 6)}%</strong> 与远期市盈率 <strong>{Math.max(12, multiple - 3)}×</strong>。</p></article></section>
    <section className="case-grid">{cases.map(c => <article className={`panel case ${c.tone}`} key={c.name}><div><span>{c.name.toUpperCase()} CASE</span><strong>{c.probability}% 概率</strong></div><h2>${c.price}</h2><p className={c.price > stock.price ? "good" : "bad"}>{Math.round((c.price / stock.price - 1) * 100)}% vs. 现价</p><dl><div><dt>收入 CAGR</dt><dd>{c.growth}%</dd></div><div><dt>毛利率</dt><dd>{c.margin}%</dd></div><div><dt>估值倍数</dt><dd>{Math.round(multiple * (c.tone === "bear" ? .72 : c.tone === "bull" ? 1.18 : 1))}×</dd></div></dl></article>)}</section>
    <section className="panel sensitivity"><div className="panel-head"><div>敏感性矩阵</div><span>目标价 / 收入增速 × 估值倍数</span></div><div className="matrix"><div /><span>25×</span><span>30×</span><span>35×</span><span>40×</span>{[22, 30, 38, 46].flatMap((g, row) => [<b key={`r${g}`}>{g}%</b>, ...[25, 30, 35, 40].map((m, col) => <i key={`${g}-${m}`} className={row === 2 && col === 1 ? "selected-cell" : ""}>${Math.round(scenarioPrice * (g / revenue) * (m / multiple))}</i>)])}</div></section>
  </>;
}

function Evidence({ filter, setFilter }: { filter: string; setFilter: (v: string) => void }) {
  const visible = filter === "ALL" ? evidence : evidence.filter((item) => item.type === filter);
  return <>
    <section className="page-title"><div><p className="section-kicker">EVIDENCE GRAPH</p><h1>每一个判断，<em>都能回到原始证据。</em></h1><p>事实、预期、推断与风险严格分层，避免把观点包装成事实。</p></div><div className="source-health"><span>来源健康度</span><strong>98.7%</strong><small>24 / 25 在线</small></div></section>
    <section className="evidence-toolbar"><div>{["ALL", "FACT", "EXPECTATION", "RISK"].map(f => <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f === "ALL" ? "全部证据" : f}</button>)}</div><span>共 24 条 · 6 条已交叉核验</span></section>
    <section className="evidence-layout"><div className="evidence-list">{visible.map((item, index) => <article className="panel evidence-card" key={item.title}><div className="evidence-index">E-{String(index + 1).padStart(3, "0")}</div><div><div className="evidence-top"><span className={`type ${item.tone}`}>{item.type}</span><time>{item.time}</time></div><h2>{item.title}</h2><blockquote>“{item.quote}”</blockquote><div className="source-row"><span>↗ {item.source}</span><span>可信度 <strong>{96 - index * 3}%</strong></span><span>交叉核验 <strong>{index < 3 ? "2 个来源" : "待补充"}</strong></span></div></div></article>)}</div><aside className="panel provenance"><div className="panel-head"><div>证据分层</div><span>PROVENANCE</span></div><div className="provenance-score"><strong>94</strong><span>/100</span><p>整体证据质量</p></div><dl><div><dt>监管文件 / 公司 IR</dt><dd>12</dd></div><div><dt>市场数据与预期</dt><dd>7</dd></div><div><dt>可信媒体</dt><dd>4</dd></div><div><dt>Agent 推断</dt><dd>1</dd></div></dl><div className="rule"><strong>证据规则</strong><p>关键财务数字至少需要一个权威来源；重大结论至少需要两个独立来源交叉核验。</p></div></aside></section>
  </>;
}
