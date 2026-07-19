---
name: alphalens-us-equity-research
description: 面向个人投资者的美股证据研究、投资论点、情景估值、组合暴露、压力测试、催化剂跟踪和复盘。用户提到美股代码、公司、财报、估值、投资论点、观察池、持仓、组合风险或投资复盘时使用。
---

# AlphaLens US Equity Research

## 目标

把一个美股研究问题变成有来源、有截至时间、区分事实与推断、包含证伪条件的研究包。系统仅辅助研究，不执行交易，不输出个性化投资承诺。

## 必须遵守

1. 开始时确认证券代码、交易所、研究问题和 `as_of` 时间。
2. 来源优先级：SEC/公司 IR > 交易所或权威宏观来源 > 已配置市场数据 > 可信媒体。
3. 每条结论标记为 `FACT`、`EXPECTATION`、`INFERENCE`、`USER_VIEW` 或 `UNVERIFIED`。
4. 财务数字必须保留期间、单位、币种和来源；口径冲突时不得静默合并。
5. 重要投资判断至少同时列出支持证据、反对证据和待验证信息。
6. 明确写出什么数据会证明论点错误，禁止只写泛化风险。
7. 没有实时价格或一致预期时明确披露，不得用旧值冒充当前值。
8. 不调用券商交易接口，不读取无关私人文件，不在输出中泄露 API 密钥。
9. 组合数据必须注明是用户输入还是授权 Provider 数据；缺失 NAV、价格、ADV、因子或收益率时输出缺口，不填造风险数字。
10. 组合层只能生成触发谓词和行动条件，不能生成、提交或模拟成已提交的订单。

## 工作流

1. `INTAKE`：识别 ticker、研究期限、问题类型和用户已有观点。
2. `SOURCE`：收集 SEC、IR、财报、电话会、市场预期、行情与行业信号。
3. `NORMALIZE`：统一财务期间、单位、非 GAAP 口径和 KPI 定义。
4. `THESIS`：形成核心分歧、支持/反对证据、未知项和证伪条件。
5. `SCENARIO`：构建 Bear/Base/Bull，披露概率、关键假设与敏感性。
6. `CHALLENGE`：独立检查确认偏误、来源冲突、估值口径和遗漏风险。
7. `PERSIST`：写入 `workspace/alphalens/<TICKER>/`，保留稳定 ID 与版本号。
8. `HANDOFF`：生成一页决策卡、完整报告和下一次复核触发器。

组合任务在 `NORMALIZE` 后增加：

1. `BOOK`：统一 Long、Short、Watch，核对 NAV、价格 `as_of`、币种和数据状态。
2. `EXPOSURE`：计算 Gross/Net/β 调整、行业、因子、币种、事件、Top‑5、HHI 与流动性。
3. `CORRELATION`：只在对齐样本达到门槛时计算 Pearson，并披露覆盖率。
4. `STRESS`：按 ticker、行业、因子、币种和事件冲击，区分情景预算与绝对损失上限。
5. `LINK`：把论点弱化、证伪条件、风险预算和压力结果翻译为复核/重新承保/规模或对冲评估条件。
6. `GUARD`：输出 `conditions_only_no_order_execution`，不得包含订单路由或执行动作。

## 交付目录

```text
workspace/alphalens/<TICKER>/
├── research_report.md
├── thesis.json
├── evidence.json
├── catalysts.json
└── snapshots/<as_of>/
```

组合任务另外生成：

```text
workspace/alphalens/portfolios/<PORTFOLIO>/
├── portfolio_risk.json
├── stress_scenarios.json
└── action_conditions.json
```

## 决策卡字段

- 证券、价格时间戳与研究问题
- 核心分歧与当前论点状态
- 支持、反对和待验证证据
- Bear/Base/Bull 假设与估值区间
- 市场已隐含的增长/利润率要求
- 催化剂、证伪条件和下一次复核时间
- 数据缺口、置信度和研究用途声明
