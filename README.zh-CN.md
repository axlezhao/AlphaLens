# AlphaLens

先看证据，再做判断。

[English](README.md) · [独立平台完整方案](docs/PRODUCT_ARCHITECTURE_PLAN.md) · [能力与路线图](docs/CAPABILITIES_AND_ROADMAP.md) · [开发指南](docs/DEVELOPMENT.md) · [架构与研究逻辑](docs/ARCHITECTURE_AND_WORKFLOW.md)

AlphaLens 是由 [axlezhao](https://github.com/axlezhao) 维护的个人开源美股研究工作台，探索如何把可追溯证据、可证伪论点、情景估值和组合风险放进同一个可复核流程。项目起源于比赛原型，现在作为独立 GitHub 项目持续维护，不再以参赛要求作为产品边界。

## 当前状态

**`0.5.0-beta`：实验性 Beta，不是生产就绪系统。** 已有界面、领域模型、数据适配器和确定性计算，但不能把“有实现”写成“完整验证”。

- 首页研究台、论点卡包含示例数据，并已明确标注；研究任务完成后会进入独立结果页，展示该任务实际保存的来源、URL、`as_of`、抓取时间、新鲜度、缺口和警告，但不会替换示例论点卡或自动生成论点。
- 异步研究任务目前收集数据源快照，不调用外部 LLM，也不会自动生成有证据支撑的投资论点。
- 多 Agent 仲裁和质量评分是启发式实验，不代表经校准的投资置信度。
- 新克隆可运行仅限 loopback 的 fixture D1 工作流与 `.invalid` 开发身份；D1 迁移已对核心研究/组合的跨 Workspace 引用做完整性拦截并可在本地验证。请求级 Workspace RBAC（`requireWorkspaceAccess` / `requirePortfolioAccess`）统一了所有路由的 401/403/404，双租户 HTTP 测试覆盖完整权限矩阵，成员管理 API 与安全的控制性 Owner 转移端点（目标必须是已有成员）补全了多租户模型。研究任务经可恢复状态机执行（原子 lease 领取 + 每次领取唯一 lease token、有限重试与退避、lease 回收、取消优先），Webhook 经 at-least-once Outbox 投递（lease token + compare-and-set 状态转换、原始响应体不落库）。通知 Outbox 目前仅入队/投递、尚未达到与 Webhook 同级的 lease/CAS 保护，因此不宣称「已可靠投递通知」。这仍不等于生产级认证（OAuth/SSO）。

[在线预览](https://alphalens-investment-os.tracyaxle.chatgpt.site)可能要求登录或所有者授权。仓库公开不代表在线 Workspace 公开；本次整理未改变部署访问权限。

![AlphaLens 界面预览：示例数据，非实时行情](public/og.png)

## 已有基础与限制

| 模块 | 已有实现 | 仍需解决 |
| --- | --- | --- |
| 数据与证据 | SEC、获准公司 IR、Alpha Vantage 适配器，缓存/重试/陈旧性标记 | 数据许可与实际凭据、全局 SEC 限速、历史时间点来源 |
| 研究任务 | D1 队列、幂等、事件、证据版本、研究快照和真实来源结果页 | 自动论点生成、恢复与租户端到端验证 |
| 个人工作台 | 观察池、论点时间线、证伪条件、财报任务、导出与提醒适配器 | 外部通道验证、完整用户旅程 |
| 组合分析 | 暴露、集中度、导入收益率相关性、情景压力与行动条件 | 输入质量、模型边界与回归样本扩充 |
| 平台实验 | Workflow、KPI/Skill Registry、团队发布、API Key/Webhook | 审批恢复、真实模型分工、权限隔离、跨供应商故障切换与安全加固 |

完整状态见[能力清单](docs/CAPABILITIES_AND_ROADMAP.md)。WorkBuddy 目录目前是可选研究指令包，尚不能宣称已验证一键导入或与后端完整集成。

[独立平台完整方案](docs/PRODUCT_ARCHITECTURE_PLAN.md)定义了 DeepSeek BYOK、真实研究闭环、LLM Gateway、MCP 接入、安全与阶段验收；该文档是实施方案，不代表这些能力已经完成。

## 本地开发

使用 Node.js 24 与 `package.json` 固定的 pnpm 11.9.0：

```bash
git clone https://github.com/axlezhao/AlphaLens.git
cd AlphaLens
nvm use                     # 可选：已安装 nvm 时使用
npm install --global pnpm@11.9.0
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

访问终端输出的本地地址。不配置付费数据密钥也可以查看示例界面；登录、研究、数据库写入和定时任务需要额外基础设施。参见[开发指南](docs/DEVELOPMENT.md)与[运行手册](docs/BETA_OPERATIONS_AND_DATA_GOVERNANCE.md)。SEC 请求必须使用真实且有人维护的联系邮箱，不能照搬示例。

如需在不使用任何真实数据、模型或生产凭据的前提下验证完整本地研究链路，请使用[本地 Fixture 工作流](docs/LOCAL_FIXTURE_WORKFLOW.md)：

```bash
cp .dev.vars.example .dev.vars
pnpm db:local:migrate
pnpm local:verify:e2e
```

它会临时启动仅 loopback 服务，验证创建、执行、查询和取消的合成研究任务，随后自动停止。

```bash
pnpm run lint
pnpm run typecheck
pnpm test
pnpm db:local:verify-integrity
```

其中 `db:local:verify-integrity` 在隔离 D1 中验证 owner 成员关系、角色合法性，以及核心研究/组合跨 Workspace 写入被数据库拒绝。上述检查仍不证明实时 Provider 可用、完整请求级租户安全、投资准确率或收益表现。

## 技术与方向

当前使用 TypeScript（不是 Java）、React/Next.js、Vinext/Vite、Cloudflare Workers 与 D1。先做好“真实证据 → 可复核结果 → 用户复盘”的闭环，再根据需求引入 Python 计算服务，不为换语言而重写后端。

下一阶段优先级：

1. 加固出站请求、删除流程及 Workflow 生命周期。A3.2 已交付请求级 RBAC（`requireWorkspaceAccess` / `requirePortfolioAccess` / `listAccessibleWorkspaces`）、全部路由的双租户 HTTP 测试、成员管理 API，以及原子化的控制性 Owner 转移（目标须为已有成员）。A3.3 已交付可恢复的研究任务状态机（原子 lease 领取 + lease token、有限重试、lease 回收、取消优先）、at-least-once 的 Webhook Outbox（防 SSRF URL 校验、lease token + compare-and-set、原始响应体不落库），以及区分个人/共享 Workspace 的安全账户删除后台工作流。通知 Outbox 尚未达到 Webhook 级的 lease/CAS 投递保护，不作为「可靠投递通知」承诺。仍未完成：托管队列、生产 OAuth/SSO、监控告警、合规审批的数据保留策略、通知的 Webhook 级可靠投递。
2. 将结果页扩展为可引用的研究草稿与人工 Review 流程。
3. 再接模型、构建真实评估集，验证自动研究的质量。

[Issue](https://github.com/axlezhao/AlphaLens/issues) · [路线图](docs/CAPABILITIES_AND_ROADMAP.md) · [版本记录](CHANGELOG.md) · [贡献指南](CONTRIBUTING.md) · [安全政策](SECURITY.md)

## 许可与边界

代码采用 [MIT](LICENSE) 许可。依赖、行情、公司文档及第三方内容仍受各自条款约束；开源代码不授予行情再分发权，接入数据前应自行确认授权。

本项目不构成投资建议，示例与输出可能有误，使用者需自行核对来源、时间、假设和计算。项目不自动下单，也不计划加入自动订单执行。
