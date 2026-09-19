# AlphaLens：当前能力与公开路线图

此文件是项目状态的统一入口。定位：独立维护的个人开源美股研究工作台。当前版本 `0.5.0-beta`，实验性 Beta，**未达到生产就绪标准**。P0–P3 是历史设计分组，不是已通过验收的完成证明。

下一阶段的完整目标架构、DeepSeek BYOK、研究状态机和 MCP 边界见[独立平台产品与技术方案](PRODUCT_ARCHITECTURE_PLAN.md)。该方案尚未实现；本文仍以代码当前状态为准。

## 1. 现在能做什么

“已有实现”表示可在代码中定位；不等同于真实环境、全用户路径或安全性已验证。

| 模块 | 当前实现 | 主要代码 | 验证边界 |
| --- | --- | --- | --- |
| 界面 | 研究台、论点、情景、证据与工作台/组合/平台页面 | `app/` | 首页主要使用示例卡片，研究完成后的卡片仍非生成结果 |
| 数据接入 | SEC、获准 IR Feed、Alpha Vantage 行情/预期、缓存/重试/熔断 | `lib/providers/` | 合法凭据与 Feed 配置必需；契约测试非实时连通测试 |
| 持久化 | 59 张领域表、版本、幂等键、`as_of` 和审计 | `db/`, `drizzle/` | 需要 D1 迁移；缺少完整数据库集成测试 |
| 身份与权限 | 可信平台身份头、Workspace RBAC、API Key scope | `lib/auth/`, `lib/platform/` | 依赖可信入口；不可把用户自报身份头当作安全登录 |
| 异步研究 | 任务租约、事件、取消、重试/恢复代码、Provider 快照 | `lib/research/` | 不调用 LLM，不自动产出新论点；恢复竞态需专项测试 |
| 个人研究 | 自定义观察池、版本、证伪条件、财报任务、复盘、同行与反向估值 | `lib/workbench/` | 需后台配置；Preview/Deep Dive 是任务类型，不是完整财报分析模型 |
| 导出和提醒 | Markdown/PDF/XLSX、邮件/企业微信/公众号适配器 | `lib/workbench/` | 外部投递需凭据与实际验证，不支持任意个人微信直发 |
| 组合 | 暴露、集中度、Pearson 相关性、压力测试、风险行动条件 | `lib/portfolio/` | 用户输入与导入收益率；无券商自动同步，不产生订单 |
| 平台控制面 | Workflow/KPI/Skill Registry、评论审批、研究版本、Webhook | `lib/platform/` | 实验性实现；详见下节 |
| 工程检查 | Lint、类型检查、单元测试、构建与 Worker SSR 检查 | `tests/`, `.github/workflows/ci.yml` | CI 不连接付费 Provider；不代表经过安全审计 |
| WorkBuddy | 研究工作流指令包 | `workbuddy-skill/` | 未验证实际客户端导入与后端调用闭环 |

## 2. 现在不能宣称的能力

- **自动 AI 投研**：runner 当前保存来源快照，模型/Prompt 版本字段不是实际模型调用记录。
- **真实独立多 Agent 分析**：角色指令与启发式仲裁存在，但没有独立 LLM 分析和可校准的质量验证。
- **已完成 DAG 生命周期**：审批后恢复、发布节点执行、并发上限与部分失败路径需要完善测试和实现。
- **动态多供应商故障切换**：路由能给出选择与候选 fallback，runner 不会自动遍历其他供应商重试。
- **安全 Skill 沙箱**：Manifest 声明权限校验不等于运行时能力隔离。
- **自动质量 Benchmark**：评分依赖传入指标，界面含示例指标，尚未从真实研究产物计算可信基准。
- **严格历史回测**：保存 `as_of` 不等于按历史时间检索数据；最新 Provider 数据可能包含当时不可得信息。不得作为无泄漏回测数据集。
- **生产级安全与可靠性**：仍需租户对抗测试、出站请求/DNS 安全、Outbox 中断恢复、删除作业验收和全局限流。
- **新用户一键自托管**：当前部署/认证耦合平台；没有完整、独立、从零启动的认证与数据库初始化路径。
- **市场数据使用权**：API Key 或配置确认标记不是授权合同；代码公开不授权再分发。

## 3. 下一阶段：先完成可信研究闭环

公开追踪：[A1 真实结果展示 #1](https://github.com/axlezhao/AlphaLens/issues/1) · [A2 本地可复现 #2](https://github.com/axlezhao/AlphaLens/issues/2) · [A3 隔离与恢复测试 #3](https://github.com/axlezhao/AlphaLens/issues/3) · [A4 Workflow 生命周期 #4](https://github.com/axlezhao/AlphaLens/issues/4)。B1/B2 在基础闭环完成后再细化，不提前承诺完成日期。

| 优先级 | 交付项 | 验收标准 |
| --- | --- | --- |
| A1 | 真实研究结果 UI | 完成任务后读取实际 snapshot；展示 source URL、`fetchedAt`/`as_of`、缺失与 stale；示例数据有明确标签；失败不能展示为成功研究 |
| A2 | 可重复本地开发 | 空目录克隆后按文档初始化隔离数据库，测试身份仅限本地；创建/查询/取消一个 fixture 研究任务；无需生产密钥 |
| A3 | 安全与任务集成测试 | 两租户访问隔离、API scopes、重试/租约失效/取消、通知/Webhook 崩溃恢复、删除完成均有可重跑测试 |
| A4 | Workflow 生命周期 | 审批暂停/恢复、publish、并发限制、依赖失败策略和最终状态均经测试；不留永久 running 的任务 |
| B1 | 可观测的模型适配器 | 输入/输出 schema、模型/Prompt 版本、调用追踪、超时、费用上限和引用校验；先 fixture 后真实调用 |
| B2 | 研究质量评估 | 公开合法 fixture、行业基准案例、引用准确率与数字 tie-out；人工抽检；质量分数不能冒充投资获利概率 |

Release Gate：上述关键路径完成前，不称 production-ready，不公开写入型演示 Workspace，不把启发式分数用于自动投资决策。

## 4. 未来可做什么

- 有明确边界的 Python 分析服务：更复杂估值、因子/情景分析；在测量到需求后引入。
- 更多获准数据源、历史版本与跨源冲突处理；独立验证授权、限流与 fallback。
- 可导入、可回放且权限可控的研究 Skill，以及真实模型角色分工与仲裁。
- 团队评审、稳定开放 API、可解释的研究质量跟踪。
- 脱敏、只读、明确标为示例的公开演示；与个人研究数据隔离，另行决定部署。

不在范围内：自动下单、保证收益、未经许可的数据镜像或再分发。

## 5. 维护约定

新增能力时同步更新 README、本文和相关架构/运行说明；写明实际验证方法与剩余边界。Issue 是工作入口，本文是长期状态摘要，CHANGELOG 只记录已经交付的变化。不要用 P0–P3 完成标签代替可复现验收。

参考：[英文首页](../README.md) · [独立平台完整方案](PRODUCT_ARCHITECTURE_PLAN.md) · [开发指南](DEVELOPMENT.md) · [架构与研究逻辑](ARCHITECTURE_AND_WORKFLOW.md) · [运行手册](BETA_OPERATIONS_AND_DATA_GOVERNANCE.md) · [公开 Issue](https://github.com/axlezhao/AlphaLens/issues)
