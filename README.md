# 【金融】AlphaLens

> 先看证据，再做判断。

AlphaLens 是一个基于腾讯 WorkBuddy 思路构建的美股投资研究与辅助决策系统。它不尝试预测明天涨跌，也不直接替用户荐股；它把 SEC 文件、公司 IR、财务数据、市场预期、行业信号和用户观点整理成一条可追溯、可证伪、可持续更新的投资研究链路。

[在线体验 AlphaLens](https://alphalens-investment-os.tracyaxle.chatgpt.site)

![AlphaLens](public/og.png)

## 为什么做 AlphaLens

个人投资者真正缺少的通常不是更多资讯，而是将资讯转化为决策所需的结构：

- 重要结论来自哪里，数据截至什么时候；
- 哪些是事实、市场预期、模型推断或个人观点；
- 多头逻辑和空头逻辑分别由什么证据支持；
- 当前价格已经隐含了怎样的增长和利润率；
- 哪些指标出现时，原投资论点应被判定为错误；
- 财报或重大事件后，应该怎样更新论点并复盘。

AlphaLens 因此被设计成“投资论点操作系统”，而不是资讯聚合器或 AI 荐股机器人。

## 当前 Beta

0.4 Beta 已在可恢复、可审计的研究后端之上完成 P0、P1 与 P2 组合层辅助决策，同时保留稳定的比赛展示界面：

1. 输入股票代码或研究问题；
2. 异步检索 SEC、获准的公司 IR、行情与一致预期，并执行证据核验；
3. 生成结构化投资论点；
4. 查看支持证据、反对证据和证伪条件；
5. 调整收入增长和估值倍数，观察 Bull/Base/Bear 结果；
6. 在证据库中区分事实、预期和风险；
7. 跟踪后续财报与催化剂。

“个人工作台”现已支持用户自定义观察池、论点版本时间线、可编辑证伪条件、财报前 Preview / 财报后 Deep Dive、官方 IR 催化剂刷新、邮件/企业微信/微信公众号连接器、同行比较、当前价格隐含预期反推、复盘与认知偏差统计，以及 Markdown、PDF、Excel 报告导出。

“组合决策”现已支持持仓与观察池统一视图，行业/因子/币种/事件暴露，Gross/Net/β 调整暴露，Top‑5/HHI 集中度、基于用户导入日收益率的 Pearson 相关性、流动性退出天数、多维压力情景、组合催化剂，以及论点弱化/证伪/风险预算联动。系统只生成可确认、可审计的行动条件，没有券商连接器、订单对象或自动下单路径。

其中，企业微信使用官方机器人 Webhook；邮件需要配置 Resend；个人微信提醒需要已获授权的微信公众号能力。未配置凭据的通道会显示为“需密钥/需官方账号”，不会伪造发送成功。

研究问题支持中文及其他 Unicode 文本；客户端只把问题的 SHA-256 摘要写入 `Idempotency-Key`，原始问题始终保留在 UTF-8 JSON 请求体中。

展示标的包括 NVDA、MSFT 和 AMZN；展示层的示例卡片用于比赛现场稳定演示，点击“发起深度研究”则进入真实的多租户异步任务 API。没有合法行情授权时系统明确降级，不会用固定示例冒充实时数据。

## 核心设计原则

- **证据优先**：所有重要结论都应关联来源、发布时间和数据截至时间。
- **事实与观点分离**：严格区分 `FACT`、`EXPECTATION`、`INFERENCE`、`USER_VIEW` 和 `UNVERIFIED`。
- **强制反方审查**：系统必须主动寻找与用户原观点相反的证据。
- **论点必须可证伪**：用具体 KPI、阈值和连续期间描述何时判错。
- **估值展示假设**：目标价格只是收入、利润率和估值倍数等假设的结果。
- **不自动交易**：系统仅辅助研究，不调用券商下单接口。
- **演示与生产分层**：演示数据保证稳定，生产数据通过统一契约替换。

## 系统结构

```text
WorkBuddy / Web UI
        │
        ▼
Research Orchestrator
        │
        ├── SEC / Company IR
        ├── Market Data / Consensus
        ├── News / Events / FRED
        └── User Research Context
        │
        ▼
Normalization & Evidence Graph
        │
        ├── Thesis Engine
        ├── Scenario & Valuation Engine
        ├── Risk Challenger
        └── Catalyst Monitor
        │
        ▼
Decision Card / Watchlist / Review Log
```

详细设计见：

- [架构链路、Workflow 与思维逻辑](docs/ARCHITECTURE_AND_WORKFLOW.md)
- [当前能力、待建设能力与未来路线图](docs/CAPABILITIES_AND_ROADMAP.md)
- [Beta 运行、数据治理与上线手册](docs/BETA_OPERATIONS_AND_DATA_GOVERNANCE.md)

## 技术栈

- Next.js / React / TypeScript
- Vinext + Vite
- Cloudflare Workers-compatible runtime
- D1 多租户持久化、P1 工作台与可恢复任务队列
- SEC / IR / Alpha Vantage 弹性 Provider
- Sites Sign in with ChatGPT 与 Workspace RBAC
- WorkBuddy Skill 包：`workbuddy-skill/`
- Sites 私有部署

## 项目目录

```text
.
├── app/                        # Web UI 与 API Routes
│   ├── api/health/             # 健康检查
│   ├── api/v1/research/        # 研究任务 API
│   ├── api/v1/workbench/       # P1 工作台查询与命令 API
│   ├── api/v1/portfolio/       # P2 组合查询与命令 API
│   ├── workbench.tsx           # 个人研究工作台界面
│   └── portfolio.tsx           # 组合辅助决策界面
├── db/ + drizzle/              # 38 张 D1 表与版本化迁移
├── lib/providers/              # SEC、IR、行情/预期与弹性策略
├── lib/research/               # 队列、执行器、证据版本与研究快照
├── lib/workbench/              # 隐含预期、连接器、导出与 P1 领域服务
├── lib/portfolio/              # P2 暴露、相关性、压力测试和行动条件
├── docs/                       # 架构、Workflow 与路线图
├── workbuddy-skill/            # 可导入 WorkBuddy 的 Skill 包
├── tests/                      # 服务端渲染验证
├── public/                     # 品牌与分享资源
└── .openai/hosting.json        # Sites 部署配置
```

## 本地运行

需要 Node.js 22+ 和 pnpm 11+。

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

访问 `http://localhost:3000`。

## 验证

```bash
pnpm run lint
pnpm test
```

`pnpm test` 会执行财务/估值/时间穿越/Provider 契约测试、正式构建和服务端渲染检查。

## API

### 健康检查

```http
GET /api/health
```

### 创建研究任务

```http
POST /api/v1/research
Content-Type: application/json
```

```json
{
  "ticker": "NVDA",
  "question": "AI 数据中心增长是否已经被充分计价？",
  "asOf": "2026-07-17T20:00:00Z"
}
```

接口返回 `202` 和可追踪的 Beta Job。客户端可轮询 `/api/v1/research/:jobId`，或从 `/events` 读取 SSE；任务支持幂等、重试、超时、取消和失败恢复。完整 API 与 Worker 配置见 [Beta 手册](docs/BETA_OPERATIONS_AND_DATA_GOVERNANCE.md)。

### 个人工作台与导出

```http
GET  /api/v1/workbench?ticker=NVDA
POST /api/v1/workbench
POST /api/v1/implied-expectations
GET  /api/v1/reports/NVDA?format=markdown|pdf|xlsx
```

`POST /api/v1/workbench` 使用显式 `action` 执行观察池、论点/证伪条件版本、财报工作流、催化剂、提醒、同行组和复盘写入。所有操作都先经过登录、Workspace RBAC 与审计。

### 组合层辅助决策

```http
GET  /api/v1/portfolio?portfolioId=...
POST /api/v1/portfolio
```

组合写操作使用显式 `action`：`portfolio.create`、`position.save/remove`、`policy.save`、`returns.import`、`scenario.save/run`、`risk.refresh` 与 `condition.acknowledge`。风险输入保留 `as_of`、来源状态和稳定幂等键；输出固定为 `conditions_only_no_order_execution`。

## WorkBuddy Skill

`workbuddy-skill/` 包含：

- `skill.yml`：技能元数据、权限和产物声明；
- `SKILL.md`：八步投研工作流、来源优先级、证据分类与安全约束；
- `README.md`：导入和使用说明。

示例请求：

> 研究 NVDA，判断 AI 数据中心增长是否已被充分计价，生成投资论点并加入观察池。

## 数据与安全边界

- API 密钥只通过服务端环境变量或 WorkBuddy/MCP 凭据注入管理；
- 重要财务数字保留期间、单位、币种和来源；
- 实时数据不可用时必须标明数据陈旧性，不用旧值冒充当前值；
- 第三方行情、估值和新闻数据正式商用前需获得相应授权；
- 当前系统不读取无关私人文件、不执行交易、不承诺投资收益。

## 项目状态

当前属于“比赛可演示、P0 + P1 + P2 可供受控用户验证”的 Beta：核心持久化、身份隔离、异步执行、个人研究工作台、组合辅助决策和质量门禁已落地，但仍不是已经完成所有数据商业授权、消息通道认证、法律审查和高可用演练的正式金融产品。详细边界见 [Beta 手册](docs/BETA_OPERATIONS_AND_DATA_GOVERNANCE.md)。

## Disclaimer

本项目仅用于技术研究与学习，不构成投资建议、证券推荐、收益承诺或交易要约。投资者应独立判断并自行承担风险。
