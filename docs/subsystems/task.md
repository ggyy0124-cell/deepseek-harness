# Durable business tasks

English | [中文](task.zh.md)

Task execution is defined by a business plugin and hosted by a durable provider. The [task group](../../packages/task/README.md) maps the interface, provider, and dispatch consumer; package READMEs own configuration. The [provider-isolation decision](../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.md) explains Session ownership and profile composition.

## Definitions and executions

[`TaskDefinition`](../../packages/task/task/src/index.ts) contributes one special trigger kind: polling, scheduled, or manual. It owns input/checkpoint parsing, stage handlers, priority, resource requests, error classification, and cleanup. Optional ordinary-work handlers supply a business identity and discovery comparison. Registration belongs to the contributing Cordis fiber.

[`TaskRun`](../../packages/task/task/src/types.ts) records one execution and one primary Session. Foreground child Agents may have auxiliary Sessions owned by the same run; they are not ordinary runs or Task dispatch descendants. Configuration, code version, source, and creation identity remain fixed. Checkpoint, input revision, wait, retry eligibility, result, and cleanup state evolve through committed decisions. A finished run cannot reopen its Session.

## Stages and external effects

[`TaskStage`](../../packages/task/task/src/index.ts) exposes the admitted snapshot, ordered inputs, retained child Session identities, cancellation signal, model calls, dispatch, and durable external operations. Its capabilities expire when the handler settles. `advance`, `wait`, `retry`, and `block` retain the execution; `succeed` and `fail` require cleanup before a terminal state is committed.

An operation identity is local to a run. A confirmed result is reused; a prepared operation invokes plugin reconciliation instead of blindly repeating an external write. Business updates and confirmations are persisted inputs. Confirmations reference a specific wait and input revision; stale replies are rejected.

## Persistence and model input

The task database owns scheduling, execution state, run-to-Session association, resource locks, and operation receipts. Session JSONL owns conversation events only. Task Profile replaces the Session, Agent, Agent Loop, JSONL persistence, and Agent Preset providers through its Loader patch; other profiles keep the shared providers. Task-specific mutation checks consult the database association and process-local execution authority without adding Task events to the released Session format.

Only explicit stage model calls add business instructions to model context. Each call persists a uniquely identified inbox message before waking the Agent and requires a matching completed turn. In either a special or an ordinary Run, the parent Agent decides whether to call the supplied coding preset's bounded foreground `subagent` or `subagent_fork` tool; no child is required. Worker-thread workflow and Ralph tools are disabled. When a child is requested, the task database reserves its Session identity before creation and records disposal; the parent turn waits for children, and cancellation drains them before Task cleanup. An interrupted child blocks replay of its unconfirmed parent model operation, leaving its Session identity in `stage.children` for business reconciliation. Uncertain external outcomes and incomplete model turns remain subject to plugin recovery. Terminal Sessions remain readable while supported Task Profile mutation and execution paths reject access outside Task admission.

## Administrative commands

`TaskPrincipalId` identifies an authenticated owner, `TaskCommand` selects one configuration, enable, trigger, input, response or cancellation mutation, and `TaskCommandResult` retains its original admission snapshot. The Task provider commits the mutation and receipt together. A matching principal and request key replays that snapshot; changed content conflicts. Cancellation admission precedes asynchronous cleanup. [Task Gateway](../../packages/task/task-api-gateway/README.md) projects these operations into authenticated HTTP resources without exposing the internal Run record.

`TaskDeviceId` is the branded revocation identity issued by the local Gateway provisioning method; it never contains the device secret.

`TaskJournalCursor` combines the durable database identity and committed sequence. The bounded journal reader supports Task SSE replay, while the legacy diagnostic reader retains its complete-history behavior. A fresh stream publishes its cursor before clients acquire REST snapshots; resumed streams replay after their last delivered cursor. The event payload excludes journal details and Session content.

The Task REST transcript reader opens only the Run-owned Session in read mode. Its public messages omit provider replay and storage metadata; pagination advances across internal records without exposing them. The [gateway reference](../../packages/task/task-api-gateway/README.md) owns cursor, visibility and unsupported-content behavior.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtaskgateway--taskapigateway"></a>

### `ctx.taskGateway` — `TaskApiGateway`

HTTP Consumer of Task and Credentials; business plugins contribute no routes.

```ts cordis-catalog
/** Create a browser launch secret for an authorized local application entry.
 * @returns single-use secret; never logged by the gateway.
 */
createLaunchToken(): Promise<string>

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

Types: [SessionId](core.md)

Source: [`packages/task/task/src/index.ts`](../../packages/task/task/src/index.ts)

<a id="ctxtaskstartup--taskstartup"></a>

### `ctx.taskStartup` — `TaskStartup`

Values consumed by Task application rows.

Source: [`packages/bundle/task-app/src/startup.ts`](../../packages/bundle/task-app/src/startup.ts)
<!-- END GENERATED cordis-surface -->
