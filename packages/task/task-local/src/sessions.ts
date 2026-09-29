/** Session ownership, immutable preset copies, and correlated model delivery. */
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { MessageId, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-workspace'
import type { TaskRun, TaskRunId } from '@deepseek-ai/dsh-task'
import { taskAgentPresets } from '@deepseek-ai/dsh-task-agent-presets'
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

/** Agent adapter owns one root Agent per execution; task provenance never becomes runtime parenting. */
export class AgentTaskSessions implements TaskSessions {
  private readonly handles = new Map<TaskRunId, AgentHandle>()
  private readonly preparations = new Map<TaskRunId, Promise<void>>()
  private readonly flushes = new Map<TaskRunId, Promise<void>>()
  private readonly revisions = new Map<string, Promise<string>>()
  private readonly modelCalls = new Map<TaskRunId, { key: string; prompt: string; promise: Promise<string> }>()

  /**
   * @param ctx - provider-owned root context.
   * @param db - task transactions/outbox.
   * @param revisionRoot - retained preset assets.
   */
  constructor(
    private readonly ctx: Context, private readonly db: TaskDatabase,
    private readonly revisionRoot: string, private readonly access: TaskSessionAccess,
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
    const path = await this.revision(run)
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
      await taskAgentPresets(this.ctx).mountRevision(agentCtx, run.config.preset, path)
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
  private revision(run: TaskRun): Promise<string> {
    const key = `${run.definitionId}:${run.configRevision}:${run.codeVersion}`
    let pending = this.revisions.get(key)
    if (pending === undefined) {
      pending = this.captureRevision(run, key)
      this.revisions.set(key, pending)
      void pending.catch(() => this.revisions.delete(key))
    }
    return pending
  }
  private async captureRevision(run: TaskRun, key: string): Promise<string> {
    const receiptKey = `@preset:${key}`
    // All children inherit the source revision even if its runtime Agent has been disposed.
    const owner = this.revisionOwner(run)
    const receipt = this.db.operation(owner.id, receiptKey)
    if (receipt !== undefined) {
      const saved = z.object({ path: z.string(), digest: z.string() }).parse(receipt.value)
      if (await directoryDigest(dirname(saved.path)) !== saved.digest) throw new Error('task preset revision assets are missing or changed')
      return saved.path
    }
    const source = await taskAgentPresets(this.ctx).resolve(run.config.preset)
    const target = join(this.revisionRoot, createHash('sha256').update(key).digest('hex'))
    const staging = `${target}.${randomUUID()}`
    await mkdir(this.revisionRoot, { recursive: true, mode: 0o700 })
    try {
      await cp(dirname(source.path), staging, { recursive: true, dereference: true, errorOnExist: true, force: false })
      const digest = await directoryDigest(staging)
      await rm(target, { recursive: true, force: true })
      await rename(staging, target)
      const path = join(target, relative(dirname(source.path), source.path))
      this.db.putOperation(owner.id, receiptKey, 'confirmed', { path, digest })
      return path
    } finally { await rm(staging, { recursive: true, force: true }) }
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
      await handle.agent.whenIdle()
      signal.throwIfAborted()
      if (this.db.activeChildCount(run.id) !== 0)
        throw new TaskChildRecoveryError('task child Agent did not settle before the parent model turn')
      await this.ctx.sessions.flush(handle.agent.session)
      const answer = modelAnswer(await this.persistedEvents(run.sessionId), id)
      this.db.putOperation(run.id, operationKey, 'confirmed', { prompt, answer })
      return answer
    } finally { signal.removeEventListener('abort', abort) }
  }
  /** Load persisted history for crash reconciliation without synchronous Session event access. */
  private async persistedEvents(id: TaskRun['sessionId']): Promise<readonly SessionEvent[]> {
    const reader = await this.ctx.sessionPersistence.open(id, 'read')
    try { return (await reader.read()).events }
    finally { await reader.close() }
  }
  abort(id: TaskRunId): void {
    const handle = this.handles.get(id)
    if (handle !== undefined) this.access.cancel(handle.agent.id, () => { handle.agent.cancel({ kind: 'user' }, { keepInbox: true }) })
  }
  async close(id: TaskRunId): Promise<void> {
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
/** Match a message to its completed turn and assistant output, including after a crash.
 *
 * @param events - complete immutable log.
 * @param messageId - delivered input.
 * @returns completed answer.
 */
export function modelAnswer(events: readonly SessionEvent[], messageId: string): string {
  let turn: number | undefined
  let matched = false
  let text = ''
  for (const event of events) {
    if (event.type === 'turn/start') turn = event.data.turn
    if (event.type === 'user/message' && event.data.id === messageId) matched = true
    if (matched && event.type === 'assistant/message' && event.data.turn === turn) {
      text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    }
    if (matched && event.type === 'turn/end' && event.data.turn === turn) {
      if (event.data.reason.kind !== 'completed' || text === '') throw new Error('task model operation did not complete with an answer; plugin recovery is required')
      return text
    }
  }
  throw new Error('task model input has no completed turn; plugin recovery is required')
}
/** Hash retained preset files in deterministic path order. */
async function directoryDigest(directory: string): Promise<string> {
  const digest = createHash('sha256')
  async function visit(path: string): Promise<void> {
    const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const file = join(path, entry.name)
      digest.update(relative(directory, file))
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile()) digest.update(await readFile(file))
      else throw new Error('task preset revision must contain only regular files and directories')
    }
  }
  await visit(directory)
  return digest.digest('hex')
}
