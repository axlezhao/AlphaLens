# AlphaLens WorkBuddy Skill

在 WorkBuddy 的“技能”页面选择上传技能，导入此目录的压缩包；或在创建技能时以 `SKILL.md` 作为工作流指令。先配置 Web Search/Agent Browser 和一个市场数据连接器，再使用：

> 研究 NVDA，判断 AI 数据中心增长是否已被充分计价，生成投资论点并加入观察池。

或执行组合任务：

> 基于我提供的美股持仓快照，分析行业、因子、币种、事件、集中度和压力风险，并把论点证伪与风险预算翻译成行动条件；不要下单。

或执行平台研究任务：

> 使用 Evidence-first Workflow，把 NVDA 的 filings、隐含预期与反方审查分配给独立 Agent，保留仲裁解释和少数意见，质量评估通过后提交团队审批。

正式环境应为 SEC 请求设置合规的 User-Agent，并通过 WorkBuddy/MCP 的凭据注入保存第三方密钥，不要写进 Skill 文件。
