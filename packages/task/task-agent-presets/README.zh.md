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

Task Profile 使用此提供方替换 `dsh-agent-presets`。`mountRevision()` 按受管路径与内容版本挂载保留的组合。普通 preset 发现、创作、选择与 Session 投影保持共享行为。

随附的 `standard`、`ptc` 和 `cordis` Task preset 只提供前台一次性进程内 `subagent` 与 `subagent_fork` 调用。其结果归入所属模型轮次；Worker 线程版 `workflow` 与 `ralph` 的子 Agent 创建无法继承 Task 模型准入，因此已禁用。`minimal` 不含派发工具。

-----

<a id="understand-the-implementation"></a>
## 理解实现

此包复制共享 preset 提供方，并增加缓存身份包含不可变版本的指定版本常驻挂载。它不发布第二份 Typert 贡献；Task Profile 加载共享包生成的协议，并将这些端点解析到此服务。


不发布运行时不变量 companion；共享 Agent Preset companion 负责复制的挂载关系，源码一致性检查会拒绝 Task 副本漂移。
-----

<a id="further-exploration"></a>
## 延伸阅读

[Task Local](../task-local/README.zh.md)保留版本文件。[提供方隔离决策](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.zh.md)解释协议复用与源码一致性。

-----

<a id="model-experience"></a>
## 模型体验

保留的 preset 插件为每个 Task Agent 提供系统指令与工具，因此此包间接影响模型体验。

#### KV Cache 影响

一次执行挂载一个不可变组合，使系统提示与工具前缀在恢复前后保持稳定。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 恢复要求保留的 preset 版本及其组合引用的每个包仍然可用。

<a id="dev-note"></a>
### 开发备注

None.
