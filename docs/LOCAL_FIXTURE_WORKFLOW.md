# 本地 Fixture 工作流

此工作流让新克隆的 AlphaLens 在**没有真实市场数据密钥、没有外部 LLM、没有生产身份服务**的情况下，运行一个隔离的 D1 研究任务链路。

它只用于开发与回归验证。Fixture 数据是合成数据，来源域名为 `fixtures.alphalens.invalid`，不得作为行情、公司披露、回测数据或投资依据。

## 前置条件

- Node.js 24 与 pnpm 11.9.0；
- 本机回环地址可用；
- 不要传入 `--host 0.0.0.0`、Tunnel 或真实 Provider/模型密钥。

## 从新克隆启动

```bash
git clone https://github.com/axlezhao/AlphaLens.git
cd AlphaLens
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm db:local:migrate
pnpm dev:local
```

`wrangler.local.jsonc` 只定义本地 D1 `alphalens-local`，状态写入被 git 忽略的 `.wrangler/state/`。`db:local:migrate` 没有 `--remote`，因此不会读取、写入或迁移任何远程 D1 数据库。

`.dev.vars` 中的账户必须是 `.invalid` 域名。仅当以下全部条件满足时，应用才创建该固定 fixture 身份：

1. `ALPHALENS_LOCAL_DEVELOPMENT=true`；
2. `ALPHALENS_FIXTURE_MODE=true`；
3. 请求来自 `localhost`、`127.0.0.1` 或 `::1`；
4. 邮箱以 `.invalid` 结尾。

浏览器提交的身份头不会启用该模式；非回环请求仍需要可信托管身份。不要将 `.dev.vars` 提交到 Git。

## 验证完整链路

保持 `pnpm dev:local` 运行，并在第二个终端执行：

```bash
pnpm local:verify
```

或让脚本自行启动并关闭一个仅回环的临时服务：

```bash
pnpm local:verify:e2e
```

验证器会：

1. 创建 AAPL fixture 研究任务；
2. 调用仅对 loopback fixture 请求开放的本地 research worker；
3. 查询完成任务，确认 `snapshot.sourceMode === "fixture"` 且有来源；
4. 创建 MSFT fixture 任务、取消它并确认终态为 `cancelled`。

默认 fixture 模式会设置 `ALPHALENS_LOCAL_MANUAL_WORKER=true`，避免创建 API 自动执行任务，从而可以稳定验证取消行为。真实部署不应设置这些本地变量。

## 清理与边界

停止本地服务后，可按你自己的本机数据策略删除 `.wrangler/state/` 以重置 fixture 数据库。该路径永远不应指向生产 D1。

本地 fixture 通过只证明：迁移、认证边界的本地分支、研究队列、执行、查询、取消和结果展示能协同工作。它**不**证明真实 SEC/IR/行情连通性、数据授权、生产登录、租户攻击防护、异步恢复或投资研究准确性。
