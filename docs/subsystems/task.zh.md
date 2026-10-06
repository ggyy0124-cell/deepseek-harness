# 持久业务任务

[English](task.md) | 中文

任务执行由业务插件定义，由持久提供方承载。[任务包组](../../packages/task/README.zh.md)介绍接口、提供方与派发消费者；配置由各包 README 说明。[提供方隔离决策](../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.zh.md)解释 Session 归属及 profile 组合。

## 定义与执行

[`TaskDefinition`](../../packages/task/task/src/index.ts)贡献轮询、定时或手动三者之一的特殊触发类型。它负责输入和检查点解析、阶段处理、优先级、资源请求、错误分类及清理。可选的普通任务处理器提供业务身份与发现数据比较逻辑。注册归属于贡献它的 Cordis fiber。

[`TaskRun`](../../packages/task/task/src/types.ts)记录一次执行及一个主 Session。前台子 Agent 可以拥有归属同一执行的辅助 Session；它们不是普通任务执行，也不是 Task 派发的后继。配置、代码版本、来源与创建身份保持不变。检查点、输入修订号、等待、重试资格、结果与清理状态通过已提交决策变化。已完成任务不能重新打开 Session 进行执行。

## 阶段与外部操作

[`TaskStage`](../../packages/task/task/src/index.ts)提供已获准入的快照、有序输入、保留的子 Session 身份、取消信号、模型调用、派发与持久外部操作。处理器结束时，其能力失效。`advance`、`wait`、`retry` 与 `block` 保留此次执行；`succeed` 与 `fail` 在提交结束状态前必须完成清理。清理开始时，Run 将该决定记录为 `outcome`，因此清理受阻及其重试都会保留业务结果。

操作身份局限于一次执行。已确认结果直接复用；准备状态的操作调用插件核对逻辑，不盲目重复外部写入。业务更新与确认都是持久输入。确认引用特定等待及输入修订号；过期回复被拒绝。

## 持久化与模型输入

任务数据库负责任务调度、执行状态、执行到 Session 的关联、资源锁及操作回执。Session JSONL 只负责会话事件。Task Profile 通过 Loader 补丁替换 Session、Agent、Agent Loop、JSONL 持久化与 Agent Preset 提供方；其他 profile 仍使用共享提供方。Task 专用修改检查查询数据库关联及进程内执行授权，不向已发布 Session 格式加入 Task 事件。

只有明确的阶段模型调用会把业务指令加入模型上下文。每次调用先持久化带唯一标识的收件箱消息，再唤醒 Agent，并要求存在匹配的已完成轮次。无论是特殊 Run 还是普通 Run，父 Agent 都根据自身推理决定是否调用随附编码 preset 的有界前台 `subagent` 或 `subagent_fork` 工具；子 Agent 不是必需的。Worker 线程版 workflow 与 Ralph 工具已禁用。需要子 Agent 时，任务数据库在创建前预留其 Session 身份并记录退出；父轮次等待子 Agent，取消任务也会在 Task 清理前等待它们退出。子 Agent 执行被中断后，未确认的父模型操作不会自动重放；插件可通过 `stage.children` 获取子 Session 身份进行业务核对。结果不确定的外部操作及未完成模型轮次仍需由插件恢复。终态 Session 保持可读，受支持的 Task Profile 修改与执行路径会拒绝任务准入之外的访问。

## 管理命令

`TaskPrincipalId` 标识经过认证的所有者，`TaskCommand` 选择配置、启停、触发、输入、回复、取消或重试清理操作，`TaskCommandResult` 保存最初的受理快照。重试清理只适用于清理受阻的 Run，并以其记录的终态完成。Task 提供者同时提交状态变更和回执。相同认证主体及请求键重放该快照，内容变化时返回冲突。取消受理先于异步清理完成。[Task 网关](../../packages/task/task-api-gateway/README.zh.md) 将这些操作投影为经过认证的 HTTP 资源，不暴露内部 Run 记录。

`TaskDeviceId` 是本地 Gateway 签发方法返回的带品牌类型的撤销标识，不包含设备密钥。

`TaskJournalCursor` 组合持久化数据库标识和已提交序号。有界日志读取支持 Task SSE 重放，原有诊断读取仍保留完整历史行为。新连接在客户端读取 REST 快照前发布游标，恢复连接从最后交付的游标后继续重放。事件载荷不包含日志详情和 Session 内容。

Task REST 会话读取器仅以只读模式打开 Run 所属 Session。公开消息包含循环轮次和步骤、用户消息的来源、助手消息的模型名称、token 用量及请求和首 token 时间、工具调用的开始时间，每页还列出其中记录的请求头（模型选项和工具 Schema）；排除提供者重放数据和存储元数据，分页跨过内部记录但不暴露其内容。[网关参考](../../packages/task/task-api-gateway/README.zh.md) 定义游标、可见性和不支持内容的行为。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtaskgateway--taskapigateway"></a>

### `ctx.taskGateway` — `TaskApiGateway`

HTTP Consumer of Task and Credentials; business plugins contribute no routes.

```ts cordis-catalog
/** Create a browser launch secret for an authorized local application entry.
 * @returns single-use secret and its expiry; the gateway never logs the secret.
 */
createLaunchToken(): Promise<{ token: string; expiresAt: number }>

/** Provision a device through an authorized local caller.
 * @returns device revocation identity and its secret once.
 */
createDeviceToken(): Promise<{ id: TaskDeviceId; token: string }>

/** Revoke a previously provisioned native client.
 * @param id - device revocation identity.
 * @returns durable revocation completion.
 */
revokeDeviceToken(id: TaskDeviceId): Promise<void>
```

Source: [`packages/task/task-api-gateway/src/index.ts`](../../packages/task/task-api-gateway/src/index.ts)

<a id="ctxtasks--taskservice-abstract-seam"></a>

### `ctx.tasks` — `TaskService` (abstract seam)

Provider-neutral task service. Only registered special runs may dispatch ordinary work.

```ts cordis-catalog
/** Register one business definition on its contributing plugin's lifecycle.
 *
 * @param owner - exact context of the contributing business plugin.
 *
 * @param definition - plugin-owned executable definition.
 *
 * @returns idempotent asynchronous removal.
 */
abstract register(owner: Context, definition: TaskDefinition): () => Promise<void>

/** Attach a notification destination with its own durable replay cursor.
 * @param owner - contributing plugin lifecycle.
 * @param id - stable provider identity; log is reserved for the built-in destination.
 * @param provider - idempotent delivery adapter.
 * @returns asynchronous unregistration after active delivery settles.
 */
abstract registerNotificationProvider(owner: Context, id: string, provider: TaskNotificationProvider): () => Promise<void>

/** Read value-free scheduler, cleanup and storage diagnostics.
 * @returns current operating state; storage is null when unavailable.
 */
abstract diagnostics(): Promise<TaskDiagnostics>

/** Inspect the last plugin retirement, including its completion evidence.
 * @param id - stable business definition.
 * @returns its last retirement if one has been requested.
 */
abstract getRetirement(id: TaskDefinitionId): TaskRetirement | undefined

/** Read installed and historical definitions.
 * @returns detached snapshots.
 */
abstract listDefinitions(): readonly TaskDefinitionView[]

/** Read outstanding tool approvals and model questions for one execution.
 * @param id - execution identity.
 * @returns detached waiting requests.
 */
abstract interactions(id: TaskRunId): readonly TaskInteraction[]

/** Read the people-authored inputs of one execution.
 * @param id - execution identity.
 * @returns supplemental information and business-wait replies in arrival order, with consumed inputs included.
 */
abstract inputs(id: TaskRunId): readonly TaskInputRecord[]

/** Read outstanding tool approvals and model questions across executions.
 * @returns detached waiting requests ordered by creation time; business waits remain on their runs.
 */
abstract waitingInteractions(): readonly TaskInteraction[]

/** Check proposed configuration without saving it.
 * @param id - installed definition.
 * @param config - proposed configuration.
 * @param signal - caller lifetime.
 * @returns diagnostic messages from the plugin.
 */
abstract checkConfig(id: TaskDefinitionId, config: TaskConfig, signal: AbortSignal): Promise<readonly string[]>

/** Obtain dynamic form options.
 * @param id - installed definition.
 * @param field - requested schema field.
 * @param config - proposed configuration.
 * @param signal - caller lifetime.
 * @returns plugin-owned options.
 */
abstract options( id: TaskDefinitionId, field: string, config: TaskConfig, signal: AbortSignal, ): Promise<readonly { value: JsonValue; label: string }[]>

/** Read a bounded execution history page without scanning payloads.
 * @param query - exact filters and optional stable cursor identities.
 * @returns one insertion-order page and continuation availability.
 */
abstract queryRuns(query: TaskRunQuery): TaskRunPage

/** Read execution history.
 * @returns detached execution snapshots.
 */
abstract listRuns(): readonly TaskRun[]

/** Read one execution.
 * @param id - execution identity.
 * @returns its snapshot or undefined.
 */
abstract getRun(id: TaskRunId): TaskRun | undefined

/** Resolve Session ownership, including cold terminal Sessions.
 *
 * @param id - Session identity.
 *
 * @returns owning execution if managed by tasks.
 */
abstract forSession(id: SessionId): TaskRun | undefined

/** Dispatch on behalf of an admitted special-task Agent.
 *
 * @param sessionId - tool execution's exact owning Session.
 *
 * @param requestId - retry identity within the special run.
 *
 * @param input - business data.
 *
 * @returns durable dispatch receipt.
 */
abstract dispatch(sessionId: SessionId, requestId: TaskRequestId, input: JsonValue): Promise<TaskDispatchReceipt>

/** Replace future configuration with optimistic concurrency.
 *
 * @param id - definition identity.
 *
 * @param revision - observed configuration revision.
 *
 * @param config - complete non-secret configuration.
 */
abstract updateConfig(id: TaskDefinitionId, revision: number, config: TaskConfig): void

/** Pause or enable future triggers.
 * @param id - definition.
 * @param enabled - desired scheduling state.
 */
abstract setEnabled(id: TaskDefinitionId, enabled: boolean): void

/** Idempotently start a manual special execution.
 *
 * @param id - installed manual definition.
 *
 * @param requestId - caller retry identity.
 *
 * @param input - business input.
 *
 * @returns the reserved execution.
 */
abstract triggerManual(id: TaskDefinitionId, requestId: TaskRequestId, input: JsonValue): TaskRun

/** Submit a version-bound business confirmation.
 *
 * @param id - execution.
 *
 * @param waitId - current interaction.
 *
 * @param revision - interaction revision.
 *
 * @param requestId - caller retry identity.
 *
 * @param response - plugin-owned response.
 */
abstract respond(id: TaskRunId, waitId: TaskWaitId, revision: number, requestId: TaskRequestId, response: JsonValue): void

/** Supply input and wake a blocked or waiting task.
 *
 * @param id - execution.
 *
 * @param requestId - caller retry identity.
 *
 * @param input - user data.
 */
abstract sendInput(id: TaskRunId, requestId: TaskRequestId, input: JsonValue): void

/** Stop and drain work before resource cleanup.
 *
 * @param id - execution.
 *
 * @returns completion after cleanup, or a rejection with persisted cleanup blockage.
 */
abstract cancel(id: TaskRunId): Promise<void>

/** Admit a mutation and persist its original result in the same transaction.
 * @param principal - authenticated caller, stable across credential rotation.
 * @param requestId - retry identity shared across this caller's commands.
 * @param command - validated administrative mutation.
 * @returns original admission result on replay; changed input rejects key reuse.
 */
abstract command(principal: TaskPrincipalId, requestId: TaskRequestId, command: TaskCommand): TaskCommandResult

/** Read durable lifecycle diagnostics.
 *
 * @param after - exclusive journal sequence.
 *
 * @returns ordered entries.
 */
abstract journal(after: number): readonly TaskJournalEntry[]

/** Read the latest committed position before acquiring a REST baseline.
 * @returns database identity and inclusive journal head.
 */
abstract journalHead(): TaskJournalCursor

/** Read a bounded journal page for durable event replay.
 * @param after - exclusive sequence within this database.
 * @param limit - maximum number of records.
 * @returns ascending committed records.
 */
abstract journalPage(after: number, limit: number): readonly TaskJournalEntry[]

/** Stop admission and drain for host restart without terminating tasks.
 * @returns durability barrier completion.
 */
abstract shutdown(): Promise<void>
```

Types: [SessionId](core.zh.md)

Source: [`packages/task/task/src/index.ts`](../../packages/task/task/src/index.ts)

<a id="ctxtaskstartup--taskstartup"></a>

### `ctx.taskStartup` — `TaskStartup`

Values consumed by Task application rows.

Source: [`packages/bundle/task-app/src/startup.ts`](../../packages/bundle/task-app/src/startup.ts)
<!-- END GENERATED cordis-surface -->
