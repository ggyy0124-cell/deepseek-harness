# Agent Note: Task Profile 适配上游 0.1.7 合并

Status: implemented

[English](2026-09-29-task-profile-upstream-0-1-7-merge.md) | 中文

## 问题

fork 合并了上游 `deepseek-ai/deepseek-harness` 直至 `dsh-v0.1.7-rc.2`，随后合并至 `dsh-v0.2.0-rc.1`；后者的新增变化只要求提升 Task 包版本。上游删除了 `@deepseek-ai/dsh-agent-presets`，即 Task preset 提供方副本的规范来源，并以声明式的 `dsh-agent-preset-registry` 取代。上游还把 `agent/created` 改为串行等待的事件并删除 `agent/session-start`，用可变 Config 字段取代 settings 分区，把代码运行时重命名为 `ptcRuntime`，并将 Session 写入格式推进到 V4。每项变化都影响到某个 Task 替换提供方、Task preset 或 Task 应用 patch。

## 决策

`dsh-task-agent-loop` 以 fork 基点做三方合并，接入上游 Agent Loop。带有 Task 改动的四个文件保留这些改动；其余文件在模块标识归一化后与上游一致。源码副本测试固定刷新后的摘要对，因此 Agent Loop 一致性仍受检查。

`dsh-task-agent-presets` 改由 Task 持有。其原始包已不存在，因此移除其源码与随附 preset 的一致性配对。此包在本地声明 preset 词汇、Remote 错误详情、投影映射项、选择事件与 Session 事件，因为仅类型导入会从生成的声明文件中消失。它保留 `agentPresets` 服务键，因为 `dsh-subagent` 通过该键按父 Agent 的 preset 组合子 Agent。上游 registry 为该键声明了 Context 类型，因此 Task 代码通过 `taskAgentPresets(ctx)` 访问 Task API。已移除包的单元测试迁入 Task 包。

Task preset 默认值读取可变字段 `selectedDefault` 与 `modeSelectionEnabled`。删除当前选中的 preset 时，通过 `configEditor` 从提供方自身条目中移除 `selectedDefault`。Task Agent Loop 随上游合并将 `maxParallelToolCalls` 作为可变字段。

当某行的导入或激活被拒绝时，Loader 现在仍会让子树完成结算。Task preset 挂载会等待每个启用行，并拒绝失败的行、等待缺失服务的行，以及向根 realm 发布服务的行。Task 挂载仍拒绝等待中的行，因为 Task 执行没有之后的重新审计时点。

Task 应用 patch 删除自身的 `code-runtime` 行，因为 Base 现在挂载 `ptc-runtime`。它与其他按 Agent 提供的行一起禁用 `workflow-ptc` 与 `mcp-resources`，并为共享的 `agentPresets` 命名空间加载 `dsh-agent-preset-registry` 的 Typert 贡献。Task preset 将已禁用的 workflow 行重命名为 `workflow-ptc`。

Task 阶段提示使用 Session V4 要求的生产方自有消息来源 kind `task`。转录投影读取 V4 的 tool 角色结果消息。

## 考虑过的替代方案

**把 Task preset 移植到声明式 registry。** 本次合并不采用，因为 Task 执行按内容摘要捕获不可变的 preset 目录，而 registry 在 profile patch 中声明 preset。将版本捕获改为基于声明会改变 Task 的持久恢复，需要单独设计。

**重命名 Task preset 服务。** 不采用，因为进程内 subagent 将无法继承父 Agent 的 preset。派发通过 `ctx.get('agentPresets')` 解析共享键。

**把 Task 包现有的 `as unknown` 断言记入 unknown-cast 基线。** 延后。这些断言早于该门禁，且该门禁不在 Task CI 范围内；每一处都需要有类型的替代写法。

## 影响

- 合并前捕获的 preset 版本引用 `@deepseek-ai/dsh-workflow-worker-thread`，无法重新挂载。需要跨升级继续的执行必须先完成，或使用新的版本。
- Task preset 提供方的 Remote `copy` 与 `deletePreset` 方法无法经网关调用，因为所加载的 registry 协议未声明它们。
- 在迁入的测试达到逐文件阈值之前，覆盖率门禁继续排除 Task preset 源码。
- 已保存的 `agent-presets` 与 `agent-loop` settings 分区不再被读取；运维人员需在 Task profile patch 中以可变字段重新声明这些值。
