/** Durable task vocabulary shared by plugins, persistence, and clients. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Stable installed business definition identity. */
export type TaskDefinitionId = Branded<'TaskDefinitionId'>
/** One execution, including all resumed stages. */
export type TaskRunId = Branded<'TaskRunId'>
/** Caller-generated durable command identity. */
export type TaskRequestId = Branded<'TaskRequestId'>
/** A versioned human interaction identity. */
export type TaskWaitId = Branded<'TaskWaitId'>
/** Persistent identity of one task database. */
export type TaskStoreId = Branded<'TaskStoreId'>
/** Durable plugin retirement identity. */
export type TaskRetirementId = Branded<'TaskRetirementId'>
/** Removal remains pending until every owned execution and resource settles. */
export interface TaskRetirement {
  readonly id: TaskRetirementId
  readonly definitionId: TaskDefinitionId
  readonly codeVersion: string
  readonly state: 'pending' | 'blocked' | 'complete'
  readonly requestedAt: number
  readonly completedAt: number | null
}
/** Executable trigger categories. */
export type SpecialTaskKind = 'polling' | 'scheduled' | 'manual'
/** Lifecycle values; waits retain the same Session. */
export type TaskStatus = 'provisioning' | 'queued' | 'running' | 'waiting_input' | 'waiting_retry' | 'blocked' | 'recovering' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled'
/** Trigger configuration is resolved before storage. */
export type TaskSchedule = { readonly kind: 'manual' }
  | { readonly kind: 'polling'; readonly intervalMs: number }
  | { readonly kind: 'scheduled'; readonly cron: string; readonly timezone: string; readonly misfire: 'all' | 'coalesce' | 'skip'; readonly overlap: 'queue' | 'allow' }
/** Non-secret business and execution configuration copied into each run. */
export interface TaskConfig {
  readonly schedule: TaskSchedule
  readonly concurrency: number
  readonly preset: string
  readonly permissionPreset: string
  readonly workspacePath: string
  readonly business: JsonValue
  readonly model?: { readonly provider: string; readonly model: string }
}
/** Read model of one installed or historical definition. */
export interface TaskDefinitionView {
  readonly id: TaskDefinitionId
  readonly title: string
  readonly codeVersion: string
  readonly revision: number
  readonly enabled: boolean
  readonly installed: boolean
  readonly config: TaskConfig
  readonly nextDueAt: number | null
  readonly forms?: TaskForms
}
/** Ordered input consumed with a stage checkpoint commit. */
export interface TaskInput {
  readonly id: TaskRequestId
  readonly revision: number
  readonly kind: 'update' | 'response' | 'input'
  readonly value: JsonValue
}
/** A durable, revision-bound interaction. */
export interface TaskWait {
  readonly id: TaskWaitId
  readonly revision: number
  readonly prompt: JsonValue
  readonly schema?: JsonValue
  readonly expiresAt?: number
}
/** Immutable execution snapshot returned by reads and stage admission. */
export interface TaskRun {
  readonly id: TaskRunId
  readonly sessionId: SessionId
  readonly definitionId: TaskDefinitionId
  readonly kind: SpecialTaskKind | 'ordinary'
  readonly parentRunId: TaskRunId | null
  readonly businessKey: string | null
  readonly codeVersion: string
  readonly configRevision: number
  /** Immutable schema generation captured with the execution configuration. */
  readonly forms?: TaskForms
  readonly config: TaskConfig
  readonly input: JsonValue
  readonly checkpoint: JsonValue
  readonly revision: number
  readonly inputRevision: number
  readonly status: TaskStatus
  readonly wait: TaskWait | null
  readonly retryAt: number | null
  readonly result: JsonValue
  readonly reason: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly terminalAt: number | null
  readonly cleanup: 'pending' | 'blocked' | 'complete'
  readonly resources: readonly string[]
}
/** Receipt for an idempotent dispatch; associations outlive their parent. */
export interface TaskDispatchReceipt {
  readonly outcome: 'created' | 'associated'
  readonly runId: TaskRunId
  readonly sessionId: SessionId
  readonly changed: boolean
}
/** Durable stage decision. Input consumption and checkpoint changes commit together. */
export type TaskStageResult =
  | { readonly kind: 'advance'; readonly checkpoint: JsonValue }
  | { readonly kind: 'wait'; readonly checkpoint: JsonValue; readonly prompt: JsonValue; readonly schema?: JsonValue; readonly expiresAt?: number }
  | { readonly kind: 'retry'; readonly checkpoint: JsonValue; readonly at: number; readonly reason: string }
  | { readonly kind: 'block'; readonly checkpoint: JsonValue; readonly reason: string }
  | { readonly kind: 'succeed'; readonly result: JsonValue }
  | { readonly kind: 'fail'; readonly reason: string }
/** Persistent audit record, safe for clients; input content is stored separately. */
export interface TaskJournalEntry {
  readonly sequence: number
  readonly runId: TaskRunId | null
  readonly event: string
  readonly at: number
  readonly details: JsonValue
}

/** Authenticated caller identity used to isolate command retry keys. */
export type TaskPrincipalId = Branded<'TaskPrincipalId'>
/** Administrative mutations admitted atomically with their retry receipts. */
export type TaskCommand =
  | { readonly kind: 'retire'; readonly definitionId: TaskDefinitionId; readonly revision: number }
  | { readonly kind: 'configure'; readonly definitionId: TaskDefinitionId; readonly revision: number; readonly config: TaskConfig; readonly configSchemaVersion?: number }
  | { readonly kind: 'enable'; readonly definitionId: TaskDefinitionId; readonly revision: number; readonly enabled: boolean }
  | { readonly kind: 'trigger'; readonly definitionId: TaskDefinitionId; readonly input: JsonValue }
  | { readonly kind: 'input'; readonly runId: TaskRunId; readonly input: JsonValue }
  | { readonly kind: 'respond'; readonly runId: TaskRunId; readonly waitId: TaskWaitId; readonly revision: number; readonly response: JsonValue }
  | { readonly kind: 'cancel'; readonly runId: TaskRunId }
/** Original admission result, retained even after the task changes. */
export type TaskCommandResult =
  | { readonly kind: 'retirement'; readonly retirement: TaskRetirement }
  | { readonly kind: 'definition'; readonly definition: TaskDefinitionView }
  | { readonly kind: 'run'; readonly run: TaskRun }
  | { readonly kind: 'cancellation'; readonly runId: TaskRunId; readonly status: 'cancelling' }

/** Durable Task journal position, scoped to one database identity. */
export interface TaskJournalCursor {
  readonly storeId: TaskStoreId
  readonly sequence: number
}

/** Self-contained JSON Schema documents owned by a business plugin. */
export interface TaskForms {
  readonly version: number
  readonly business: Record<string, JsonValue>
  readonly input: Record<string, JsonValue>
}
/** Persisted interactive request; a withdrawn runtime request cannot authorize a new tool call. */
export interface TaskInteraction {
  readonly id: TaskWaitId
  readonly runId: TaskRunId
  readonly revision: number
  readonly source: 'tool_approval' | 'agent_question'
  readonly title: string
  readonly description: string
  readonly schema: JsonValue
  readonly createdAt: number
  readonly expiresAt: number | null
  readonly state: 'waiting' | 'answered' | 'withdrawn'
  readonly answer: JsonValue
}

/** Value-free operating state for authenticated diagnostics. */
export interface TaskDiagnostics {
  readonly scheduler: 'starting' | 'running' | 'failed' | 'stopping'
  readonly concurrency: number
  readonly activePermits: number
  readonly totalRuns: number
  readonly activeRuns: number
  readonly completedRuns: number
  readonly queuedRuns: number
  readonly oldestQueuedAt: number | null
  readonly pendingInputs: number
  readonly recoveryErrors: number
  readonly cleanupFailures: number
  readonly outboxPending: number
  readonly oldestOutboxAt: number | null
  readonly resources: readonly { name: string; capacity: number; runIds: readonly TaskRunId[] }[]
  readonly retirements: readonly TaskRetirement[]
  readonly storage: { availableBytes: number; totalBytes: number; pressure: boolean } | null
}

/** Durable identity and cleanup progress of one owned runtime resource. */
export interface TaskResourceRecord {
  readonly runId: TaskRunId
  readonly key: string
  readonly type: string
  readonly request: JsonValue
  readonly value: JsonValue
  readonly state: 'prepared' | 'ready' | 'cleaning' | 'released' | 'blocked'
}
/** Resource adapters own external identity checks and must not remove shared state. */
export interface TaskResourceHandler {
  /** Acquire after intent is durable.
   * @param record - stable identity and original request.
   * @param signal - stage cancellation.
   * @returns JSON handle stored before the stage receives it.
   */
  acquire(record: TaskResourceRecord, signal: AbortSignal): Promise<JsonValue>
  /** Inspect a prior uncertain acquisition without blindly repeating a side effect.
   * @param record - durable acquisition intent.
   * @param signal - stage cancellation.
   * @returns confirmed JSON handle.
   */
  reconcile(record: TaskResourceRecord, signal: AbortSignal): Promise<JsonValue>
  /** Idempotently stop and clean the owned resource, including uncertain acquisition.
   * @param record - original identity, request and last confirmed handle.
   * @param signal - cleanup deadline; return only after the resource is quiescent.
   * @returns confirmation that releasing its reservation is safe.
   */
  cleanup(record: TaskResourceRecord, signal: AbortSignal): Promise<void>
}

/** Providers deduplicate store/sequence identities when retrying uncertain delivery. */
export interface TaskNotificationProvider {
  /** Deliver safe task identity and state metadata; never include business payloads.
   * @param store - database identity, replaced after restore.
   * @param entry - committed journal record with details removed.
   * @param signal - host cancellation; settle before disposal completes.
   * @returns completion after delivery is acknowledged.
   */
  deliver(store: TaskStoreId, entry: Omit<TaskJournalEntry, 'details'>, signal: AbortSignal): Promise<void>
}

/** Bounded history selection; head and after retain insertion-order pagination. */
export interface TaskRunQuery {
  readonly limit: number
  readonly head?: TaskRunId
  readonly after?: TaskRunId
  readonly definitionId?: TaskDefinitionId
  readonly status?: TaskStatus
  readonly kind?: TaskRun['kind']
  readonly businessKey?: string
  readonly createdFrom?: number
  readonly createdTo?: number
}
/** One stable insertion-order history page. */
export interface TaskRunPage {
  readonly items: readonly TaskRun[]
  readonly head: TaskRunId | null
  readonly hasMore: boolean
}
