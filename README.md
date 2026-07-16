# 【金融】AlphaLens

基于腾讯 WorkBuddy 的美股投资论点与辅助决策系统。它不是荐股机器人，而是一套证据驱动的研究工作台：将 SEC 文件、公司 IR、行情、市场预期和新闻信号组织成可追溯、可证伪、可持续更新的投资论点。

## 比赛演示

1. 在首页输入 `NVDA` 或研究问题并发起深度研究。
2. 展示 Agent 的检索、核验、KPI 提取、估值与反方审查步骤。
3. 在“投资论点”查看支持/反对证据与证伪条件。
4. 在“情景实验室”调整增长和估值倍数，实时查看目标价格。
5. 在“证据库”展示结论到原始来源的溯源关系。

演示数据固定且明确标注截至时间，确保现场稳定；生产数据通过 adapter 层接入，不与界面耦合。

## 快速启动

需要 Node.js 22+。

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

验证：

```bash
pnpm build
pnpm test
```

## 系统边界

```text
WorkBuddy / Web UI
        ↓
Research Orchestrator
        ↓
Source adapters ─ SEC / IR / Market data / News / FRED
        ↓
Normalization ─ Evidence graph ─ Thesis engine
        ↓
Scenario model ─ Risk challenger ─ Catalyst monitor
        ↓
Decision card / Tracker / Review log
```

## 工业化设计

- 数据与 UI 分层：`lib/research/contracts.ts` 是稳定领域契约，provider 可替换。
- 可观测性：所有研究任务带 `requestId`、`traceId`、`asOf` 和状态。
- 证据治理：区分事实、预期、推断和用户观点，保留来源与时间戳。
- 安全：服务端密钥、最小连接权限、请求校验、禁止自动交易。
- 降级策略：实时源不可用时回退到最近快照，并显著标注数据陈旧性。
- 可测试性：演示模式确定性输出；生产 adapter 使用契约测试和来源快照测试。

## API

- `GET /api/health`：健康状态与运行模式。
- `POST /api/v1/research`：创建研究任务，返回 `202` 和可追踪 job。

请求示例：

```json
{
  "ticker": "NVDA",
  "question": "AI 数据中心增长是否已经被充分计价？",
  "asOf": "2026-07-17T20:00:00Z"
}
```

## WorkBuddy

`workbuddy-skill/` 是可导入的 AlphaLens Skill 包，定义来源优先级、证据类型、八步研究工作流、输出目录和安全约束。生产部署建议通过 MCP 将 SEC/IR、市场数据、新闻与持久化服务连接到 WorkBuddy。

## 上线前清单

- 接入有授权的实时/延时行情和一致预期数据；
- 为 SEC、IR 和新闻源实现速率限制、缓存、重试和熔断；
- 增加身份认证、租户隔离、审计日志和数据保留策略；
- 对估值模型做金样测试，对财务口径做人工抽检；
- 完成适用地区的投资研究免责声明与数据许可证审查。

本项目仅用于技术研究与学习，不构成投资建议或交易要约。
