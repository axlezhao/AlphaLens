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

0.2 Beta 已把原有同步 Demo 升级为可恢复、可审计的研究后端，同时保留稳定的比赛展示界面：

1. 输入股票代码或研究问题；
2. 异步检索 SEC、获准的公司 IR、行情与一致预期，并执行证据核验；
3. 生成结构化投资论点；
4. 查看支持证据、反对证据和证伪条件；
5. 调整收入增长和估值倍数，观察 Bull/Base/Bear 结果；
6. 在证据库中区分事实、预期和风险；
7. 跟踪后续财报与催化剂。

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
- D1 多租户持久化与可恢复任务队列
- SEC / IR / Alpha Vantage 弹性 Provider
- Sites Sign in with ChatGPT 与 Workspace RBAC
- WorkBuddy Skill 包：`workbuddy-skill/`
- Sites 私有部署

## 项目目录

```text
.
├── app/                        # Web UI 与 API Routes
│   ├── api/health/             # 健康检查
│   └── api/v1/research/        # 研究任务 API
├── db/ + drizzle/              # 18 张 D1 表与版本化迁移
├── lib/providers/              # SEC、IR、行情/预期与弹性策略
├── lib/research/               # 队列、执行器、证据版本与研究快照
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

当前属于“比赛可演示、可供受控用户验证”的 Beta：核心持久化、身份隔离、异步执行和质量门禁已落地，但仍不是已经完成所有数据商业授权、法律审查和高可用演练的正式金融产品。详细边界见 [Beta 手册](docs/BETA_OPERATIONS_AND_DATA_GOVERNANCE.md)。

## Disclaimer

本项目仅用于技术研究与学习，不构成投资建议、证券推荐、收益承诺或交易要约。投资者应独立判断并自行承担风险。
