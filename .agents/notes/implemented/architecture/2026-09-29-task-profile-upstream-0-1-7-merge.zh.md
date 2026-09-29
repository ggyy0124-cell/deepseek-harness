# Agent Note: Task Profile 适配上游 0.1.7 合并

Status: implemented

[English](2026-09-29-task-profile-upstream-0-1-7-merge.md) | 中文

## 问题

fork 合并了上游 `deepseek-ai/deepseek-harness` 直至 `dsh-v0.1.7-rc.2`，随后合并至 `dsh-v0.2.0-rc.1`；后者的新增变化只要求提升 Task 包版本。上游删除了 `@deepseek-ai/dsh-agent-presets`，即 Task preset 提供方副本的规范来源，并以声明式的 `dsh-agent-preset-registry` 取代。上游还把 `agent/created` 改为串行等待的事件并删除 `agent/session-start`，用可变 Config 字段取代 settings 分区，把代码运行时重命名为 `ptcRuntime`，并将 Session 写入格式推进到 V4。每项变化都影响到某个 Task 替换提供方、Task preset 或 Task 应用 patch。

## 决策

`dsh-task-agent-loop` 以 fork 基点做三方合并，接入上游 Agent Loop。带有 Task 改动的四个文件保留这些改动；其余文件在模块标识归一化后与上游一致。源码副本测试固定刷新后的摘要对，因此 Agent Loop 一致性仍受检查。

Task preset 沿用上游在移除 `@deepseek-ai/dsh-agent-presets` 时采用的声明式模型。Task 组合包以从 Web 声明复制的 `dsh-agent-preset` 行声明 `standard`、`ptc`、`minimal` 与 `cordis`；subagent 调用保持前台一次性、深度为 1，workflow 行保持禁用。一致性测试只允许这些差异。`dsh-task-agent-preset-registry` 在相同的 `agentPresets` 键下继承 `dsh-agent-preset-registry`，`dsh-subagent` 通过该键按父 Agent 的 preset 组合子 Agent。Task 代码通过 `taskAgentPresetRegistry(ctx)` 访问 Task API。

共享注册表只在内存中保留版本，重启后的 Session 会按当前声明解析 preset。Task 执行必须保持启动时的组合，因此 Task 注册表记录声明的子插件列表、声明行的解析基址与摘要；Task Local 把该记录存入操作回执，而不再复制 preset 目录。与当前声明一致的已记录版本绑定该声明的运行中插件树。其他版本通过共享注册表公开的 `register` 与 `mount` 操作，以保留的 `task-revision:` id 注册私有定义；记录了该版本的 Agent 共享它，最后一个 Agent 离开时撤回该定义，而共享注册表会为继承它的子 Agent 保留已退役的插件树。名册读取会省略私有定义，组合 preset 的读取报告声明的 id。

默认 preset 沿用共享注册表在 `agent-preset-registry` 条目上的 `default` 与可变字段 `selectedDefault`。Task Agent Loop 随上游合并将 `maxParallelToolCalls` 作为可变字段。

Task 应用 patch 删除自身的 `code-runtime` 行，因为 Base 现在挂载 `ptc-runtime`。它与其他按 Agent 提供的行一起禁用 `workflow-ptc` 与 `mcp-resources`，并为共享的 `agentPresets` 命名空间加载 `dsh-agent-preset-registry` 的 Typert 贡献。

Task 阶段提示使用 Session V4 要求的生产方自有消息来源 kind `task`。转录投影读取 V4 的 tool 角色结果消息。

## 考虑过的替代方案

**保留 Task 自有的目录式 preset 名册。** 不采用，因为它会在源码一致性检查之外保留已移除包的副本、第二种 preset 声明格式，以及与共享协议不一致的 Remote 接口。

**像 Web 一样按当前声明解析重启后的执行。** 不采用，因为两次等待之间的 profile 修改会改变正在运行的业务执行所用的工具与提示。

**为共享注册表增加版本钩子。** 不采用，因为 Task Profile 保持共享提供方源码不变，而公开的 `register` 与 `mount` 操作足以表达私有版本。

**重命名 Task preset 服务。** 不采用，因为进程内 subagent 将无法继承父 Agent 的 preset。派发通过 `ctx.get('agentPresets')` 解析共享键。

**把 Task 包现有的 `as unknown` 断言记入 unknown-cast 基线。** 延后。这些断言早于该门禁，且该门禁不在 Task CI 范围内；每一处都需要有类型的替代写法。

## 影响

- 已记录的版本只列出包与解析基址，不含代码；恢复要求这些包仍安装在该基址可解析的位置。早期 Task 构建记录的目录式版本会作为无效回执被拒绝。
- 与 Web preset 一样，每个已声明的 Task preset 都在启动时激活。声明变化后，每个仍在使用的不同已记录版本会增加一棵私有插件树。
- Task preset 声明需要跟随兼容的 Web 声明变更；preset 一致性测试会使意外漂移在本地失败。
- 已保存的 `agent-presets` 与 `agent-loop` settings 分区不再被读取；运维人员需在 Task profile patch 中以可变字段重新声明这些值。
