---
description: "带 Task 所属修改授权的 Task Profile Session 提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-task-session

[English](README.md) | 中文

## 概述

在 Task Profile 中提供普通 Session API，并要求 Session 创建、准备、进入、fork 与写入经过 Task 所属授权。此存储保持共享 Session 类型与事件行为，因此其他 Task 提供方可以复用现有 Agent 和持久化接口，而无需修改共享包。

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

Task Profile 使用此提供方替换 `dsh-session`。Task Local 通过 `guardMutations()` 安装有作用域的修改检查；每个检查识别所属 Session ID 并授权请求的操作。需要替代实现的代码使用 `taskSessionStore(ctx)`，挂载其他提供方时会直接失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`TaskSessionStore` 继承共享 `SessionStore`，保留 Session 身份和行为。创建与修改方法先检查所有活跃策略，再委托共享实现。策略属于 Cordis effect，会随所属插件作用域一起卸载。


不发布运行时不变量 companion；检查注册与卸载通过同一服务更新一个私有集合。
-----

<a id="further-exploration"></a>
## 延伸阅读

[Task 子系统](../../../docs/subsystems/task.zh.md)定义 Task 所属关系与生命周期。[提供方隔离决策](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.zh.md)解释 Task Profile 替换此提供方的原因。

-----

<a id="model-experience"></a>
## 模型体验

此提供方只授权 Session 生命周期操作，并将模型历史交给 Session 消费方，因此不直接影响模型体验。

#### KV Cache 影响

此提供方不改变消息、请求头或缓存前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 授权覆盖受支持的提供方入口；已经持有 Session 对象的可信同进程插件仍可直接调用其方法。

<a id="dev-note"></a>
### 开发备注

None.
