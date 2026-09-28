---
description: "带 Task 所属创建授权的 Task Profile Agent 注册表。"
kind: "package-reference"
---

# @deepseek-ai/dsh-task-agent

[English](README.md) | 中文

## 概述

在 Task Profile 中提供普通 Agent 注册表，并根据 Task 所属关系授权 Agent 创建、恢复和作用域进入。替代实现保留共享 Agent handle 与 factory 接口，使 Task Agent Loop 和现有消费方使用同一套运行时类型。

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

Task Profile 使用此提供方替换 `dsh-agent`。Task Local 通过 `guardCreation()` 安装创建检查。每个检查在共享注册表创建、恢复或进入 Agent 前授权拟议的 Session 与 Agent 关系。前台子 Agent 只能在所属 Task 模型操作内创建；普通任务仍是独立的运行时根节点。`taskAgentRegistry(ctx)` 用于断言 Profile 已挂载此替代实现。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`TaskAgentRegistry` 继承共享 `AgentRegistry`，并原样委托获准操作。检查注册属于 effect，移除 Task Local 时会同时移除策略，不留下进程级全局状态。


不发布运行时不变量 companion；检查注册与卸载通过同一服务更新一个私有集合。
-----

<a id="further-exploration"></a>
## 延伸阅读

[Task 子系统](../../../docs/subsystems/task.zh.md)说明执行准入。[提供方隔离决策](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.zh.md)记录替代架构。

-----

<a id="model-experience"></a>
## 模型体验

此注册表授权 Agent 创建或恢复后，由 Task Agent Loop 驱动 Agent，因此仅间接影响模型体验。

#### KV Cache 影响

注册表不改变模型消息或请求构建。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 注册表授权受支持的创建与进入操作；业务插件仍是可信的同进程代码。

<a id="dev-note"></a>
### 开发备注

None.
