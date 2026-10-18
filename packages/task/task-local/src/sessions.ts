/** Session ownership, recorded preset revisions, and correlated model delivery. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { MessageId, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-workspace'
import type { TaskRun, TaskRunId } from '@deepseek-ai/dsh-task'
import { parseTaskPresetRevision, taskAgentPresetRegistry, type TaskPresetRevision } from '@deepseek-ai/dsh-task-agent-preset-registry'
import { wakeTaskAgent } from '@deepseek-ai/dsh-task-agent-loop'
import { z } from 'zod'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A stage instruction a Task business plugin submitted through `TaskStage.model()`. */
    'task': { kind: 'task' }
  }
}
import type { TaskSessions } from './engine.ts'
import type { TaskDatabase } from './database.ts'
import type { TaskSessionAccess } from './access.ts'

/** Agent adapter owns one root Agent per execution; a dispatching run never becomes the runtime parent of the Agents it dispatches. */
export class AgentTaskSessions implements TaskSessions {
  private readonly handles = new Map<TaskRunId, AgentHandle>()
  private readonly preparations = new Map<TaskRunId, Promise<void>>()
  private readonly flushes = new Map<TaskRunId, Promise<void>>()
  /** Child releases started by cancellation; cleanup waits for them before checking settlement. */
  private readonly drains = new Map<TaskRunId, Promise<void>>()
  private readonly revisions = new Map<string, Promise<TaskPresetRevision>>()
  private readonly modelCalls = new Map<TaskRunId, { key: string; prompt: string; promise: Promise<string> }>()

  /**
   * @param ctx - provider-owned root context.
   * @param db - task transactions/outbox, including recorded preset revisions.
   * @param access - Session authority shared with the Task providers.
   */
  constructor(
    private readonly ctx: Context, private readonly db: TaskDatabase, private readonly access: TaskSessionAccess,
  ) {}

  /** Repair committed Session events before the scheduler or business plugins start. */
  async recover(): Promise<void> {
    for (const run of this.db.pendingSessions()) await this.flush(run)
  }

  async ensure(run: TaskRun, signal: AbortSignal): Promise<void> {
    if (this.handles.has(run.id)) return
    let pending = this.preparations.get(run.id)
    if (pending === undefined) {
      pending = this.access.run(run.sessionId, () => this.prepare(run, signal)).finally(() => this.preparations.delete(run.id))
      this.preparations.set(run.id, pending)
    }
    await pending
  }
  private async prepare(run: TaskRun, signal: AbortSignal): Promise<void> {
    const revision = await this.revision(run)
    const owner = this.revisionOwner(run)
    const recordedModel = this.db.operation(owner.id, '@model-selection')
    const agentOptions = recordedModel === undefined
      ? run.config.model ?? this.ctx.agentDefaultModel.currentSelection()
      : z.object({ provider: z.string(), model: z.string() }).parse(recordedModel.value)
    if (recordedModel === undefined) this.db.putOperation(owner.id, '@model-selection', 'confirmed', { provider: agentOptions.provider, model: agentOptions.model })
    signal.throwIfAborted()
    await this.flush(run)
    const reader = await this.ctx.sessionPersistence.open(run.sessionId, 'read')
    try {
      const { events } = await reader.read()
      assertBinding(this.db, Session.create(run.sessionId, events, reader.header), run)
    } finally { await reader.close() }
    const setup = async (agentCtx: Context): Promise<void> => {
      await taskAgentPresetRegistry(this.ctx).mountRevision(agentCtx, revision)
    }
    const handle = await this.ctx.agents.resume({ resumeSessionId: run.sessionId, signal, agentOptions, setup })
    this.handles.set(run.id, handle)
    try {
      signal.throwIfAborted()
      if (this.db.operation(run.id, '@setup') === undefined) {
        this.ctx.permissionPresets.set(handle.agent.session, run.config.permissionPreset)
        await this.ctx.sessions.flush(handle.agent.session)
        this.db.putOperation(run.id, '@setup', 'confirmed', null)
      }
      const workspace = await this.ctx.workspaceRegistry.create(run.config.workspacePath)
      await workspace.attachSession(run.sessionId)
      await this.flush(run)
    } catch (error) { await this.access.run(handle.agent.id, () => handle.dispose()); this.handles.delete(run.id); throw error }
  }
  private revision(run: TaskRun): Promise<TaskPresetRevision> {
    const key = `${run.definitionId}:${run.configRevision}:${run.codeVersion}`
    let pending = this.revisions.get(key)
    if (pending === undefined) {
      pending = this.captureRevision(run, key)
      this.revisions.set(key, pending)
      void pending.catch(() => this.revisions.delete(key))
    }
    return pending
  }
  private async captureRevision(run: TaskRun, key: string): Promise<TaskPresetRevision> {
    const receiptKey = `@preset:${key}`
    // All children inherit the source revision even if its runtime Agent has been disposed.
    const owner = this.revisionOwner(run)
    const receipt = this.db.operation(owner.id, receiptKey)
    if (receipt !== undefined) return parseTaskPresetRevision(receipt.value)
    const revision = await taskAgentPresetRegistry(this.ctx).captureRevision(run.config.preset)
    this.db.putOperation(owner.id, receiptKey, 'confirmed', { ...revision })
    return revision
  }
  private revisionOwner(run: TaskRun): TaskRun {
    return this.db.revisionOwner(run)
  }
  async flush(run: TaskRun): Promise<void> {
    const previous = this.flushes.get(run.id) ?? Promise.resolve()
    const pending = previous.then(() => this.access.run(run.sessionId, () => this.flushOutbox(run)))
    this.flushes.set(run.id, pending)
    try { await pending }
    finally { if (this.flushes.get(run.id) === pending) this.flushes.delete(run.id) }
  }
  private async flushOutbox(run: TaskRun): Promise<void> {
    const entries = this.db.outbox(run.id)
    if (entries.length === 0) return
    const live = this.handles.get(run.id)
    if (live !== undefined) {
      assertBinding(this.db, live.agent.session, run)
      await this.ctx.sessions.flush(live.agent.session)
    } else {
      const existing = await this.ctx.sessionPersistence.stat(run.sessionId)
      const handle = existing === undefined
        ? await this.ctx.sessionPersistence.create({
          id: run.sessionId, version: SESSION_FORMAT_VERSION, createdAt: run.createdAt, isSeeded: false,
          cwd: run.config.workspacePath, agentPreset: run.config.preset })
        : await this.ctx.sessionPersistence.open(run.sessionId, 'write')
      try {
        const { events } = await handle.read()
        const session = Session.create(run.sessionId, events, handle.header)
        assertBinding(this.db, session, run)
        await handle.flush()
      } finally { await handle.close() }
    }
    for (const entry of entries) this.db.acknowledge(entry.id)
  }
  model(run: TaskRun, key: string, prompt: string, signal: AbortSignal): Promise<string> {
    if (key.trim() === '' || key.startsWith('@')) return Promise.reject(new Error('task model operation key is empty or reserved'))
    const current = this.modelCalls.get(run.id)
    if (current !== undefined) {
      if (current.key === key && current.prompt === prompt) return current.promise
      return Promise.reject(new Error('a task Session permits one model operation at a time'))
    }
    const promise = this.access.model(run.sessionId, key, () => this.runModel(run, key, prompt, signal))
      .finally(() => this.modelCalls.delete(run.id))
    this.modelCalls.set(run.id, { key, prompt, promise })
    return promise
  }
  private async runModel(run: TaskRun, key: string, prompt: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const handle = this.handles.get(run.id)
    if (handle === undefined) throw new Error('task Session is not admitted')
    const operationKey = `@model:${key}`
    const prior = this.db.operation(run.id, operationKey)
    if (prior !== undefined) {
      const record = z.object({ prompt: z.string(), answer: z.string().optional() }).parse(prior.value)
      if (record.prompt !== prompt) throw new Error('task model operation key was reused with a different prompt')
      if (prior.state === 'confirmed') return z.string().parse(record.answer)
      if (this.db.children(run.id, key).length !== 0)
        throw new TaskChildRecoveryError('task child Agent outcome is uncertain; reconcile its Session before starting another model turn')
    }
    const id = MessageId(`task:${run.id}:${key}`)
    const message: UserMessage = { ...createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'task' } }), id }
    const events = await this.persistedEvents(run.sessionId)
    const inserted = events.some(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(input => input.id === id))
    const consumed = events.some(event => event.type === 'user/message' && event.data.id === id)
    if (!inserted && !consumed) {
      handle.agent.send(message, 'next-turn', false)
      await this.ctx.sessions.flush(handle.agent.session)
    }
    this.db.putOperation(run.id, operationKey, 'prepared', { messageId: id, prompt })
    const abort = (): void => { this.abort(run.id) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted()
      if (!consumed) wakeTaskAgent(handle.agent)
      await this.settle(handle.agent, signal)
      if (this.db.activeChildCount(run.id) !== 0)
        throw new TaskChildRecoveryError('task child Agent did not settle before the parent model turn')
      await this.ctx.sessions.flush(handle.agent.session)
      const answer = modelAnswer(await this.persistedEvents(run.sessionId), id)
      this.db.putOperation(run.id, operationKey, 'confirmed', { prompt, answer })
      return answer
    } finally { signal.removeEventListener('abort', abort) }
  }
  /** Wait until the parent is idle, joins no progressing child, and has appended nothing since that idle observation.
   * A settled child's notice wakes another parent turn inside the same model operation; the wait ends after the last turn.
   * @param agent - parent Agent of the admitted model operation.
   * @param signal - stage cancellation.
   */
  private async settle(agent: Agent, signal: AbortSignal): Promise<void> {
    const subagents = this.ctx.get('subagents')
    while (true) {
      await agent.whenIdle()
      signal.throwIfAborted()
      const idleSeq = agent.session.seq
      const joined = await subagents?.waitForChildren(agent) ?? false
      signal.throwIfAborted()
      if (!joined && agent.status === 'idle' && agent.session.seq === idleSeq) return
    }
  }
  /** Load persisted history for crash reconciliation without synchronous Session event access. */
  private async persistedEvents(id: TaskRun['sessionId']): Promise<readonly SessionEvent[]> {
    const reader = await this.ctx.sessionPersistence.open(id, 'read')
    try { return (await reader.read()).events }
    finally { await reader.close() }
  }
  abort(id: TaskRunId): void {
    const handle = this.handles.get(id)
    if (handle === undefined) return
    const { agent } = handle
    const subagents = this.ctx.get('subagents')
    this.access.cancel(agent.id, () => {
      agent.cancel({ kind: 'user' }, { keepInbox: true })
      // Children run independently of the parent turn; stopping the parent alone would leave them running.
      if (subagents === undefined || this.drains.has(id)) return
      const drained = subagents.drainDescendants([agent])
      // Cleanup reports a failed release; this observer keeps the rejection handled until cleanup awaits it.
      void drained.catch((error: unknown) => { this.ctx.logger.warn(`task.child.drain-failed ${String(error)}`) })
      this.drains.set(id, drained)
    })
  }
  async close(id: TaskRunId): Promise<void> {
    await this.drains.get(id)
    this.drains.delete(id)
    if (this.db.activeChildCount(id) !== 0) throw new Error('task child Agents must settle before Task cleanup')
    await this.preparations.get(id)
    const handle = this.handles.get(id)
    if (handle === undefined) return
    await this.flushes.get(id)
    const run = this.db.run(id)
    if (run !== undefined) await this.flush(run)
    await this.access.run(handle.agent.id, () => handle.dispose())
    this.handles.delete(id)
  }
}

/** An interrupted child cannot be silently recreated by replaying its parent turn. */
export class TaskChildRecoveryError extends Error {}

/** Compare Task database ownership before opening an Agent or acknowledging a Session barrier. */
function assertBinding(db: TaskDatabase, session: Session, run: TaskRun): void {
  const owner = db.forSession(session.id)
  if (session.id !== run.sessionId || owner?.id !== run.id) {
    throw new Error('task Session binding disagrees with its database')
  }
}
/** Read a model operation's answer, including after a crash: the final assistant text of the last turn that ended
 * between the delivered input and the next Task input. Turns woken by settled-child notices belong to the same operation.
 *
 * @param events - complete immutable log.
 * @param messageId - delivered input.
 * @returns completed answer.
 */
export function modelAnswer(events: readonly SessionEvent[], messageId: string): string {
  let turn: number | undefined
  let matched = false
  let text = ''
  let ended: { readonly text: string; readonly completed: boolean } | undefined
  for (const event of events) {
    if (event.type === 'turn/start') {
      turn = event.data.turn
      text = ''
    }
    if (event.type === 'user/message') {
      if (event.data.id === messageId) matched = true
      else if (matched && event.data.source.kind === 'task') break
    }
    if (matched && event.type === 'assistant/message' && event.data.turn === turn) {
      text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    }
    if (matched && event.type === 'turn/end' && event.data.turn === turn) {
      ended = { text, completed: event.data.reason.kind === 'completed' }
    }
  }
  if (ended === undefined) throw new Error('task model input has no completed turn; plugin recovery is required')
  if (!ended.completed || ended.text === '') throw new Error('task model operation did not complete with an answer; plugin recovery is required')
  return ended.text
}
