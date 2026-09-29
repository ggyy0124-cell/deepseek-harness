---
description: "带不可变版本挂载的 Task Profile Agent Preset 提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-task-agent-presets

[English](README.md) | 中文

## 概述

在 Task Profile 中提供普通 Agent Preset 服务，并为持久执行保留不可变 preset 版本。配置变化或进程重启后，Task 执行仍可使用同一插件组合恢复，同时现有客户端继续使用共享的 `agentPresets/*` Remote 协议。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Task Profile 将此基于目录的 preset 名册挂载在共享的 `agentPresets` 服务键下，subagent 派发通过该键按父 Agent 的 preset 组合子 Agent。Task 代码通过 `taskAgentPresets(ctx)` 访问 Task API。`mountRevision()` 按受管路径与内容版本挂载保留的组合。未指定 preset 的会话使用 `default`；`modeSelectionEnabled` 为 true 时，可变字段 `selectedDefault` 无需重启即可覆盖它。删除当前选中的 preset 时，若 profile 组合了配置编辑器，会通过它从本条目移除 `selectedDefault`。

随附的 `standard`、`ptc` 和 `cordis` Task preset 只提供前台一次性进程内 `subagent` 与 `subagent_fork` 调用。其结果归入所属模型轮次；Worker 线程版 `workflow` 与 `ralph` 的子 Agent 创建无法继承 Task 模型准入，因此已禁用。`minimal` 不含派发工具。

-----

<a id="understand-the-implementation"></a>
## 理解实现

此包持有共享 `dsh-agent-presets` 包已移除的基于目录的 preset 提供方，并增加缓存身份包含不可变版本的指定版本常驻挂载。挂载会等待每个启用行，并拒绝失败的行、等待缺失服务的行，以及向根 realm 发布服务的行。它不发布 Typert 贡献；Task Profile 加载 `dsh-agent-preset-registry` 的协议，其 `list`、`read` 与 `select` 端点解析到此服务。


不发布运行时不变量 companion；挂载审计会在记录常驻挂载前拒绝所有不可用的行。
-----

<a id="further-exploration"></a>
## 延伸阅读

[Task Local](../task-local/README.zh.md)保留版本文件。[提供方隔离决策](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.zh.md)解释协议复用与源码一致性；[上游合并记录](../../../.agents/notes/implemented/architecture/2026-09-29-task-profile-upstream-0-1-7-merge.zh.md)说明此名册为何改由 Task 持有。

-----

<a id="model-experience"></a>
## 模型体验

保留的 preset 插件为每个 Task Agent 提供系统指令与工具，因此此包间接影响模型体验。

#### KV Cache 影响

一次执行挂载一个不可变组合，使系统提示与工具前缀在恢复前后保持稳定。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 恢复要求保留的 preset 版本及其组合引用的每个包仍然可用。上游 0.1.7 合并前捕获的版本引用已不存在的 `@deepseek-ai/dsh-workflow-worker-thread`，无法重新挂载。
- Remote `copy` 与 `deletePreset` 方法无法经网关调用，因为所加载的 registry 协议未声明它们。
- 覆盖率门禁排除了此包源码；其单元测试尚未达到逐文件覆盖率阈值。

<a id="dev-note"></a>
### 开发备注

None.
