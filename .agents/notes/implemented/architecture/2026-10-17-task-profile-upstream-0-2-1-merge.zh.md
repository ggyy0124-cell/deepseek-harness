# Agent Note: Task Profile 适配上游 0.2.1 合并

Status: implemented

[English](2026-10-17-task-profile-upstream-0-2-1-merge.md) | 中文

## 问题

fork 把上游 `deepseek-ai/deepseek-harness` 从 `dsh-v0.2.0-rc.1` 合并至 `dsh-v0.2.1-rc.2`。上游的五项变化影响到 Task 替换提供方、Task preset、Task 应用或 Task CI 范围。委派改为受管理的子 agent activation：`subagent` 与 `subagent_fork` 立即返回 child id，运行时把每个子 agent 的收尾消息作为子 agent 结算通知交给父 agent，并唤醒父 agent 的下一轮次；`backgroundMode` 与 `enableRunInBackground` 已不存在，本地 subagent 需要 `working-directory` 服务。JSONL 持久化包改为导出函数插件，后端类保持私有，因此为 Session 写入授权的 Task 子类无法再编译。运行时不变式插件与所有 `./invariant` 导出被移除。共享 webserver 拒绝 `0.0.0.0` 等通配监听地址，而 Task 的内网访问使用的正是它。Agent Loop 在请求准入时刷新提供方上下文，保留资源直到所有 Agent 完成拆除，并以 Session 工作目录取代 `{{cwd}}` 提示词变量。

## 决策

Task 模型操作等待父 Agent 进入结算状态，而不再只等待一个轮次。关联轮次结束后，Task Local 重复上游 SDK 的等待：先等待父 Agent 空闲，再通过 `subagents.waitForChildren` 等待仍在推进的子 agent，只有在没有可等待的子 agent、且自该次空闲观察以来 Session 没有新事件时才返回。子 agent 继承该操作的授权，因此子 agent 结算通知会在同一操作内唤醒父 agent 的轮次。操作的回答取下一条 Task 输入之前最后一个结束轮次的最终助手文本。已结算的子 agent 只能在创建它的模型操作内、且在 Run 的在途子 Agent 上限之内继续（`agents.resume`，`send_message` 继续已结算子 agent 时使用它）。取消时，Task Local 在取消授权下用 `subagents.drainDescendants` 停止并释放父 Agent 的后代，清理会先等待释放完成，再要求所有子 Agent 都已结算。

Task preset 继续沿用 Web 声明。经审核的 Task 差异是两个委派行上的 `maxDepth: 1` 与被禁用的 workflow 行；preset 一致性测试不允许其他差异。Base 的 working-directory、`working_directory` 工具、remote-access 以及 DeepSeek Search 与 Fetch 行与 Web 一样保持挂载在 Task Profile 中。

共享的 `dsh-host-webserver` 现在拒绝通配监听地址，因此 `--host` 接受 `127.0.0.1` 或本机网卡的一个具体 IPv4 或 IPv6 地址，`0.0.0.0` 在解析参数时以上游的理由退出。与 Web 的信任检查一样，网关把监听地址作为浏览器来源接受，无需 `--trusted-host` 条目；启动时输出该地址，`--launch-link --host <地址>` 为它签发链接（[内网登录](../feature/2026-10-09-task-web-intranet-password-login.zh.md)）。

`dsh-task-session-persistence-jsonl` 在隔离的 `sessionPersistence` 键下挂载共享 JSONL 插件，并在普通键下提供一个委托式 `SessionPersistence`，其生命周期与后端完全一致。`create` 与写入模式的 `open` 先检查 Task Session 授权再委托。卸载该行时先移除带授权的提供方再移除后端，因此消费者卸载时后端仍持有它们的句柄。

`dsh-task-agent-loop` 以 `dsh-v0.2.0-rc.1` 为基点做三方合并，接入上游 Agent Loop。Task 改动，即授权检查、`wake()`、有类型的 inbox wire 状态与模块标识，仍是它与上游的唯一差异，源码副本测试固定刷新后的摘要对。Task 的 `./invariant` 配套插件以及 README 中关于不变式插件的说明随上游注册表一起移除。Task CI 范围删除已移除的构建包不变式门禁，在构建图中把 Task Web 构建排在 Web 构建之后串行执行，并把 `ci-unit` 列入不使用的模式。

## 考虑过的替代方案

**用 Task 自有的委派工具保留前台工具结果。** 不采用，因为它会在源码一致性检查之外复制 `dsh-tool-subagent`，并使 Task preset 与 Web 不一致，而上游运行时已经提供了 Task 操作所需的等待接口。

**在关联轮次后确认操作，让通知稍后到达。** 不采用，因为被通知唤醒的轮次会在操作释放授权之后运行，子 agent 及其结果交付就会超出拥有它们的业务阶段。

**在 Task Profile 中禁用 working-directory 行。** 不采用，因为本地 subagent 需要该服务；只禁用工具又会让 Task Agent 与 Web Agent 在没有 Task 特定理由的情况下不一致。

**为内网访问继续监听 `0.0.0.0`。** 不采用，因为这需要修改共享 webserver 的加载检查，即受保护的上游模块，而且与其理由相悖：监听所有网卡会把代码执行能力暴露给宿主接入的每个网络。

**通过源码导入继续继承 JSONL 后端。** 不采用，因为该类按设计是私有的；`sessionPersistence` 服务才是受支持的扩展点。

## 影响

- Task Run 遵循受管理的委派约定：委派返回 child id，回答以子 agent 结算通知到达，模型可见的工具说明与工作目录上下文随之变化。
- 一个模型操作可以包含多个父轮次；`stage.model()` 返回最后一个轮次的回答。
- 本构建会追加 `working-directory/change` 事件，早期 Task 构建会拒绝读取这类事件。把部署退回早期构建时，只有本构建尚未写入的 Session 可以继续使用。
- 取消会关闭被取消父 Agent 的委派准入，直到清理释放该 Agent。
- 内网部署把 `--host 0.0.0.0` 换成宿主的内网地址；已有的 `--trusted-host` 值继续有效，监听地址本身不再需要列出。
- JSONL 包装保持共享后端的存储、列举与拆除行为；它唯一的 Task 逻辑是授权检查。
