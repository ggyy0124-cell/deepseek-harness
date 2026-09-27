---
description: "dsh-task：持久任务配置、执行与恢复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-task

[English](README.md) | 中文

## 概述

构建轮询、日历调度和手动业务任务，并在等待与重启期间保留执行身份。特殊任务可以派发继承同一 preset 的独立普通任务。业务插件决定阶段、确认要求和完成条件；提供方负责持久化准入与 Session 生命周期。

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

当业务执行必须在派发它的特殊任务结束后继续运行时，使用此接口。挂载 [`dsh-task-local`](../task-local/README.zh.md) 提供 `ctx.tasks`；抽象服务本身不能充当可执行提供方。每个业务插件通过自己的 Cordis 上下文注册一个定义。

只有获得准入的特殊阶段能够派发普通任务。插件提供业务键并比较发现的数据；数据未变时不打扰已有任务。确认回复同时携带等待身份与输入修订号，因此过期确认不能授权处理变化后的内容。

无论是特殊任务还是普通任务，父 Agent 都自行决定是否使用保留 preset 的前台进程内子 Agent 工具。模型轮次不调用该工具就不会创建子 Agent。已创建的子 Agent 仍属于同一次 Task 执行，不会成为普通任务。模型轮次被中断后，`stage.children` 给出保留的子 Session 身份，以便插件在选择新的模型操作前核对结果不确定的工作。

-----

<a id="understand-the-implementation"></a>
## 理解实现

清理超过配置期限后，其 AbortSignal 会中止。插件必须停止所拥有的工作并结束回调；超时清理的资源锁会保留，直到后续取消成功完成清理。

<details>
<summary>实现细节</summary>

[阶段 API](src/index.ts)区分模型调用、持久外部操作、派发和业务决策。[持久类型](src/types.ts)包含配置快照、检查点、来源关系、等待与清理状态。[不变量插件](src/invariant.ts)对比任务记录与独立持久化的 Session 事件。

管理客户端通过 `command` 提交稳定的认证主体和重试键。相同请求返回最初的受理快照，即使任务已经完成或服务已经重启；同一键对应的请求发生变化时会冲突。配置和启停命令检查任务定义版本。取消命令在清理完成前返回受理结果；插件卸载仍通过 `cancel` 等待清理完成。

定义可声明带版本的 `forms`、确定性 `migrateConfig`，以及响应取消的 `checkConfig`/`options`。Schema 使用自包含 Draft 2020-12，不提供前端代码。提供方将 forms 保存在执行快照中；模型提问和工具审批使用持久化、版本绑定的交互记录。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

[Task 包组](../../../packages/task/README.zh.md)介绍职责划分；[架构文档](../../../docs/architecture.zh.md)介绍 Profile 组合；[业务插件操作指南](../../../docs/cookbook/adding-a-task-plugin.zh.md)展示可运行的注册示例。

-----

<a id="model-experience"></a>
## 模型体验

通过业务插件和任务 Session 适配器间接影响模型；它们负责模型指令与工具使用。

#### KV Cache 影响

本包不直接修改请求前缀；所选 preset 与业务提示决定缓存复用。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 此接口不实现业务流程或调度提供方。外部操作结果不确定时，重试前必须由业务插件核对外部证据。

<a id="dev-note"></a>
### 开发备注

None.
