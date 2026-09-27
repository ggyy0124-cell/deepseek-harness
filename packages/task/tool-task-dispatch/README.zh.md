---
description: "dsh-tool-task-dispatch：持久任务配置、执行与恢复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-task-dispatch

[English](README.md) | 中文

## 概述

允许特殊任务中的模型派发独立执行的业务事项。重复发现的数据根据业务插件规则关联未完成任务。普通任务不能通过此工具创建后代任务。派发回执持久保存后，特殊任务即可完成。

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

将此消费者与任务提供方一起挂载；`task` Profile 已包含它。工具仅注册到特殊任务 Agent。`request_id` 标识重试中的派发，`input_json` 携带由业务插件校验的业务 JSON。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

[工具实现](src/index.ts)验证调用 Agent 的精确身份，再交由 `ctx.tasks.dispatch` 检查准入。注册同时受 Agent 生命周期与消费者插件生命周期约束。本包不发布不变量插件：提供方负责执行准入，Task 不变量插件负责 Session 关系。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

[Task 包组](../../../packages/task/README.zh.md)介绍职责划分；[架构文档](../../../docs/architecture.zh.md)介绍 Profile 组合。

-----

<a id="model-experience"></a>
## 模型体验

### 派发工具

#### 模型看到什么

[工具结构与说明](src/index.ts)提供 `task_dispatch(request_id, input_json)`。结果报告 `created` 或 `associated`、任务和 Session 身份，以及本次发现是否改变已有任务。通用调用卡片使用已持久化参数。

#### Token 影响

特殊任务请求包含派发工具结构、调用参数与回执。普通任务请求不包含此工具结构。

#### KV Cache 影响

工具结构在特殊任务 Session 内保持稳定；每次调用向会话追加参数与结果。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 业务 JSON 与关联策略由插件定义；工具不能派发到另一个插件，也不能为子任务选择不同 preset。

<a id="dev-note"></a>
### 开发备注

None.
