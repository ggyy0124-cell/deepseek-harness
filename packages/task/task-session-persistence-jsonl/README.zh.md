---
description: "带 Task 所属写入授权的 Task Profile JSONL Session 持久化。"
kind: "package-reference"
---

# @deepseek-ai/dsh-task-session-persistence-jsonl

[English](README.md) | 中文

## 概述

使用普通 JSONL 格式持久化 Task Profile Session，并在创建或打开可写记录时要求 Task 授权。替代实现保持已发布的 Session 存储格式，Task 生命周期数据保存在 SQLite 中。

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

Task Profile 使用与 `dsh-session-persistence-jsonl` 相同的配置挂载此提供方。它要求 `dsh-task-session`；打开可写 Session 记录时，先调用 Task Session 授权策略，再委托共享后端。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`TaskJsonlSessionPersistence` 继承共享 JSONL 提供方。读取保留普通行为，创建记录和可写打开路径调用 `TaskSessionStore.assertWritable()`。JSONL 只包含普通 Session 事件；Task SQLite 数据库负责执行状态与执行到 Session 的关联。


不发布运行时不变量 companion；共享 JSONL companion 负责存储检查，此包装器只在委托前执行一次授权检查。
-----

<a id="further-exploration"></a>
## 延伸阅读

[Task 子系统](../../../docs/subsystems/task.zh.md)说明两种存储。[提供方隔离决策](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.zh.md)记录其职责。

-----

<a id="model-experience"></a>
## 模型体验

此提供方只改变写入授权，不改变持久化模型内容，因此不直接影响模型体验。

#### KV Cache 影响

持久化消息历史与请求头和共享 JSONL 提供方一致。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- SQLite 与 JSONL 分别提交；Task Local 在中断后核对持久收件箱身份与操作回执。

<a id="dev-note"></a>
### 开发备注

None.
