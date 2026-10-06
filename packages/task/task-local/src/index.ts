/** Local TaskService provider, with durable scheduling and owned Agent Sessions. */
import { Context, FiberState, Service, type Fiber } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { statfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {} from '@deepseek-ai/dsh-cmdline'
import TaskService, {
  type TaskNotificationProvider,
  type TaskCommand,
  type TaskCommandResult,
  type TaskPrincipalId,
  type TaskConfig,
  type TaskDefinition,
  type TaskDefinitionId,
  type TaskDefinitionView,
  type TaskDispatchReceipt,
  type TaskJournalCursor,
  type TaskJournalEntry,
  type TaskRequestId,
  type TaskRunQuery,
  type TaskRun,
  type TaskRunId,
  type TaskWaitId,
} from '@deepseek-ai/dsh-task'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-tools'
import { installTaskAnswerers } from './answerers.ts'
import { TaskDatabase } from './database.ts'
import { TaskEngine } from './engine.ts'
import { TaskPluginCode } from './plugin-code.ts'
import { TaskScheduler } from './scheduler.ts'
import { OwnedTaskFiles } from './owned-files.ts'
import type {} from '@deepseek-ai/dsh-subprocess'
import { TaskNotifications } from './notifications.ts'
export type { TaskNotificationProvider } from './notifications.ts'
import { AgentTaskSessions } from './sessions.ts'
import { TaskSessionAccess } from './access.ts'
import { taskSessionStore } from '@deepseek-ai/dsh-task-session'
import { taskAgentRegistry } from '@deepseek-ai/dsh-task-agent'

/** Local daemon deployment choices. */
export interface Config {
  /** Minimum available disk fraction before diagnostics report pressure. */
  readonly diskFreeRatio: number
  /** SQLite database file owned by one host. */
  readonly path: string
  /** Private root for owned temporary directories and preserved worktrees. */
  readonly resourceRoot: string
  /** Grace for built-in resource subprocess termination. */
  readonly resourceProcessGraceMs: number
  /** Maximum collected bytes per built-in resource subprocess stream. */
  readonly resourceOutputLimitBytes: number
  /** Maximum simultaneously admitted stages across all plugins. */
  readonly concurrency: number
  /** Maximum live foreground child Agents per Task Run. */
  readonly childConcurrency: number
  /** Capacity of named resources; keys without an override remain exclusive. */
  readonly resourceCapacities: Record<string, number>
  /** Scheduler wake interval in milliseconds. */
  readonly tickMs: number
  /** Maximum calendar occurrences scanned per definition per tick. */
  readonly catchupLimit: number
  /** Calendar catch-up horizon in milliseconds; older occurrences are recorded as skipped. */
  readonly catchupHorizonMs: number
  /** Maximum unfinished scheduled runs per definition. */
  readonly pendingLimit: number
  /** Waiting interval that adds one scheduling priority point. */
  readonly priorityAgingIntervalMs: number
  /** Maximum priority points contributed by waiting. */
  readonly priorityAgingCap: number
  /** Notification journal records delivered per scheduler wake. */
  readonly notificationBatchSize: number
  /** Cancellation grace before recording an overdue drain. */
  readonly cancellationGraceMs: number
  /** Cleanup deadline; locks remain held until successful cleanup. */
  readonly cleanupTimeoutMs: number
  /** Shutdown deadline before recording an overdue host drain. */
  readonly shutdownTimeoutMs: number
}

/** A single provider owns the task database, scheduler and all task Agents. */
export class LocalTaskService extends TaskService {
  static inject = [
    'subprocess',
    'agents',
    'sessions',
    'sessionPersistence',
    'agentPresets',
    'agentDefaultModel',
    'permissionPresets',
    'workspaceRegistry',
    'tools',
  ]
  static Config: Schema<Config> = Schema.object({
    diskFreeRatio: Schema.number().min(0).max(1).default(0.1),
    notificationBatchSize: Schema.number().min(1).step(1).default(100),
    cancellationGraceMs: Schema.number().min(1).step(1).default(30000),
    cleanupTimeoutMs: Schema.number().min(1).step(1).default(120000),
    shutdownTimeoutMs: Schema.number().min(1).step(1).default(120000),
    path: Schema.string().required(),
    resourceRoot: Schema.string().required(),
    resourceOutputLimitBytes: Schema.number().min(1).step(1).default(65536),
    resourceProcessGraceMs: Schema.number().min(1).step(1).default(5000),
    concurrency: Schema.number().min(1).step(1).default(4),
    childConcurrency: Schema.number().min(1).step(1).default(4),
    resourceCapacities: Schema.dict(Schema.number().min(1).step(1)).default({}),
    catchupHorizonMs: Schema.number().min(1).default(2592000000),
    priorityAgingIntervalMs: Schema.number().min(1).step(1).default(60000),
    priorityAgingCap: Schema.number().min(0).step(1).default(100),
    pendingLimit: Schema.number().min(1).step(1).default(100),
    tickMs: Schema.number().min(1).step(1).default(1000),
    catchupLimit: Schema.number().min(1).step(1).default(10000),
  })
  private readonly notifications = new Map<string, TaskNotifications>()
  private readonly database: TaskDatabase
  private readonly engine: TaskEngine
  private readonly pluginCode: TaskPluginCode
  private readonly scheduler: TaskScheduler
  private readonly taskSessions: AgentTaskSessions
  private readonly deployment: Config
  private readonly registrationOwners = new Set<Fiber>()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.deployment = config
    this.database = new TaskDatabase(config.path)
    const interruptedChildren = this.database.interruptChildren()
    if (interruptedChildren !== 0) ctx.logger.warn(`task.child.interrupted ${interruptedChildren}`)
    this.notifications.set('log', new TaskNotifications(this.database, {
      deliver: (store, entry) => {
        ctx.logger.info(`task.notification ${JSON.stringify({ store, ...entry })}`)
        return Promise.resolve()
      },
    }, config.notificationBatchSize))
    const access = new TaskSessionAccess()
    taskSessionStore(ctx).guardMutations(
      id => this.forSession(id) !== undefined || this.database.child(id) !== undefined,
      (id) => {
        const child = this.database.child(id)
        if (child === undefined) { access.assert(id); return }
        const owner = this.database.run(child.runId)
        const model = access.modelOwner()
        if (child.state === 'complete' || owner === undefined ||
          !(owner.status === 'cancelling' && access.isCancelling(owner.sessionId)) &&
          (owner.status !== 'running' || model?.owner !== owner.sessionId || model.modelKey !== child.modelKey))
          throw new Error('task child Session is not admitted by its owning model operation')
      },
    )
    taskAgentRegistry(ctx).guardCreation((initiator, parent, childId, operation) => {
      const parentRun = parent === undefined ? undefined : this.forSession(parent.id)
      const initiatorRun = initiator === undefined ? undefined : this.forSession(initiator.id)
      const parentChild = parent === undefined ? undefined : this.database.child(parent.id)
      const initiatorChild = initiator === undefined ? undefined : this.database.child(initiator.id)
      if (parentRun !== undefined && parentRun.id === initiatorRun?.id) {
        const model = access.modelOwner()
        if (model?.owner !== parentRun.sessionId || parentRun.status !== 'running')
          throw new Error('task child Agents require an admitted model operation')
        if (operation === 'create') {
          if (this.database.activeChildCount(parentRun.id) >= config.childConcurrency)
            throw new Error('task child Agent concurrency limit reached')
          this.database.transaction(() => {
            this.database.reserveChild({ sessionId: childId, runId: parentRun.id, modelKey: model.modelKey, state: 'prepared' })
            this.database.log(parentRun.id, 'child.reserved', Date.now(), { sessionId: childId, modelKey: model.modelKey })
          })
        } else if (operation === 'enter') {
          if (this.database.child(childId)?.runId !== parentRun.id)
            throw new Error('task child Agent has no durable owner')
        } else throw new Error('task child Agents cannot resume outside their foreground operation')
        return
      }
      if (parentRun !== undefined || initiatorRun !== undefined || parentChild !== undefined || initiatorChild !== undefined)
        throw new Error('task Agents must dispatch ordinary work through the task service')
    }, (childId) => {
      const child = this.database.child(childId)
      if (child?.state === 'prepared') this.database.transaction(() => {
        this.database.setChildState(childId, 'complete')
        this.database.log(child.runId, 'child.creation-failed', Date.now(), { sessionId: childId })
      })
    })
    ctx.on('agent/created', ({ agent }) => {
      const child = this.database.child(agent.id)
      if (child?.state === 'prepared') this.database.transaction(() => {
        this.database.setChildState(agent.id, 'active')
        this.database.log(child.runId, 'child.started', Date.now(), { sessionId: agent.id })
      })
    })
    ctx.on('agent/disposed', ({ agent }) => {
      const child = this.database.child(agent.id)
      if (child !== undefined && child.state !== 'complete') this.database.transaction(() => {
        this.database.setChildState(agent.id, 'complete')
        this.database.log(child.runId, 'child.ended', Date.now(), { sessionId: agent.id })
      })
    })
    const sessions = new AgentTaskSessions(ctx, this.database, access)
    this.taskSessions = sessions
    this.engine = new TaskEngine(this.database, sessions, {
      resourceHandlers: new OwnedTaskFiles(config.resourceRoot, ctx.subprocess,
        config.resourceProcessGraceMs, config.resourceOutputLimitBytes).handlers(),
      concurrency: config.concurrency,
      resourceCapacities: config.resourceCapacities,
      cancellationGraceMs: config.cancellationGraceMs,
      cleanupTimeoutMs: config.cleanupTimeoutMs,
      shutdownTimeoutMs: config.shutdownTimeoutMs,
      catchupLimit: config.catchupLimit,
      catchupHorizonMs: config.catchupHorizonMs,
      pendingLimit: config.pendingLimit,
      priorityAgingIntervalMs: config.priorityAgingIntervalMs,
      priorityAgingCap: config.priorityAgingCap,
      clock: Date.now,
      log: (event, details) => {
        ctx.logger.info(`task.${event} ${JSON.stringify(details)}`)
      },
    })
    this.pluginCode = new TaskPluginCode(ctx, this.database, this.engine)
    this.scheduler = new TaskScheduler(config.tickMs, async () => {
      await this.pluginCode.recover()
      this.engine.recoverRetirements()
    }, () => {
      this.engine.tick()
      void this.pluginCode.flush().catch(() => {
        ctx.logger.error('task.retirement.dispose-failed; plugin release remains pending')
      })
      void Promise.all([...this.notifications.values()].map(provider => provider.flush())).catch(() => {
        ctx.logger.error('task.notification.failed; delivery remains pending')
      })
    }, (event) => { ctx.logger.error(`task.scheduler.${event}-failed`) })
    installTaskAnswerers(ctx, this, this.engine.interactions)
    ctx.on('agent/pre-step', async ({ agent }, next) => {
      const child = this.database.child(agent.id)
      const run = child === undefined ? this.forSession(agent.id) : this.database.run(child.runId)
      if (run !== undefined && run.status !== 'running') return { kind: 'reject' }
      return next()
    })
    ctx.tools.guard(({ agent }) => {
      const child = agent === undefined ? undefined : this.database.child(agent.id)
      const run = agent === undefined ? undefined : child === undefined ? this.forSession(agent.id) : this.database.run(child.runId)
      return run !== undefined && run.status !== 'running' ? 'Task execution is not admitted' : undefined
    })
    ctx.on('internal/status', (fiber) => {
      if (fiber === ctx.root.fiber && fiber.state === FiberState.UNLOADING) {
        void this.scheduler.close()
        void this.engine.shutdown().catch((error: unknown) => {
          ctx.logger.error(`task.shutdown.failed ${String(error)}`)
        })
      }
    })
    ctx.effect(
      () => async () => {
        await this.scheduler.close()
        await this.engine.shutdown()
        await this.pluginCode.flush()
        await Promise.all([...this.notifications.values()].map(provider => provider.close()))
        this.database.close()
      },
      'task-local.host',
    )
  }
  protected async [Service.init](): Promise<void> {
    await this.taskSessions.recover()
    this.ctx.effect(() => {
      const start = () => { void this.scheduler.start() }
      const ready = this.ctx.get('appReady')
      const cancel = ready === undefined ? (start(), () => {}) : ready.onReady(start)
      return async () => {
        cancel()
        await this.scheduler.close()
      }
    }, 'task-local.scheduler')
  }
  /** Register one definition on the contributing plugin fiber.
   * @param ownerContext - exact context of the contributing plugin.
   * @param definition - executable business definition.
   * @returns idempotent asynchronous removal.
   */
  override register(ownerContext: Context, definition: TaskDefinition): () => Promise<void> {
    let removal: Promise<void> | undefined
    const owner = ownerContext.fiber
    const dispose = ownerContext.effect(() => {
      if (this.registrationOwners.has(owner))
        throw new Error('each business plugin may register exactly one special task')
      this.database.transaction(() => {
        this.pluginCode.capture(ownerContext, definition.id)
        this.engine.register(definition)
      })
      this.registrationOwners.add(owner)
      return () => {
        removal ??= this.engine.remove(definition.id).then(() => {
          this.registrationOwners.delete(owner)
        })
        return removal
      }
    }, `task.register(${definition.id})`)
    return async () => {
      await dispose()
      await removal
    }
  }
  override registerNotificationProvider(owner: Context, id: string, provider: TaskNotificationProvider): () => Promise<void> {
    const dispose = owner.effect(() => {
      if (this.notifications.has(id) || !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new Error('Task notification provider identity is invalid or already registered')
      const delivery = new TaskNotifications(this.database, provider, this.deployment.notificationBatchSize, id)
      this.notifications.set(id, delivery)
      return async () => { this.notifications.delete(id); await delivery.close() }
    })
    return async () => { await dispose() }
  }
  override async diagnostics() {
    let storage = null
    try {
      const value = await statfs(dirname(this.deployment.path))
      storage = { availableBytes: value.bavail * value.bsize, totalBytes: value.blocks * value.bsize,
        pressure: value.blocks === 0 || value.bavail / value.blocks < this.deployment.diskFreeRatio }
    } catch { /* Disk statistics may be unavailable; absence stays explicit in diagnostics. */ }
    return { ...this.engine.diagnostics(), scheduler: this.scheduler.state, storage }
  }
  override getRetirement(id: TaskDefinitionId) { return this.database.retirement(id) }
  override listDefinitions(): readonly TaskDefinitionView[] {
    return this.database.definitions()
  }
  override interactions(id: TaskRunId) {
    return this.database.interactions(id).filter(value => value.state === 'waiting')
  }
  override inputs(id: TaskRunId) {
    return this.database.inputHistory(id)
  }
  override waitingInteractions() {
    return this.database.waitingInteractions()
  }
  override checkConfig(id: TaskDefinitionId, config: TaskConfig, signal: AbortSignal) {
    return this.engine.checkConfig(id, config, signal)
  }
  override options(id: TaskDefinitionId, field: string, config: TaskConfig, signal: AbortSignal) {
    return this.engine.formOptions(id, field, config, signal)
  }
  override queryRuns(query: TaskRunQuery) { return this.database.queryRuns(query) }
  override listRuns(): readonly TaskRun[] {
    return this.database.runs()
  }
  override getRun(id: TaskRunId): TaskRun | undefined {
    return this.database.run(id)
  }
  override forSession(id: SessionId): TaskRun | undefined {
    return this.database.forSession(id)
  }
  override dispatch(
    sessionId: SessionId,
    requestId: TaskRequestId,
    input: JsonValue,
  ): Promise<TaskDispatchReceipt> {
    const run = this.forSession(sessionId)
    if (run === undefined) return Promise.reject(new Error('dispatch requires a task-owned Session'))
    return this.engine.dispatch(run.id, requestId, input)
  }
  override updateConfig(id: TaskDefinitionId, revision: number, config: TaskConfig): void {
    this.engine.updateConfig(id, revision, config)
  }
  override setEnabled(id: TaskDefinitionId, enabled: boolean): void {
    this.engine.setEnabled(id, enabled)
  }
  override triggerManual(id: TaskDefinitionId, requestId: TaskRequestId, input: JsonValue): TaskRun {
    return this.engine.triggerManual(id, requestId, input)
  }
  override respond(
    id: TaskRunId,
    waitId: TaskWaitId,
    revision: number,
    requestId: TaskRequestId,
    response: JsonValue,
  ): void {
    this.engine.respond(id, waitId, revision, requestId, response)
  }
  override sendInput(id: TaskRunId, requestId: TaskRequestId, input: JsonValue): void {
    this.engine.sendInput(id, requestId, input)
  }
  override cancel(id: TaskRunId): Promise<void> {
    return this.engine.cancel(id)
  }
  override command(
    principal: TaskPrincipalId,
    requestId: TaskRequestId,
    command: TaskCommand,
  ): TaskCommandResult {
    return this.engine.command(principal, requestId, command)
  }
  override journal(after: number): readonly TaskJournalEntry[] {
    return this.database.journal(after)
  }
  override journalHead(): TaskJournalCursor {
    return { storeId: this.database.id, sequence: this.database.journalHead() }
  }
  override journalPage(after: number, limit: number): readonly TaskJournalEntry[] {
    return this.database.journal(after, limit)
  }
  override async shutdown(): Promise<void> {
    await Promise.all([this.scheduler.close(), this.engine.shutdown()])
    await this.pluginCode.flush()
  }
}
export default LocalTaskService
