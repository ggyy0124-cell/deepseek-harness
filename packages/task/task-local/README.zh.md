---
description: "dsh-task-local：持久任务配置、执行与恢复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-task-local

[English](README.md) | 中文

## 概述

在持续运行的本机服务上执行持久任务。SQLite 保存调度、检查点、业务关联和操作回执，JSONL Session 保存会话历史。全局与插件限制控制阶段准入，资源锁保护互斥工作。服务关闭保留未完成任务；插件卸载则取消任务并等待清理。

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

内置 `task` profile 将此提供者与Task API 网关组合。直接挂载时必须配置 SQLite 的 `path` 和 Task 自有文件的 `resourceRoot`；已记录的 preset 版本保存在该数据库中。同一数据库拒绝第二个宿主同时写入。

等待阶段每经过 `priorityAgingIntervalMs`（默认 60,000 毫秒）增加 1 点优先级，上限由 `priorityAgingCap`（默认 100）指定。等待时长从 Run 最近一次持久化更新开始计算；有效优先级相同时按创建时间排序。资源受阻的阶段不占用并发名额。

通知按有界日志页投递（`notificationBatchSize` 默认 100），并持久保存确认位置。日志提供者只输出存储及序号身份、Run 身份、事件和时间。失败投递使用同一身份重试；实现 `TaskNotificationProvider` 的提供者必须对不确定的投递去重。若进程在写日志与保存确认之间崩溃，可能重复一条日志；这是至少一次投递，不保证外部副作用恰好一次。

取消超过 `cancellationGraceMs`（30 秒）后记录退出超时；停机超过 `shutdownTimeoutMs`（120 秒）后同样记录，二者仍等待工作实际停止。清理超过 `cleanupTimeoutMs`（120 秒）后中止其信号，回调结束后保留阻塞 Run 和资源锁。修复资源后，通过 `cleanup` 命令重试清理或重新取消；两者都以开始结算时记录的终态完成。插件必须响应取消并结束；系统服务管理器可以终止卡住的进程，重启后需核对未完成工作。

| 配置 | 默认值 | 作用 |
|---|---|---|
| `concurrency` | `4` | 所有插件的活跃阶段总数 |
| `childConcurrency` | `4` | 每次 Task 执行的在途前台子 Agent 数量 |
| `tickMs` | `1000` | 调度器唤醒间隔 |
| `catchupLimit` | `10000` | 每个定义每次唤醒扫描的调度次数 |
| `catchupHorizonMs` | `2592000000` | 日历追赶窗口；更早范围记录为跳过 |
| `pendingLimit` | `100` | 每个定义未完成的定时任务数量 |

轮询在上一次轮询结束后等待配置的间隔。日历调度采用五字段 cron、明确的 IANA 时区，以及 `all`、`coalesce` 或 `skip` 策略。分批扫描在多次唤醒与重启之间保留游标；队列积压时不跳过尚未创建任务的调度点。调度失败会停用对应定义、记录诊断，并在 `blockedReason` 中保留原因，直到该定义重新启用。

业务等待释放阶段配额与临时资源。只有模型及工具工作停止、插件清理成功后，才释放保留资源。清理失败会阻塞任务并保留互斥；修复资源后可重试清理。缺少业务代码时不执行任务，但历史 Session 仍可读取。

无论是特殊 Run 还是普通 Run，已获准入的父模型操作都可以选择通过保留的 Task preset 创建前台进程内子 Agent。只有父 Agent 调用子 Agent 工具时才会创建子 Agent。子 Session 归属于同一 Run，不计作普通任务派发。父模型轮次在阶段结束前等待所有子 Agent。后台或可延续子 Agent 不属于此归属规则。进程重启会将未结束子 Agent 记录为已中断，并阻止自动重放父模型操作；下一阶段通过 `stage.children` 向插件提供子 Session ID，以便业务核对。

-----

<a id="understand-the-implementation"></a>
## 理解实现

调度等待 Session 恢复、初始 Loader 树和保留代码核对完成。诊断区分 `starting`、`running`、`failed` 和 `stopping`；恢复失败时不启动调度。恢复期间停止服务会等待恢复结束，并防止延迟创建的定时器接纳新工作。

`stage.resource(key, type, request)` 在调用适配器前持久化获取意图。重启后须重新核实存续句柄；清理保留每项资源的进度，全部适配器结束后才释放锁。插件通过 `resourceHandlers` 注册适配器。内置 `task.directory` 接受 `{}`，`task.worktree` 接受 `{ repository, ref }`，删除前均验证私有所有权。工作树移除前会将文件内容及符号链接目标保存到 `resourceRoot`。移动后的工作树在仓库登记修复前保持阻塞。`resourceProcessGraceMs` 默认为 5000，`resourceOutputLimitBytes` 默认为 65536。

卸载先提交停止接纳执行的状态和持久操作，再取消任务。恢复过程使用保存的模块 URL、入口摘要和已求值配置，重新加载已从 Loader 配置移除的入口。卸载状态达到 `complete` 前，必须保持已安装的包及依赖不变；代码缺失或改变会阻塞清理。重新安装的定义保持暂停，直到显式启用。包管理器在 Loader 外修改代码时也须遵循此顺序。

`registerNotificationProvider(owner, id, provider)` 为每个通知目标维护独立的持久确认游标，并等待其释放完成。`diagnostics()` 读取全历史计数，报告排队时长、持久化屏障、资源占用、未完成卸载和磁盘压力。`diskFreeRatio` 默认为 0.1；文件系统统计不可用时明确报告缺失。

清理阻塞期间，恢复加载的插件 fiber 保持加载。重试完成卸载流程后，调度器释放这些 fiber；服务关闭等待正在进行的释放结束。释放失败会记录 `task.retirement.dispose-failed`，并保留到下一轮释放重试。

<details>
<summary>实现细节</summary>

[数据库](src/database.ts)原子提交任务变化、审计记录、子 Session 归属与 Session 持久化屏障。[Session 适配器](src/sessions.ts)在准入前刷新每个屏障，并校验数据库中的执行到 Session 关联。模型投递使用稳定消息身份与已记录的完成轮次；Agent 空闲本身不代表成功。模型取消操作进入所属 Session 的授权上下文，包括外部调用方中止信号的情况；被中断的操作保留未确认收据。

[执行引擎](src/engine.ts)记录准入、状态转换、派发关联、操作核对、调度积压与清理。日志包含身份和状态元数据；业务输入与模型回答保存在各自持久记录中。提供方不单独发布不变量插件：Task 不变量插件负责对比 Session 与任务记录，而事务唯一性及锁获取在准入之前强制执行。

普通任务在取消或清理阻塞期间，同一业务键再次出现时仍会关联来源，但不投递新输入，也不推进已观察业务数据。该任务结束后的下一次发现会创建后继任务。

`restart` 命令为最新 Run 已失败或已取消的业务键预留新的普通 Run。新 Run 报告 `restartedFrom`，沿用停止的 Run 最近观察到的输入，并使用定义当前的配置和代码版本。其他状态的 Run、业务键已有更新的 Run、定义已停用或已卸载时，命令以 `invalid_state` 失败。重来不会改变停止的 Run。

管理命令在同一个 SQLite 事务中提交状态变化、原始响应快照和审计记录。嵌套操作使用保存点；回滚的操作不会发布诊断日志或取消信号。重试匹配忽略 JSON 对象字段顺序、保留数组顺序，并按认证主体隔离重试键。启停操作递增定义版本。取消命令先标记 Run，在提交后中止执行；执行器或调度器异步等待在途操作停止并清理资源。

Forms 在注册和命令入口校验，schema 变化要求显式迁移，已有执行保留配置及 forms 快照。注册时拒绝未知的 `x-dsh-` 注解，准入时拒绝无效的凭据引用名，补充输入按 Run 快照中的 `supplement` schema 校验。`inputs(id)` 把每条已存储的补充输入和业务等待回复与其 `input.<kind>` 日志记录的到达时间配对，并排除插件派发和等待超时输入。业务等待保存自己的回复 schema 和创建时间。工具审批保留其工具调用 ID，模型提问保留结构化问题；二者单独持久化，中断后撤销，旧请求不能恢复新的工具调用。Task 应用启动器通过 `maintenance` 导出提供离线备份和恢复。

</details>


不发布运行时不变量 companion；Task 服务 companion 对比 SQLite 执行记录与 Session 持久化，提供方则在准入前执行事务与锁规则。
-----

<a id="further-exploration"></a>
## 延伸阅读

[Task 包组](../../../packages/task/README.zh.md)介绍职责划分；[架构文档](../../../docs/architecture.zh.md)介绍 Profile 组合。

-----

<a id="model-experience"></a>
## 模型体验

### 业务模型阶段

#### 模型看到什么

`stage.model` 收到的原始提示作为持久用户消息进入任务 Session。所选 preset 提供系统指令与工具。重放已完成操作时返回已记录的回答，不产生另一次模型请求。

#### Token 影响

每次新的模型操作增加提示与生成回答的 token。Task 生命周期保存在 SQLite 中，业务插件决定哪些更新进入后续提示。

#### KV Cache 影响

同一次执行在各阶段保留 Session 与 preset，可复用会话前缀。不同执行创建独立 Session。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 本地 SQLite 数据库由一个可写服务进程独占；此提供方不协调分布式工作进程。
- 插件必须停止子进程并核对结果不确定的外部写入。插件若始终无法完成取消，会延迟服务关闭或卸载。
- 已记录的 preset 版本只列出插件包，不复制其代码；恢复仍需要对应外部服务及已安装的插件代码。

<a id="dev-note"></a>
### 开发备注

None.
