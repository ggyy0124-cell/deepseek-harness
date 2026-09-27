/** Service Definition for durable, plugin-owned task execution. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TaskRetirement, TaskRunQuery, TaskRunPage, TaskNotificationProvider, TaskResourceHandler, TaskDiagnostics, TaskForms, TaskInteraction, TaskCommand, TaskCommandResult, TaskPrincipalId, TaskConfig, TaskDefinitionId, TaskDefinitionView, TaskDispatchReceipt, TaskInput, TaskJournalCursor, TaskJournalEntry, TaskRequestId, TaskRun, TaskRunId, TaskStageResult, TaskWaitId } from './types.ts'
export type * from './types.ts'
export { TaskCommandError, type TaskCommandErrorCode } from './errors.ts'

/** Capabilities scoped to one admitted stage; retained capabilities reject after settlement. */
export interface TaskStage {
  readonly run: TaskRun
  readonly inputs: readonly TaskInput[]
  readonly signal: AbortSignal
  /** Child Session identities retained for inspection after an interrupted model turn. */
  readonly children: readonly { readonly sessionId: SessionId; readonly modelKey: string; readonly state: 'prepared' | 'active' | 'interrupted' | 'complete' }[]
  /** Acquire a durable owned resource; repeated keys must name the same request.
   * @param key - stable resource identity within this execution.
   * @param type - built-in or plugin resource adapter.
   * @param request - non-secret acquisition data, retained for cleanup and reconciliation.
   * @returns confirmed JSON handle, such as an owned directory path.
   */
  resource(key: string, type: string, request: JsonValue): Promise<JsonValue>
  /** Invoke the model with durable operation identity; replay returns the recorded answer.
   *
   * @param operationId - stable stage-local key.
   *
   * @param prompt - model-visible instruction.
   *
   * @returns the completed model text, never an idle-state guess.
   */
  model(operationId: string, prompt: string): Promise<string>
  /** Dispatch or associate ordinary work from a special run.
   *
   * @param requestId - stable dispatch identity within this run.
   *
   * @param input - business data admitted by the plugin.
   *
   * @returns durable association receipt.
   */
  dispatch(requestId: TaskRequestId, input: JsonValue): Promise<TaskDispatchReceipt>
  /** Execute an external operation once, or reconcile an uncertain prior attempt.
   *
   * @param key - stable stage-local operation key.
   *
   * @param execute - cancellation-aware side effect.
   *
   * @param reconcile - inspect external evidence without blindly repeating a write.
   *
   * @returns persisted result reused on recovery.
   */
  operation(
    key: string, execute: (signal: AbortSignal) => Promise<JsonValue>, reconcile: (signal: AbortSignal) => Promise<JsonValue>,
  ): Promise<JsonValue>
}
/** One independently installed business plugin contributes exactly one special definition. */
export interface TaskDefinition {
  readonly id: TaskDefinitionId
  readonly title: string
  readonly codeVersion: string
  readonly config: TaskConfig
  readonly forms?: TaskForms
  /** Recoverable process, browser or business-resource adapters, retained with this code version. */
  readonly resourceHandlers?: Readonly<Record<string, TaskResourceHandler>>
  /** Migrate saved business configuration when the declared schema version changes.
   * @param value - previous non-secret business configuration.
   * @param fromVersion - previous schema generation.
   * @returns configuration accepted by the current schema.
   */
  migrateConfig?(value: JsonValue, fromVersion: number): JsonValue
  /** Check external prerequisites without executing business work.
   * @param config - proposed configuration.
   * @param signal - cancelled on timeout or caller disposal.
   * @returns value-free diagnostic messages.
   */
  checkConfig?(config: TaskConfig, signal: AbortSignal): Promise<readonly string[]>
  /** Resolve options for a schema property without providing frontend code.
   * @param field - property selected by the form.
   * @param config - proposed configuration.
   * @param signal - caller cancellation.
   * @returns selectable JSON values and labels.
   */
  options?(field: string, config: TaskConfig, signal: AbortSignal): Promise<readonly { value: JsonValue; label: string }[]>
  /** Validate and normalize persisted/external business input.
   *
   * @param value - untrusted durable or wire input.
   *
   * @returns validated JSON data.
   */
  parseInput(value: unknown): JsonValue
  /** Validate a checkpoint loaded after process restart.
   *
   * @param value - durable stage data.
   *
   * @returns validated checkpoint.
   */
  parseCheckpoint(value: unknown): JsonValue
  /** Run one bounded special stage.
   *
   * @param stage - admitted execution capabilities.
   *
   * @returns next durable lifecycle decision.
   */
  runSpecial(stage: TaskStage): Promise<TaskStageResult>
  /** Run one bounded ordinary stage.
   *
   * @param stage - admitted execution capabilities.
   *
   * @returns next durable lifecycle decision.
   */
  runOrdinary?(stage: TaskStage): Promise<TaskStageResult>
  /** Resolve business identity before atomic association.
   *
   * @param input - validated incoming business data.
   *
   * @returns stable business key within this definition.
   */
  businessKey?(input: JsonValue): string
  /** Decide whether a discovery changes unfinished work; synchronous to commit atomically.
   *
   * @param previous - most recently observed data.
   *
   * @param incoming - new discovery.
   *
   * @returns ignore, deliver update, or cancel the existing execution.
   */
  compareUpdate?(previous: JsonValue, incoming: JsonValue): 'ignore' | 'update' | 'cancel'
  /** Rank runnable work; larger values run first, then creation order.
   *
   * @param run - queued snapshot.
   *
   * @returns finite priority.
   */
  priority(run: TaskRun): number
  /** Resource locks retained across waits until cleanup succeeds.
   *
   * @param input - initial business data.
   *
   * @returns globally meaningful exclusive resource keys.
   */
  resources(input: JsonValue): readonly string[]
  /** Exclusive resources needed only during the next stage, released when that stage settles.
   * @param run - candidate with its durable checkpoint.
   * @returns transient resource keys, such as a compiler or browser operation.
   */
  stageResources?(run: TaskRun): readonly string[]
  /** Classify a stage failure without discarding its checkpoint.
   *
   * @param error - stage exception.
   *
   * @param run - latest execution snapshot.
   *
   * @returns retry, block, or business failure.
   */
  classifyError(error: unknown, run: TaskRun): Extract<TaskStageResult, { kind: 'retry' | 'block' | 'fail' }>
  /** Drain and clean owned resources; do not delete shared logins or repositories.
   *
   * @param run - settled execution with persisted resource identities.
   *
   * @param signal - aborted when the cleanup deadline expires; settle after stopping owned work.
   *
   * @returns completion only after owned resources are quiescent.
   */
  cleanup(run: TaskRun, signal: AbortSignal): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context { tasks: TaskService }
}

/** Provider-neutral task service. Only registered special runs may dispatch ordinary work. */
export abstract class TaskService extends Service {
  constructor(ctx: Context) { super(ctx, 'tasks') }
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
  abstract options(
    id: TaskDefinitionId, field: string, config: TaskConfig, signal: AbortSignal,
  ): Promise<readonly { value: JsonValue; label: string }[]>
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
}
export default TaskService
