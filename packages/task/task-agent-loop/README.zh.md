---
description: "带 Task 所属命令授权和持久输入唤醒的 Task Profile Agent Loop。"
kind: "package-reference"
---

# @deepseek-ai/dsh-task-agent-loop

[English](README.md) | 中文

## 概述

以普通 Agent Loop 行为驱动 Task Agent，并在命令、取消和维护操作周围强制 Task 授权。专用唤醒操作只在 Task SQLite 和 Session 收件箱持久化输入后启动工作。

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

Task Profile 使用此驱动替换 `dsh-agent-loop`。它的公开配置与共享驱动一致。Task Local 提交具有唯一身份的收件箱消息及对应模型操作意图后，调用 `wakeTaskAgent(agent)`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

此包复制共享 Agent Loop 实现，并在驱动模型的命令之前增加 Task Session 授权。显式唤醒路径调度一次执行，但不再次插入消息。源码一致性测试只允许 Task 授权与唤醒扩展。


不发布运行时不变量 companion；共享 Agent Loop companion 负责复制的生命周期关系，源码一致性检查会拒绝 Task 副本漂移。
-----

<a id="further-exploration"></a>
## 延伸阅读

[Task Local](../task-local/README.zh.md)负责持久投递。[提供方隔离决策](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.zh.md)解释源码副本维护方式。

-----

<a id="model-experience"></a>
## 模型体验

### Task Agent 轮次

#### 模型看到什么

模型收到的已记录系统提示、用户消息、工具结果和历史助手消息与共享 Agent Loop 一致。唤醒操作启动轮次时，Task 输入已经存在于持久收件箱。

#### Token 影响

授权与唤醒不增加内容。每个获准的 Task 提示和回答与普通 Agent 轮次产生相同 token。

#### KV Cache 影响

此循环为保留的 Task Session 维持共享的请求序列与缓存前缀行为。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 复制的实现必须跟随共享 Agent Loop 的兼容变化；源码一致性测试会拒绝未预期偏差。

<a id="dev-note"></a>
### 开发备注

None.
