/** Durable task state machine, scheduling, and stage admission. */
import { TaskResources } from './resources.ts'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { assertNever, deepFreeze, snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  TaskCommand,
  TaskCommandResult,
  TaskPrincipalId,
  TaskConfig,
  TaskDefinition,
  TaskDefinitionId,
  TaskDefinitionView,
  TaskDispatchReceipt,
  TaskInput,
  TaskOccurrence,
  TaskRequestId,
  TaskRetirementId,
  TaskRun,
  TaskRunId,
  TaskSchedule,
  TaskStage,
  TaskStageResult,
  TaskWaitId,
} from '@deepseek-ai/dsh-task'
import { TaskDatabase } from './database.ts'
import { RuntimeInteractions } from './interactions.ts'
import { compileForm as validateFormSchema, validateForm, validateForms } from './forms.ts'
import { nextCalendar } from './calendar.ts'
import { dispatchReceiptSchema, retirementRecordSchema, taskConfigSchema, definitionSchema, runSchema } from './schema.ts'
import { z } from 'zod'
import { TaskCommandError } from '@deepseek-ai/dsh-task'
import { TaskChildRecoveryError } from './sessions.ts'

/** Adapter keeps the scheduler independent of Agent construction and persistence. */
export interface TaskSessions {
  /** Materialize/recover the reserved Session and flush state before admitting work.
   *
   * @param run - reserved execution.
   * @param signal - creation cancellation.
   */
  ensure(run: TaskRun, signal: AbortSignal): Promise<void>
  /** Flush committed state events.
   * @param run - latest execution.
   */
  flush(run: TaskRun): Promise<void>
  /** Run a correlated model operation.
   * @param run - admitted execution.
   * @param key - replay key.
   * @param prompt - instruction.
   * @param signal - cancellation.
   * @returns completed text.
   */
  model(run: TaskRun, key: string, prompt: string, signal: AbortSignal): Promise<string>
  /** Stop live model/tool work.
   * @param id - execution.
   */
  abort(id: TaskRunId): void
  /** Drain and close the runtime handle.
   * @param id - execution.
   */
  close(id: TaskRunId): Promise<void>
}
/** Explicit deployment knobs and owned collaborators. */
export interface TaskEngineOptions {
  readonly cancellationGraceMs: number
  readonly cleanupTimeoutMs: number
  readonly shutdownTimeoutMs: number
  /** Provider-owned generic adapters; business definitions may add independent resource types. */
  readonly resourceHandlers?: Readonly<Record<string, import('@deepseek-ai/dsh-task').TaskResourceHandler>>
  readonly concurrency: number
  readonly catchupLimit: number
  readonly catchupHorizonMs: number
  readonly pendingLimit: number
  readonly priorityAgingIntervalMs: number
  readonly priorityAgingCap: number
  readonly resourceCapacities?: Readonly<Record<string, number>>
  readonly clock: () => number
  readonly log: (event: string, details: JsonValue) => void
}
interface Worker {
  readonly abort: AbortController
  readonly done: Promise<void>
}
type TerminalStatus = 'succeeded' | 'failed' | 'cancelled'

/** Pure admission decisions plus transactional durable lifecycle changes. */
export class TaskEngine {
  private readonly definitions = new Map<TaskDefinitionId, TaskDefinition>()
  private readonly workers = new Map<TaskRunId, Worker>()
  private readonly removing = new Map<TaskDefinitionId, Promise<void>>()
  private readonly finishing = new Map<TaskRunId, Promise<void>>()
  private readonly cancelling = new Map<TaskRunId, Promise<void>>()
  /** Durable requests and live answer waiters owned by this engine. */
  readonly interactions: RuntimeInteractions
  private stopping = false
  private stopped: Promise<void> | undefined

  /**
   * @param db - owned durable database.
   * @param sessions - Session runtime adapter.
   * @param options - resolved deployment choices.
   */
  constructor(
    readonly db: TaskDatabase,
    private readonly sessions: TaskSessions,
    private readonly options: TaskEngineOptions,
  ) {
    this.interactions = new RuntimeInteractions(db, options.clock, (runId, event) => {
      this.audit(runId, event, {})
    })
    db.transaction(() => {
      for (const definition of db.definitions()) db.putDefinition({ ...definition, installed: false })
      for (const run of db.activeRuns()) {
        for (const resource of db.managedResources(run.id)) {
          if (resource.state === 'ready') db.putResource({ ...resource, state: 'prepared' })
        }
        if (
          run.terminalAt === null &&
          ['running', 'provisioning', 'queued', 'recovering'].includes(run.status)
        ) {
          this.change(run, { status: 'recovering' }, 'recovery.pending')
        }
      }
    })
  }
  /** Admit a plugin definition, preserving saved configuration across restarts.
   *
   * @param definition - executable contribution.
   */
  register(definition: TaskDefinition): void {
    this.assertOpen()
    if (this.definitions.has(definition.id) || this.removing.has(definition.id))
      throw new Error(`task definition ${definition.id} is already registered or draining`)
    validateForms(definition.forms)
    const config = this.resolveConfig(definition.config)
    if (definition.forms !== undefined) validateForm(definition.forms.business, config.business)
    if (
      (definition.runOrdinary === undefined) !== (definition.businessKey === undefined) ||
      (definition.runOrdinary !== undefined && definition.compareUpdate === undefined)
    )
      throw new Error('ordinary task handlers require businessKey and compareUpdate')
    const previous = this.definition(definition.id)
    const retirement = this.db.retirement(definition.id)
    if (retirement !== undefined && retirement.state !== 'complete' && retirement.codeVersion !== definition.codeVersion)
      throw new Error('Task retirement requires the original plugin code before an upgrade')
    if (previous !== undefined && previous.config.schedule.kind !== config.schedule.kind)
      throw new Error('task trigger kind cannot change on an existing definition')
    if (
      previous !== undefined &&
      previous.codeVersion !== definition.codeVersion &&
      this.db.activeRuns().some(run => run.definitionId === definition.id && run.terminalAt === null)
    ) {
      throw new Error(
        'task code upgrade requires cancelling and cleaning the previous version before installation',
      )
    }
    if (
      previous?.forms !== undefined &&
      (definition.forms === undefined || definition.forms.version < previous.forms.version)
    )
      throw new Error('Task schema versions cannot be removed or downgraded')
    if (
      previous?.forms !== undefined &&
      previous.forms.version === definition.forms?.version &&
      JSON.stringify(previous.forms) !== JSON.stringify(definition.forms)
    )
      throw new Error('Task schema changes require a new version')
    const forms = definition.forms === undefined ? {} : { forms: definition.forms }
    let savedConfig = previous?.config ?? config
    const changedSchema = (previous?.forms?.version ?? 0) !== (definition.forms?.version ?? 0)
    if (previous !== undefined && changedSchema) {
      if (definition.migrateConfig === undefined) throw new Error('Task schema change requires migrateConfig')
      savedConfig = this.resolveConfig({
        ...savedConfig,
        business: definition.migrateConfig(savedConfig.business, previous.forms?.version ?? 0),
      })
    }
    if (definition.forms !== undefined) validateForm(definition.forms.business, savedConfig.business)
    this.db.transaction(() => {
      this.db.putDefinition(
        previous === undefined
          ? {
            id: definition.id,
            title: definition.title,
            codeVersion: definition.codeVersion,
            revision: 1,
            enabled: true,
            installed: true,
            config,
            ...forms,
            nextDueAt: this.initialDue(config),
            blockedReason: null,
          }
          : {
            ...previous,
            ...forms,
            config: savedConfig,
            revision: previous.revision + (changedSchema ? 1 : 0),
            title: definition.title,
            codeVersion: definition.codeVersion,
            installed: true,
          },
      )
      this.audit(null, 'definition.registered', {
        definitionId: definition.id,
        codeVersion: definition.codeVersion,
      })
    })
    this.definitions.set(definition.id, definition)
    if (retirement !== undefined && retirement.state !== 'complete') {
      this.db.transaction(() =>{  this.db.putDefinition({ ...this.requireDefinition(definition.id), enabled: false }) })
    }
  }
  /** Resume interrupted removal after the initial Loader tree is available. */
  recoverRetirements(): void {
    for (const operation of this.db.retirements()) {
      if (operation.state === 'complete') continue
      if (!this.definitions.has(operation.definitionId)) {
        this.db.transaction(() => {
          this.db.putRetirement({ ...operation, state: 'blocked' })
          this.audit(null, 'retirement.code-missing', { definitionId: operation.definitionId, operationId: operation.id })
        })
        continue
      }
      void this.remove(operation.definitionId).catch(() => {
        // The durable retirement records the failure and retains its resource reservations.
      })
    }
  }
  /** Remove admission, cancel all owned work, then release plugin code.
   *
   * @param id - definition identity.
   * @returns completion after cleanup.
   */
  remove(id: TaskDefinitionId): Promise<void> {
    const existing = this.removing.get(id)
    if (existing !== undefined) return existing
    if (this.stopping) return this.shutdown()
    if (this.db.retirement(id)?.state === 'complete' && !this.definitions.has(id)) return Promise.resolve()
    const intent = this.requestRetirement(id)
    const pending = Promise.resolve().then(async () => {
      const active = this.db
        .activeRuns()
        .filter(run => run.definitionId === id && run.terminalAt === null)
        .map(run => this.cancel(run.id))
      const results = await Promise.allSettled(active)
      const failures = results.filter(result => result.status === 'rejected')
      if (failures.length !== 0)
        throw new AggregateError(
          failures.map((result): unknown => result.reason),
          'task plugin cleanup remains blocked',
        )
      this.db.transaction(() => {
        this.db.putRetirement({ ...intent, state: 'complete', completedAt: this.options.clock() })
        this.db.putDefinition({ ...this.requireDefinition(id), installed: false, enabled: false })
        this.audit(null, 'definition.removed', { definitionId: id, operationId: intent.id })
      })
      this.definitions.delete(id)
    }).catch((error: unknown) => {
      this.db.transaction(() => {
        this.db.putRetirement({ ...intent, state: 'blocked' })
        this.audit(null, 'retirement.blocked', { definitionId: id, operationId: intent.id })
      })
      throw error
    })
    this.removing.set(id, pending)
    void pending
      .finally(() => this.removing.delete(id))
      .catch(() => {
        /* The returned removal Promise reports cleanup failure. */
      })
    return pending
  }
  /** Persist retirement before recovering a removed plugin's original entry.
   * @param id - retained definition identity.
   * @returns durable retirement intent with admission closed.
   */
  requestRetirement(id: TaskDefinitionId): import('@deepseek-ai/dsh-task').TaskRetirement {
    const definition = this.requireDefinition(id)
    const previous = this.db.retirement(id)
    const intent = previous !== undefined && previous.state !== 'complete' ? previous : {
      id: brandString<TaskRetirementId>(randomUUID()), definitionId: id, codeVersion: definition.codeVersion,
      state: 'pending' as const, requestedAt: this.options.clock(), completedAt: null,
    }
    this.db.transaction(() => {
      this.db.putRetirement({ ...intent, state: 'pending' })
      this.db.putDefinition({ ...definition, revision: previous?.state === 'pending' ? definition.revision : definition.revision + 1, installed: false, enabled: false })
      for (const run of this.db.activeRuns().filter(run => run.definitionId === id && run.status !== 'cancelling'))
        this.change(run, { status: 'cancelling', wait: null }, 'cancel.requested')
      this.audit(null, 'retirement.requested', { definitionId: id, operationId: intent.id })
    })
    return intent
  }
  /** Validate prospective configuration and delegate external prerequisite checks.
   * @param id - installed definition.
   * @param config - proposed configuration.
   * @param signal - caller cancellation.
   * @returns plugin diagnostics without saving configuration.
   */
  async checkConfig(
    id: TaskDefinitionId,
    config: TaskConfig,
    signal: AbortSignal,
  ): Promise<readonly string[]> {
    const plugin = this.plugin(id)
    this.resolveConfig(config)
    if (plugin.forms !== undefined) validateForm(plugin.forms.business, config.business)
    return (await plugin.checkConfig?.(config, signal)) ?? []
  }
  /** Delegate dynamic option discovery.
   * @param id - installed definition.
   * @param field - schema field.
   * @param config - proposed configuration.
   * @param signal - caller cancellation.
   * @returns selectable values and labels.
   */
  async formOptions(
    id: TaskDefinitionId,
    field: string,
    config: TaskConfig,
    signal: AbortSignal,
  ): Promise<readonly { value: JsonValue; label: string }[]> {
    return (await this.plugin(id).options?.(field, config, signal)) ?? []
  }
  /** Replace future configuration without mutating active snapshots.
   *
   * @param id - definition.
   * @param revision - optimistic revision.
   * @param input - complete config.
   */
  updateConfig(id: TaskDefinitionId, revision: number, input: TaskConfig): void {
    this.assertOpen()
    const current = this.requireDefinition(id)
    const config = this.resolveConfig(input)
    const forms = this.plugin(id).forms
    if (forms !== undefined) validateForm(forms.business, config.business)
    if (revision !== current.revision)
      throw new TaskCommandError(
        'revision_conflict',
        'task configuration revision conflict',
        current.revision,
      )
    if (config.schedule.kind !== current.config.schedule.kind)
      throw new TaskCommandError('invalid_state', 'task trigger kind cannot change')
    this.db.transaction(() => {
      const unchangedSchedule = JSON.stringify(config.schedule) === JSON.stringify(current.config.schedule)
      const nextDueAt = unchangedSchedule
        ? (this.db.calendarScan(id)?.from ?? current.nextDueAt)
        : this.initialDue(config)
      this.db.putCalendarScan(id, null)
      this.db.putDefinition({ ...current, config, revision: revision + 1, nextDueAt })
      this.audit(null, 'definition.configured', { definitionId: id, revision: revision + 1 })
    })
  }
  /** Set scheduling availability.
   * @param id - definition.
   * @param enabled - desired state.
   */
  setEnabled(id: TaskDefinitionId, enabled: boolean): void {
    this.assertOpen()
    const current = this.requireDefinition(id)
    const retirement = this.db.retirement(id)
    if (enabled && retirement !== undefined && retirement.state !== 'complete')
      throw new TaskCommandError('invalid_state', 'Task retirement must finish before admission resumes')
    this.db.transaction(() => {
      this.db.putDefinition({ ...current, enabled, revision: current.revision + 1,
        blockedReason: enabled ? null : current.blockedReason })
      this.audit(null, 'definition.enabled', { definitionId: id, enabled, revision: current.revision + 1 })
    })
  }
  /** Idempotently reserve a manual execution.
   *
   * @param id - definition.
   * @param requestId - caller identity.
   * @param input - business data.
   * @returns run snapshot.
   */
  triggerManual(id: TaskDefinitionId, requestId: TaskRequestId, input: JsonValue): TaskRun {
    this.assertOpen()
    const definition = this.requireDefinition(id)
    if (definition.config.schedule.kind !== 'manual')
      throw new TaskCommandError('invalid_state', 'only manual definitions accept manual triggers')
    return this.db.transaction(() => this.trigger(definition, requestId, input))
  }
  /** Commit command admission and its immutable response together.
   * @param principal - stable authenticated caller.
   * @param requestId - caller retry key.
   * @param command - validated mutation.
   * @returns the original receipt on a matching replay.
   */
  command(principal: TaskPrincipalId, requestId: TaskRequestId, command: TaskCommand): TaskCommandResult {
    this.assertOpen()
    const scope = `command:${principal}`
    const input = json(command)
    return this.db.transaction(() => {
      const previous = this.db.receipt(scope, requestId, input)
      if (previous !== undefined) return commandResultSchema.parse(previous)
      // Legacy operation receipts use an internal key so different callers cannot collide.
      const operationId = brandString<TaskRequestId>(randomUUID())
      const result = this.applyCommand(command, operationId)
      this.db.putReceipt(scope, requestId, input, json(result))
      this.audit('runId' in command ? command.runId : null, 'command.admitted', { kind: command.kind })
      return result
    })
  }
  private applyCommand(command: TaskCommand, requestId: TaskRequestId): TaskCommandResult {
    switch (command.kind) {
      case 'retire': {
        const current = this.requireDefinition(command.definitionId)
        if (current.revision !== command.revision)
          throw new TaskCommandError('revision_conflict', 'Task definition revision conflict', current.revision)
        const retirement = this.requestRetirement(command.definitionId)
        this.db.afterCommit(() => {
          void this.remove(command.definitionId).catch(() => { /* Blocked retirement remains durable and queryable. */ })
        })
        return { kind: 'retirement', retirement }
      }
      case 'configure':
        if (
          command.configSchemaVersion !== undefined &&
          command.configSchemaVersion !== (this.requireDefinition(command.definitionId).forms?.version ?? 0)
        )
          throw new TaskCommandError('revision_conflict', 'Task configuration schema version differs')
        this.updateConfig(command.definitionId, command.revision, command.config)
        return { kind: 'definition', definition: this.requireDefinition(command.definitionId) }
      case 'enable': {
        const current = this.requireDefinition(command.definitionId)
        if (current.revision !== command.revision)
          throw new TaskCommandError(
            'revision_conflict',
            'task configuration revision conflict',
            current.revision,
          )
        this.setEnabled(command.definitionId, command.enabled)
        return { kind: 'definition', definition: this.requireDefinition(command.definitionId) }
      }
      case 'trigger':
        return { kind: 'run', run: this.triggerManual(command.definitionId, requestId, command.input) }
      case 'input':
        this.sendInput(command.runId, requestId, command.input)
        return { kind: 'run', run: this.requireRun(command.runId) }
      case 'respond':
        this.respond(command.runId, command.waitId, command.revision, requestId, command.response)
        return { kind: 'run', run: this.requireRun(command.runId) }
      case 'cancel': {
        const run = this.requireRun(command.runId)
        if (run.terminalAt !== null) throw new TaskCommandError('read_only', 'task is read-only')
        if (run.status !== 'cancelling')
          this.change(run, { status: 'cancelling', wait: null }, 'cancel.requested')
        this.db.afterCommit(() => {
          void this.cancel(run.id).catch(() => {
            // Cancellation failures retain their durable blocked state for repair.
          })
        })
        return { kind: 'cancellation', runId: run.id, status: 'cancelling' }
      }
      case 'cleanup': {
        const run = this.requireRun(command.runId)
        if (run.terminalAt !== null) throw new TaskCommandError('read_only', 'task is read-only')
        if (run.cleanup !== 'blocked') throw new TaskCommandError('invalid_state', 'task cleanup is not blocked')
        this.change(run, { status: 'cancelling', wait: null }, 'cleanup.retry')
        this.db.afterCommit(() => {
          void this.cancel(run.id).catch(() => {
            // A repeated cleanup failure records its blocked state again.
          })
        })
        return { kind: 'cancellation', runId: run.id, status: 'cancelling' }
      }
      /* v8 ignore next -- TaskCommand is a closed union decoded before admission. */
      default:
        return assertNever(command)
    }
  }
  /** Advance due schedules and admit work up to configured concurrency. */
  tick(): void {
    if (this.stopping) return
    this.interactions.expire()
    this.schedule()
    const now = this.options.clock()
    for (const run of this.db.activeRuns()) {
      const wait = run.wait
      if (run.status === 'waiting_input' && wait !== null && wait.expiresAt !== undefined && wait.expiresAt <= now) {
        this.db.transaction(() => {
          this.addInput(
            run,
            brandString<TaskRequestId>(`timeout:${wait.id}`),
            { kind: 'timeout', waitId: wait.id },
            'input',
          )
        })
      }
      if (run.status === 'waiting_retry' && run.retryAt !== null && run.retryAt <= now) {
        this.db.transaction(() => this.change(run, { status: 'queued', retryAt: null }, 'retry.ready'))
      }
    }
    const candidates = this.db
      .activeRuns()
      .filter(
        run =>
          run.terminalAt === null &&
          ['queued', 'provisioning', 'recovering', 'cancelling'].includes(run.status) &&
          this.definitions.has(run.definitionId) &&
          !this.removing.has(run.definitionId) &&
          !this.workers.has(run.id) && !this.cancelling.has(run.id),
      )
    const ranked = candidates
      .flatMap((run) => {
        try {
          const priority = this.plugin(run.definitionId).priority(run)
          if (!Number.isFinite(priority)) throw new Error('task priority must be finite')
          const age = Math.min(
            this.options.priorityAgingCap,
            Math.floor(Math.max(0, now - run.updatedAt) / this.options.priorityAgingIntervalMs),
          )
          return [{ run, priority: priority + age }]
        } catch (error: unknown) {
          this.blockAdmission(run, error)
          return []
        }
      })
      .sort((a, b) => b.priority - a.priority || a.run.createdAt - b.run.createdAt)
    for (const { run } of ranked) {
      if (this.workers.size >= this.options.concurrency) break
      const active = [...this.workers.keys()]
        .map(id => this.requireRun(id))
        .filter(value => value.definitionId === run.definitionId).length
      const definition = this.requireDefinition(run.definitionId)
      if (active >= definition.config.concurrency) continue
      if (
        run.kind === 'scheduled' &&
        definition.config.schedule.kind === 'scheduled' &&
        definition.config.schedule.overlap === 'queue' &&
        this.db
          .activeRuns()
          .find(other => other.definitionId === run.definitionId && other.kind === 'scheduled')?.id !==
          run.id
      )
        continue
      let transient: readonly string[]
      try {
        transient = this.plugin(run.definitionId).stageResources?.(run) ?? []
      } catch (error: unknown) {
        this.blockAdmission(run, error)
        continue
      }
      if (!this.db.transaction(() => this.db.acquire(run, transient, this.options.resourceCapacities))) continue
      this.audit(run.id, 'resources.acquired', {
        retained: run.resources.length,
        transient: transient.length,
      })
      const abort = new AbortController()
      const done = Promise.resolve()
        .then(() => this.execute(run.id, abort.signal))
        .catch((error: unknown) => {
          this.audit(run.id, 'worker.failed', { error: error instanceof Error ? error.name : 'unknown' })
          const latest = this.requireRun(run.id)
          if (!this.stopping && latest.terminalAt === null && latest.status === 'running')
            this.blockAdmission(latest, error)
        })
        .finally(() => {
          this.db.transaction(() => {
            this.db.releaseStage(run)
          })
          this.audit(run.id, 'resources.stage-released', {})
          this.workers.delete(run.id)
        })
      this.workers.set(run.id, { abort, done })
    }
  }
  /** Wait for currently admitted stages, without polling timers.
   * @returns quiescence of the sampled workers.
   */
  async drain(): Promise<void> {
    await Promise.all([...this.workers.values()].map(worker => worker.done))
    await Promise.allSettled(this.cancelling.values())
    await Promise.allSettled(this.removing.values())
  }
  /** Dispatch from a live special stage only.
   *
   * @param parentId - execution.
   * @param requestId - retry identity.
   * @param raw - business data.
   * @returns receipt.
   */
  dispatch(parentId: TaskRunId, requestId: TaskRequestId, raw: JsonValue): Promise<TaskDispatchReceipt> {
    return Promise.resolve().then(() => this.dispatchNow(parentId, requestId, raw))
  }
  private dispatchNow(parentId: TaskRunId, requestId: TaskRequestId, raw: JsonValue): TaskDispatchReceipt {
    this.assertOpen()
    const parent = this.requireRun(parentId)
    const worker = this.workers.get(parentId)
    if (
      parent.kind === 'ordinary' ||
      parent.status !== 'running' ||
      worker === undefined ||
      worker.abort.signal.aborted
    )
      throw new Error('ordinary dispatch requires an admitted special task')
    const plugin = this.plugin(parent.definitionId)
    if (
      plugin.businessKey === undefined ||
      plugin.runOrdinary === undefined ||
      plugin.compareUpdate === undefined
    )
      throw new Error('definition cannot dispatch ordinary tasks')
    const compareUpdate = plugin.compareUpdate.bind(plugin)
    const input = json(plugin.parseInput(raw))
    const key = plugin.businessKey(input)
    if (key.trim() === '') throw new Error('business key must not be empty')
    let cancel: TaskRunId | undefined
    const result = this.db.transaction(() => {
      const recorded = this.db.receipt(`dispatch:${parentId}`, requestId, input)
      if (recorded !== undefined) return dispatchReceiptSchema.parse(recorded)
      let target = this.db
        .activeRuns()
        .find(run => run.definitionId === parent.definitionId && run.businessKey === key)
      const outcome = target === undefined ? 'created' : 'associated'
      let changed = false
      if (target === undefined) {
        target = this.reserve(this.requireDefinition(parent.definitionId), input, parent, key)
        this.db.observe(target.id, input)
      } else if (target.status !== 'cancelling' && target.cleanup !== 'blocked') {
        const update = compareUpdate(this.db.observation(target.id), input)
        changed = update !== 'ignore'
        if (update === 'update') this.addInput(target, requestId, input, 'update')
        if (update === 'cancel') {
          cancel = target.id
          this.change(target, { status: 'cancelling', wait: null }, 'update.cancel')
        }
        this.db.observe(target.id, input)
      }
      this.db.associate(parentId, requestId, target.id)
      const receipt: TaskDispatchReceipt = { outcome, runId: target.id, sessionId: target.sessionId, changed }
      this.db.putReceipt(`dispatch:${parentId}`, requestId, input, json(receipt))
      this.audit(target.id, `dispatch.${outcome}`, { parentRunId: parentId, requestId, changed })
      return receipt
    })
    if (cancel !== undefined) {
      this.sessions.abort(cancel)
      this.workers.get(cancel)?.abort.abort()
    }
    return result
  }
  /** Deliver a revision-bound confirmation.
   *
   * @param id - run.
   * @param waitId - interaction.
   * @param revision - observed revision.
   * @param requestId - retry key.
   * @param response - user input.
   */
  respond(
    id: TaskRunId,
    waitId: TaskWaitId,
    revision: number,
    requestId: TaskRequestId,
    response: JsonValue,
  ): void {
    this.assertOpen()
    this.db.transaction(() => {
      if (this.interactions.has(waitId)) {
        this.interactions.respond(id, waitId, revision, response)
        return
      }
      const payload = json({ waitId, revision, response })
      if (this.db.receipt(`response:${id}`, requestId, payload) !== undefined) return
      const run = this.requireRun(id)
      if (
        run.terminalAt !== null ||
        (run.wait?.expiresAt !== undefined && run.wait.expiresAt <= this.options.clock()) ||
        run.status !== 'waiting_input' ||
        run.wait?.id !== waitId ||
        run.wait.revision !== revision
      )
        throw new TaskCommandError('stale_interaction', 'task confirmation is stale or closed')
      if (run.wait.schema !== undefined) validateForm(run.wait.schema, response)
      this.addInput(run, requestId, json(response), 'response')
      this.db.putReceipt(`response:${id}`, requestId, payload, true)
    })
  }
  /** Deliver user data to unfinished work.
   *
   * @param id - execution.
   * @param requestId - retry identity.
   * @param input - supplemental data.
   */
  sendInput(id: TaskRunId, requestId: TaskRequestId, input: JsonValue): void {
    this.assertOpen()
    this.db.transaction(() => {
      const value = json(input)
      if (this.db.receipt(`input:${id}`, requestId, value) !== undefined) return
      const run = this.requireRun(id)
      if (run.terminalAt !== null || run.status === 'cancelling' || run.cleanup === 'blocked')
        throw new TaskCommandError('read_only', 'task is read-only or awaiting cleanup')
      if (run.forms?.supplement !== undefined) validateForm(run.forms.supplement, value)
      this.addInput(run, requestId, value, 'input')
      this.db.putReceipt(`input:${id}`, requestId, value, true)
    })
  }
  /** Cancel and drain one execution independently of its children.
   *
   * @param id - execution.
   * @returns completion after owned cleanup.
   */
  cancel(id: TaskRunId): Promise<void> {
    const pending = this.cancelling.get(id)
    if (pending !== undefined) return pending
    const run = this.requireRun(id)
    if (run.terminalAt !== null) return Promise.resolve()
    if (run.status !== 'cancelling')
      this.db.transaction(() => this.change(run, { status: 'cancelling', wait: null }, 'cancel.requested'))
    const worker = this.workers.get(id)
    this.sessions.abort(id)
    worker?.abort.abort()
    const completion = this.withDeadline(run.id, 'cancel.timeout', this.options.cancellationGraceMs, async () => {
      await worker?.done
    }).then(async () => {
      const latest = this.requireRun(id)
      if (latest.terminalAt !== null) return
      const terminal = this.recordedSettlement(id, 'cancelled by user or plugin removal')
      await this.finish(latest, terminal.status, terminal.result, terminal.reason)
    }).finally(() => this.cancelling.delete(id))
    this.cancelling.set(id, completion)
    return completion
  }
  /** Stop new work synchronously, then preserve active checkpoints and Sessions.
   *
   * @returns the same shutdown barrier on repeated calls.
   */
  shutdown(): Promise<void> {
    if (this.stopped !== undefined) return this.stopped
    this.stopping = true
    for (const [id, worker] of this.workers) {
      worker.abort.abort()
      this.sessions.abort(id)
    }
    this.stopped = this.withDeadline(null, 'shutdown.timeout', this.options.shutdownTimeoutMs, async () => {
      await this.drain()
      for (const run of this.db.activeRuns()) {
        await this.sessions.close(run.id)
        if (run.terminalAt === null && run.status === 'running')
          this.db.transaction(() => this.change(run, { status: 'recovering' }, 'shutdown.checkpoint'))
      }
      this.audit(null, 'host.stopped', {})
    })
    return this.stopped
  }

  private async withDeadline(
    id: TaskRunId | null, event: string, timeoutMs: number, operation: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const abort = new AbortController()
    let auditFailure: Error | undefined
    const timer = setTimeout(() => {
      try { this.audit(id, event, { timeoutMs }) }
      catch (error) { auditFailure = new Error('task deadline audit failed', { cause: error }) }
      abort.abort(new Error(event))
    }, timeoutMs)
    try {
      await operation(abort.signal)
      if (auditFailure !== undefined) throw auditFailure
    } finally { clearTimeout(timer) }
  }
  private resolveConfig(input: TaskConfig): TaskConfig {
    const config = taskConfigSchema.parse(input)
    if (!isAbsolute(config.workspacePath))
      throw new TaskCommandError('invalid_configuration', 'task workspacePath must be absolute')
    if (config.schedule.kind === 'scheduled') {
      try {
        nextCalendar(config.schedule, this.options.clock())
      } catch {
        throw new TaskCommandError('invalid_configuration', 'invalid task calendar expression or timezone')
      }
    }
    return config
  }
  private initialDue(config: TaskConfig): number | null {
    if (config.schedule.kind === 'manual') return null
    if (config.schedule.kind === 'polling') return this.options.clock()
    return nextCalendar(config.schedule, this.options.clock())
  }
  private schedule(): void {
    const now = this.options.clock()
    for (const definition of this.db.definitions()) {
      if (
        !definition.enabled ||
        !definition.installed ||
        !this.definitions.has(definition.id) ||
        this.removing.has(definition.id)
      )
        continue
      const rule = definition.config.schedule
      const due = definition.nextDueAt
      if (rule.kind === 'manual' || due === null || due > now) continue
      try {
        if (rule.kind === 'polling') {
          if (
            this.db
              .activeRuns()
              .some(
                run =>
                  run.definitionId === definition.id && run.kind === 'polling' && run.terminalAt === null,
              )
          )
            continue
          this.db.transaction(() => {
            this.trigger(
              definition,
              brandString<TaskRequestId>(`poll:${definition.revision}:${due}`),
              null,
              { scheduledAt: due, missed: null },
            )
            this.db.putDefinition({ ...definition, nextDueAt: null })
          })
        } else {
          this.db.transaction(() => {
            this.scanCalendar(definition, rule, due, now)
          })
        }
      } catch (error: unknown) {
        this.db.transaction(() => {
          this.db.putDefinition({ ...definition, enabled: false,
            blockedReason: `schedule evaluation failed (${error instanceof Error ? error.name : 'unknown'})` })
          this.audit(null, 'schedule.blocked', {
            definitionId: definition.id,
            error: error instanceof Error ? error.name : 'unknown',
          })
        })
      }
    }
  }
  private scanCalendar(definition: TaskDefinitionView, rule: Extract<TaskSchedule, { kind: 'scheduled' }>, nextDueAt: number, now: number): void {
    let due: number | null = nextDueAt
    let scan = this.db.calendarScan(definition.id)
    const cutoff = now - this.options.catchupHorizonMs
    if (scan === undefined && due < cutoff) {
      this.audit(null, 'calendar.horizon-skipped', {
        definitionId: definition.id,
        from: due,
        through: cutoff,
      })
      due = nextCalendar(rule, cutoff - 1)
    }
    if (scan?.last === due && due !== null) due = nextCalendar(rule, due)
    if (due === null) {
      this.db.putDefinition({ ...definition, nextDueAt: null })
      return
    }
    scan ??= { from: due, through: now, count: 0, last: null, pressured: false }
    let pending = this.db
      .activeRuns()
      .filter(run => run.definitionId === definition.id && run.kind === 'scheduled').length
    let scanned = 0
    while (due !== null && due <= scan.through && scanned < this.options.catchupLimit) {
      if (rule.misfire === 'all') {
        if (pending >= this.options.pendingLimit) break
        this.trigger(definition, brandString<TaskRequestId>(`calendar:${definition.revision}:${due}`), {
          scheduledAt: due,
        }, { scheduledAt: due, missed: null })
        pending++
      }
      scan = { ...scan, count: scan.count + 1, last: due }
      scanned++
      due = nextCalendar(rule, due)
    }
    const complete = due === null || due > scan.through
    const last = scan.last
    const needsRun =
      last !== null &&
      (rule.misfire === 'coalesce' ||
        (rule.misfire === 'skip' && scan.count === 1 && scan.through - last < 60_000))
    const waitingForCapacity = complete && needsRun && pending >= this.options.pendingLimit
    const pressured =
      waitingForCapacity || (!complete && pending >= this.options.pendingLimit && rule.misfire === 'all')
    if (pressured !== scan.pressured)
      this.audit(null, 'calendar.backlog', { definitionId: definition.id, pending, pressured })
    scan = { ...scan, pressured }
    if (complete && !waitingForCapacity) {
      if (needsRun)
        this.trigger(definition, brandString<TaskRequestId>(`calendar:${definition.revision}:${last}`), {
          scheduledAt: last,
          missedCount: scan.count,
          missedFrom: scan.from,
          missedThrough: last,
        }, {
          scheduledAt: last,
          missed: scan.count > 1 ? { from: scan.from, through: last, count: scan.count } : null,
        })
      this.db.putCalendarScan(definition.id, null)
    } else this.db.putCalendarScan(definition.id, scan)
    // Completed coalescing retains the final occurrence cursor until capacity permits its single run.
    this.db.putDefinition({ ...definition, nextDueAt: waitingForCapacity ? scan.last : due })
    if (scanned > 0)
      this.audit(null, 'calendar.scanned', {
        definitionId: definition.id,
        count: scan.count,
        from: scan.from,
        through: scan.last,
        nextDueAt: due,
        policy: rule.misfire,
        complete: complete && !waitingForCapacity,
        pending,
      })
  }
  private trigger(
    definition: TaskDefinitionView, requestId: TaskRequestId, input: JsonValue, occurrence: TaskOccurrence | null = null,
  ): TaskRun {
    const previous = this.db.receipt(`trigger:${definition.id}`, requestId, input)
    if (previous !== undefined) return this.requireRun(brandString<TaskRunId>(z.string().parse(previous)))
    if (!definition.enabled || !definition.installed || this.removing.has(definition.id))
      throw new TaskCommandError('invalid_state', 'task definition is disabled or uninstalled')
    const plugin = this.plugin(definition.id)
    if (plugin.forms !== undefined) validateForm(plugin.forms.input, input)
    const value = json(plugin.parseInput(input))
    const run = this.reserve(definition, value, undefined, undefined, occurrence)
    this.db.putReceipt(`trigger:${definition.id}`, requestId, input, run.id)
    return run
  }
  private reserve(
    definition: TaskDefinitionView, input: JsonValue, parent?: TaskRun, key?: string, occurrence: TaskOccurrence | null = null,
  ): TaskRun {
    const now = this.options.clock()
    const forms = parent === undefined ? definition.forms : parent.forms
    const run: TaskRun = {
      id: brandString<TaskRunId>(randomUUID()),
      sessionId: brandString<SessionId>(`task-${randomUUID()}`),
      definitionId: definition.id,
      kind: parent === undefined ? definition.config.schedule.kind : 'ordinary',
      parentRunId: parent?.id ?? null,
      businessKey: key ?? null,
      configRevision: parent?.configRevision ?? definition.revision,
      codeVersion: parent?.codeVersion ?? definition.codeVersion,
      config: parent?.config ?? definition.config,
      ...(forms === undefined ? {} : { forms }),
      input,
      checkpoint: null,
      revision: 0,
      inputRevision: 0,
      status: 'provisioning',
      wait: null,
      retryAt: null,
      result: null,
      reason: null,
      outcome: null,
      occurrence,
      createdAt: now,
      updatedAt: now,
      terminalAt: null,
      cleanup: 'pending',
      resources: [...new Set(this.plugin(definition.id).resources(input))].sort(),
    }
    this.db.putRun(run)
    this.audit(run.id, 'run.reserved', {
      sessionId: run.sessionId,
      definitionId: definition.id,
      kind: run.kind,
    })
    return run
  }
  private async execute(id: TaskRunId, signal: AbortSignal): Promise<void> {
    let run = this.requireRun(id)
    try {
      if (run.status === 'cancelling') {
        const terminal = this.recordedSettlement(id, run.reason)
        await this.finish(run, terminal.status, terminal.result, terminal.reason)
        return
      }
      const plugin = this.plugin(run.definitionId)
      if (plugin.codeVersion !== run.codeVersion) throw new Error('task code revision is unavailable')
      plugin.parseCheckpoint(run.checkpoint)
      await this.sessions.ensure(run, signal)
      signal.throwIfAborted()
      run = this.db.transaction(() =>
        this.change(this.requireRun(id), { status: 'running' }, 'stage.started'),
      )
      await this.sessions.flush(run)
      const inputs = deepFreeze(this.db.inputs(id))
      let active = true
      const pending = new Set<Promise<unknown>>()
      const operations = new Map<string, Promise<JsonValue>>()
      const assertActive = (): void => {
        signal.throwIfAborted()
        if (!active) throw new Error('task stage capability has expired')
      }
      const tracked = <T>(operation: () => Promise<T>): Promise<T> => {
        assertActive()
        const promise = operation()
        pending.add(promise)
        void promise
          .finally(() => pending.delete(promise))
          .catch(() => {
            /* The plugin owns the returned operation result. */
          })
        return promise
      }
      const resources = new TaskResources(this.db, { ...plugin.resourceHandlers, ...this.options.resourceHandlers },
        (event, details) =>{  this.audit(id, event, details) })
      const resourceCalls = new Map<string, { type: string; request: string; result: Promise<JsonValue> }>()
      const stage: TaskStage = {
        run: deepFreeze(run),
        inputs,
        signal,
        children: deepFreeze(this.db.childrenForRun(id).map(({ sessionId, modelKey, state }) => ({ sessionId, modelKey, state }))),
        resource: (key, type, request) => tracked(() => {
          const previous = resourceCalls.get(key)
          const fingerprint = JSON.stringify(request)
          if (previous !== undefined) {
            if (previous.type !== type || previous.request !== fingerprint) throw new Error('Task resource identity conflict')
            return previous.result
          }
          const result = resources.acquire(id, key, type, request, signal)
          resourceCalls.set(key, { type, request: fingerprint, result })
          return result
        }),
        model: (key, prompt) => tracked(() => this.sessions.model(run, key, prompt, signal)),
        dispatch: (request, input) => tracked(() => this.dispatch(id, request, input)),
        operation: (key, execute, reconcile) =>
          tracked(() => {
            if (key.trim() === '' || key.startsWith('@'))
              throw new Error('task operation key is empty or reserved')
            const existing = operations.get(key)
            if (existing !== undefined) return existing
            const operation = Promise.resolve().then(async () => {
              signal.throwIfAborted()
              const stored = this.db.operation(id, key)
              if (stored?.state === 'confirmed') {
                this.audit(id, 'operation.reused', { key })
                return stored.value
              }
              this.db.putOperation(id, key, 'prepared', null)
              this.audit(id, stored === undefined ? 'operation.prepared' : 'operation.reconciling', { key })
              const value = json(await (stored === undefined ? execute(signal) : reconcile(signal)))
              this.db.putOperation(id, key, 'confirmed', value)
              this.audit(id, 'operation.confirmed', { key })
              return value
            })
            operations.set(key, operation)
            return operation
          }),
      }
      let decision: TaskStageResult
      const handler =
        run.kind === 'ordinary' ? plugin.runOrdinary?.bind(plugin) : plugin.runSpecial.bind(plugin)
      if (handler === undefined) throw new Error('ordinary task handler is unavailable')
      try {
        decision = await handler.call(plugin, stage)
      } finally {
        active = false
        await Promise.allSettled([...pending])
      }
      signal.throwIfAborted()
      const latest = this.requireRun(id)
      if (latest.inputRevision !== run.inputRevision) {
        this.db.transaction(() =>
          this.change(latest, { status: 'queued', wait: null }, 'stage.input-changed'),
        )
        return
      }
      if (decision.kind === 'succeed' || decision.kind === 'fail') {
        await this.finish(
          latest,
          decision.kind === 'succeed' ? 'succeeded' : 'failed',
          decision.kind === 'succeed' ? json(decision.result) : null,
          decision.kind === 'fail' ? decision.reason : null,
        )
      } else this.commitDecision(latest, decision)
      await this.sessions.flush(this.requireRun(id))
    } catch (error: unknown) {
      run = this.requireRun(id)
      if (this.stopping) return
      if (run.status === 'cancelling' || signal.aborted) {
        await this.finish(run, 'cancelled', null, 'cancelled')
        return
      }
      if (run.terminalAt !== null || run.cleanup === 'blocked') return
      let decision: Extract<TaskStageResult, { kind: 'retry' | 'block' | 'fail' }>
      try {
        decision = error instanceof TaskChildRecoveryError
          ? { kind: 'block', checkpoint: run.checkpoint, reason: error.message }
          : this.plugin(run.definitionId).classifyError(error, run)
      } catch {
        decision = {
          kind: 'block',
          checkpoint: run.checkpoint,
          reason: 'plugin error classifier failed; inspect task diagnostics',
        }
      }
      if (decision.kind === 'fail') await this.finish(run, 'failed', null, decision.reason)
      else this.commitDecision(run, decision, false)
      this.audit(id, 'stage.error', {
        category: decision.kind,
        error: error instanceof Error ? error.name : 'unknown',
      })
    }
  }
  private commitDecision(
    run: TaskRun,
    decision: Exclude<TaskStageResult, { kind: 'succeed' | 'fail' }>,
    consume = true,
  ): void {
    const checkpoint = json(this.plugin(run.definitionId).parseCheckpoint(decision.checkpoint))
    this.db.transaction(() => {
      if (consume) this.db.consume(run.id, run.inputRevision)
      const common = { checkpoint, wait: null, retryAt: null, reason: null }
      switch (decision.kind) {
        case 'advance':
          this.change(run, { ...common, status: 'queued' }, 'stage.advanced')
          break
        case 'wait':
          if (decision.schema !== undefined) validateFormSchema(decision.schema)
          this.change(
            run,
            {
              ...common,
              status: 'waiting_input',
              wait: {
                id: brandString<TaskWaitId>(randomUUID()),
                revision: run.inputRevision,
                prompt: json(decision.prompt),
                ...(decision.schema === undefined ? {} : { schema: decision.schema }),
                ...(decision.expiresAt === undefined ? {} : { expiresAt: decision.expiresAt }),
                createdAt: this.options.clock(),
              },
            },
            'stage.waiting',
          )
          break
        case 'retry':
          if (!Number.isFinite(decision.at) || decision.at <= this.options.clock())
            throw new Error('retry must name a future timestamp')
          this.change(
            run,
            { ...common, status: 'waiting_retry', retryAt: decision.at, reason: decision.reason },
            'stage.retry',
          )
          break
        case 'block':
          this.change(run, { ...common, status: 'blocked', reason: decision.reason }, 'stage.blocked')
          break
        /* v8 ignore next -- TaskStageResult is a closed plugin return union. */
        default:
          assertNever(decision, 'task stage decision')
      }
    })
  }
  private finish(
    run: TaskRun,
    status: TerminalStatus,
    result: JsonValue,
    reason: string | null,
  ): Promise<void> {
    const existing = this.finishing.get(run.id)
    /* v8 ignore next -- one worker owns a run; cancellation awaits that worker, and repeat cancellation shares its Promise. */
    if (existing !== undefined) return existing
    this.db.transaction(() => {
      this.db.consume(run.id, run.inputRevision)
      this.db.putOperation(run.id, '@terminal', 'confirmed', { status, result, reason })
      this.change(
        this.requireRun(run.id),
        { status: 'cancelling', result, reason, wait: null, outcome: status },
        'cleanup.started',
      )
    })
    const pending = Promise.resolve()
      .then(() => this.doFinish(run, status, result, reason))
      .finally(() => this.finishing.delete(run.id))
    this.finishing.set(run.id, pending)
    return pending
  }
  /** Read the terminal decision recorded when settlement began; a run without one settles as cancelled.
   * @param id - execution.
   * @param reason - cancellation reason used when no decision was recorded.
   * @returns status, result and reason to commit after cleanup.
   */
  private recordedSettlement(id: TaskRunId, reason: string | null): { status: TerminalStatus; result: JsonValue; reason: string | null } {
    const intent = this.db.operation(id, '@terminal')
    return intent === undefined
      ? { status: 'cancelled', result: null, reason }
      : z.object({ status: z.enum(['succeeded', 'failed', 'cancelled']), result: z.json(), reason: z.string().nullable() })
        .parse(intent.value)
  }
  private async doFinish(
    run: TaskRun,
    status: TerminalStatus,
    result: JsonValue,
    reason: string | null,
  ): Promise<void> {
    try {
      await this.withDeadline(run.id, 'cleanup.timeout', this.options.cleanupTimeoutMs, async (signal) => {
        await this.sessions.close(run.id)
        const plugin = this.plugin(run.definitionId)
        await plugin.cleanup(this.requireRun(run.id), signal)
        await new TaskResources(this.db, { ...plugin.resourceHandlers, ...this.options.resourceHandlers },
          (event, details) =>{  this.audit(run.id, event, details) }).cleanup(run.id, signal)
        signal.throwIfAborted()
      })
    } catch (error) {
      this.db.transaction(() =>
        this.change(
          this.requireRun(run.id),
          {
            status: 'blocked',
            cleanup: 'blocked',
            reason: 'resource cleanup failed; retry cleanup after repair',
          },
          'cleanup.blocked',
        ),
      )
      throw error
    }
    this.db.transaction(() => {
      this.db.release(run.id)
      this.change(
        this.requireRun(run.id),
        { status, cleanup: 'complete', terminalAt: this.options.clock(), result, reason },
        'run.ended',
      )
      const definition = this.requireDefinition(run.definitionId)
      if (run.kind === 'polling' && definition.config.schedule.kind === 'polling')
        this.db.putDefinition({
          ...definition,
          nextDueAt: this.options.clock() + definition.config.schedule.intervalMs,
        })
    })
    await this.sessions.flush(this.requireRun(run.id))
  }
  private addInput(run: TaskRun, id: TaskRequestId, value: JsonValue, kind: TaskInput['kind']): void {
    const revision = run.inputRevision + 1
    this.db.putInput(run.id, { id, revision, kind, value })
    this.change(
      run,
      {
        inputRevision: revision,
        wait: null,
        retryAt: null,
        status: run.status === 'running' ? 'running' : 'queued',
      },
      `input.${kind}`,
    )
  }
  private blockAdmission(run: TaskRun, error: unknown): void {
    this.db.transaction(() => {
      this.change(
        run,
        { status: 'blocked', reason: 'task admission failed; repair the plugin and supply input to resume' },
        'admission.blocked',
      )
      this.audit(run.id, 'admission.error', { error: error instanceof Error ? error.name : 'unknown' })
    })
  }
  private change(run: TaskRun, patch: Partial<TaskRun>, event: string): TaskRun {
    const next = { ...run, ...patch, revision: run.revision + 1, updatedAt: this.options.clock() }
    this.db.putRun(next)
    this.audit(run.id, event, { from: run.status, to: next.status, revision: next.revision })
    return next
  }
  /** Read current execution permits and durable operating counters.
   * @returns operating state without storage-provider observations.
   */
  diagnostics(): Omit<import('@deepseek-ai/dsh-task').TaskDiagnostics, 'storage'> {
    return { ...this.db.diagnostics(this.options.resourceCapacities ?? {}), scheduler: this.stopping ? 'stopping' as const : 'running' as const,
      concurrency: this.options.concurrency, activePermits: this.workers.size }
  }
  private audit(id: TaskRunId | null, event: string, details: JsonValue): void {
    this.db.log(id, event, this.options.clock(), details)
    this.db.afterCommit(() => {
      try {
        const run = id === null ? undefined : this.db.run(id)
        this.options.log(event, { runId: id, definitionId: run?.definitionId ?? null, sessionId: run?.sessionId ?? null, details })
      } catch {
        /* Durable journal records survive a failing diagnostic sink. */
      }
    })
  }
  private definition(id: TaskDefinitionId): TaskDefinitionView | undefined {
    return this.db.definitions().find(value => value.id === id)
  }
  private requireDefinition(id: TaskDefinitionId): TaskDefinitionView {
    const definition = this.definition(id)
    if (definition === undefined) throw new TaskCommandError('not_found', 'unknown task definition')
    return definition
  }
  private requireRun(id: TaskRunId): TaskRun {
    const run = this.db.run(id)
    if (run === undefined) throw new TaskCommandError('not_found', 'unknown task run')
    return run
  }
  private plugin(id: TaskDefinitionId): TaskDefinition {
    const plugin = this.definitions.get(id)
    if (plugin === undefined) throw new Error(`task plugin ${id} is not installed`)
    return plugin
  }
  private assertOpen(): void {
    if (this.stopping) throw new TaskCommandError('unavailable', 'task host is stopping')
  }
}

/** Snapshot JSON before asynchronous or durable handoff. */
function json(value: unknown): JsonValue {
  const result = snapshotJsonValue(value)
  if (result === undefined) throw new Error('task data must be losslessly JSON serializable')
  return result as JsonValue
}

const commandResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('retirement'), retirement: retirementRecordSchema }),
  z.object({ kind: z.literal('definition'), definition: definitionSchema }),
  z.object({ kind: z.literal('run'), run: runSchema }),
  z.object({
    kind: z.literal('cancellation'),
    runId: z.string().transform(value => brandString<TaskRunId>(value)),
    status: z.literal('cancelling'),
  }),
])
