/** Real AgentLoop and JSONL persistence behind the task Session adapter. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TaskDefinition, TaskDefinitionId, TaskRequestId, TaskRun } from '@deepseek-ai/dsh-task'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TaskSessionStore, { taskSessionStore } from '@deepseek-ai/dsh-task-session'
import TaskAgentRegistry from '@deepseek-ai/dsh-task-agent'
import TaskAgentLoop from '@deepseek-ai/dsh-task-agent-loop'
import TaskAgentPresetRegistry, { taskAgentPresetRegistry } from '@deepseek-ai/dsh-task-agent-preset-registry'
import { livePresetMounts, type PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { createScope } from '@deepseek-ai/dsh-scope'
import TaskJsonlPersistence from '@deepseek-ai/dsh-task-session-persistence-jsonl'
import { TaskDatabase } from '../src/database.ts'
import { TaskEngine } from '../src/engine.ts'
import { AgentTaskSessions, TaskChildRecoveryError, modelAnswer } from '../src/sessions.ts'
import { TaskSessionAccess } from '../src/access.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-task-session-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'presets'), { recursive: true })
  await writeFile(join(directory, 'presets', 'fixture.mjs'), 'export function apply() {}\n')
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(TaskSessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(TaskAgentRegistry)
  await ctx.plugin(TaskJsonlPersistence, { root: join(directory, 'sessions'), compression: 'none' })
  await ctx.plugin(TaskAgentLoop, { agents: [] })
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock' })
  await ctx.plugin(TaskAgentPresetRegistry, { default: 'test' })
  const declare = (plugins: PresetDefinition['plugins']) => ctx.plugin({
    inject: ['agentPresets'],
    async* apply(declaring: Context) { yield await declaring.agentPresets.register({ id: 'test', plugins }) },
  })
  let declaring = await declare([{ name: './presets/fixture.mjs' }])
  /** Replace the `test` declaration, as a profile edit reloading its declaring row does. */
  const redeclare = async (plugins: PresetDefinition['plugins']): Promise<void> => {
    await declaring.dispose()
    declaring = await declare(plugins)
  }
  ctx.provide('permissionPresets', { set() {}, current: () => 'default' } as unknown as Context['permissionPresets'])
  ctx.provide('workspaceRegistry', { create: async () => ({ attachSession: async () => {} }) } as unknown as Context['workspaceRegistry'])
  const adapter = new MockAdapter([textResponse('first answer'), textResponse('second answer')])
  ctx.llm.registerAdapter(['mock'], adapter)
  const db = new TaskDatabase(join(directory, 'tasks.sqlite'))
  const access = new TaskSessionAccess()
  const removePolicy = taskSessionStore(ctx).guardMutations(id => db.forSession(id) !== undefined, (id) => { access.assert(id) })
  const sessions = new AgentTaskSessions(ctx, db, access)
  const engine = new TaskEngine(db, sessions, { concurrency: 2,
    cancellationGraceMs: 30000, cleanupTimeoutMs: 120000, shutdownTimeoutMs: 120000,
    catchupLimit: 100, catchupHorizonMs: 2592000000, pendingLimit: 100,
    priorityAgingIntervalMs: 60000, priorityAgingCap: 100, clock: Date.now, log: () => {} })
  cleanup.push(async () => { await engine.shutdown(); await ctx.fiber.dispose(); db.close() })
  const id = brandString<TaskDefinitionId>('model-business')
  const definition: TaskDefinition = {
    id, title: 'Model business', codeVersion: '1', config: { schedule: { kind: 'manual' }, concurrency: 1, preset: 'test', permissionPreset: 'test', workspacePath: directory, business: null },
    parseInput: value => value as TaskRun['input'], parseCheckpoint: value => value as TaskRun['checkpoint'],
    runSpecial: async stage => ({ kind: 'succeed', result: await stage.model('analysis', 'Analyze this task.') }),
    priority: () => 0, resources: () => [], classifyError: (error, run) => ({ kind: 'block', checkpoint: run.checkpoint, reason: String(error) }), cleanup: async () => {},
  }
  return { ctx, db, engine, sessions, adapter, definition, directory, removePolicy, access, redeclare }
}

describe('task Session integration', () => {
  it('rejects a corrupt Session association and can dispose an Agent after its durable owner disappears', async () => {
    const { ctx, engine, sessions, definition, directory, db } = await harness()
    engine.register(definition)
    const run = engine.triggerManual(definition.id, brandString<TaskRequestId>('binding'), null)
    await sessions.ensure(run, new AbortController().signal)
    const raw = new DatabaseSync(join(directory, 'tasks.sqlite'))
    try {
      raw.prepare('UPDATE runs SET session_id=? WHERE id=?').run('wrong-owner', run.id)
      db.putRun(run)
      await expect(sessions.flush(run)).rejects.toThrow('binding disagrees')
      raw.prepare('DELETE FROM runs WHERE id=?').run(run.id)
      await sessions.close(run.id)
      expect(ctx.agents.get(run.sessionId)).toBeUndefined()
    } finally { raw.close() }
  })
  it('shares pending preparations and retries workspace attachment without leaking an Agent', async () => {
    const { ctx, engine, db, sessions, definition, access, redeclare } = await harness()
    engine.register(definition)
    const run = engine.triggerManual(definition.id, brandString<TaskRequestId>('prepare-retry'), null)
    const create = vi.spyOn(ctx.workspaceRegistry, 'create').mockRejectedValueOnce(new Error('workspace unavailable'))
    const signal = new AbortController().signal
    await expect(Promise.all([sessions.ensure(run, signal), sessions.ensure(run, signal)]))
      .rejects.toThrow('workspace unavailable')
    expect(ctx.agents.get(run.sessionId)).toBeUndefined()
    await sessions.ensure(run, signal)
    expect(ctx.agents.get(run.sessionId)).toBeDefined()
    expect(create).toHaveBeenCalledTimes(2)
    await sessions.close(run.id)
    const receiptKey = `@preset:${run.definitionId}:${run.configRevision}:${run.codeVersion}`
    const recorded = db.operation(run.id, receiptKey)!
    // A restarted provider reuses the recorded revision even after the declaration changes.
    await redeclare([{ name: './presets/fixture.mjs', config: { changed: true } }])
    const restored = new AgentTaskSessions(ctx, db, access)
    await restored.ensure(run, signal)
    expect(db.operation(run.id, receiptKey)).toEqual(recorded)
    expect(livePresetMounts(ctx.fiber)).toHaveLength(2)
    await restored.close(run.id)
    expect(livePresetMounts(ctx.fiber)).toHaveLength(1)
    db.putOperation(run.id, receiptKey, 'confirmed', { ...recorded.value as object, plugins: '- name: ./elsewhere.mjs\n' })
    const tampered = new AgentTaskSessions(ctx, db, access)
    await expect(tampered.ensure(run, signal)).rejects.toThrow('does not match its digest')
    create.mockRestore()
  })

  it('deduplicates overlapping model calls and rejects changed operation identities', async () => {
    const { engine, sessions, definition, adapter, db } = await harness()
    engine.register(definition)
    const run = engine.triggerManual(definition.id, brandString<TaskRequestId>('model-overlap'), null)
    const signal = new AbortController().signal
    await expect(sessions.model(run, 'analysis', 'prompt', signal)).rejects.toThrow('not admitted')
    await expect(sessions.model(run, '@reserved', 'prompt', signal)).rejects.toThrow('reserved')
    await expect(sessions.model(run, ' ', 'prompt', signal)).rejects.toThrow('empty')
    await sessions.ensure(run, signal)
    const first = sessions.model(run, 'analysis', 'prompt', signal)
    expect(sessions.model(run, 'analysis', 'prompt', signal)).toBe(first)
    await expect(sessions.model(run, 'analysis', 'different', signal)).rejects.toThrow('one model operation')
    await expect(sessions.model(run, 'other', 'prompt', signal)).rejects.toThrow('one model operation')
    await expect(first).resolves.toBe('first answer')
    await expect(sessions.model(run, 'analysis', 'different', signal)).rejects.toThrow('different prompt')
    db.putOperation(run.id, '@model:analysis', 'prepared', { prompt: 'prompt' })
    await expect(sessions.model(run, 'analysis', 'prompt', signal)).resolves.toBe('first answer')
    expect(adapter.requests).toHaveLength(1)
    await Promise.all([sessions.flush(run), sessions.flush(run)])
  })

  it('blocks replay of an unfinished model turn that created a child Agent', async () => {
    const { engine, sessions, definition, db } = await harness()
    engine.register(definition)
    const run = engine.triggerManual(definition.id, brandString<TaskRequestId>('child-recovery'), null)
    await sessions.ensure(run, new AbortController().signal)
    const child = brandString<typeof run.sessionId>('child-session')
    db.reserveChild({ sessionId: child, runId: run.id, modelKey: 'analysis', state: 'active' })
    db.putOperation(run.id, '@model:analysis', 'prepared', { prompt: 'Analyze this task.' })
    expect(db.interruptChildren()).toBe(1)
    expect(db.child(child)?.state).toBe('interrupted')
    await expect(sessions.model(run, 'analysis', 'Analyze this task.', new AbortController().signal))
      .rejects.toBeInstanceOf(TaskChildRecoveryError)
    await sessions.close(run.id)
  })

  it('cancels a running model request and preserves its unconfirmed receipt', async () => {
    const { ctx, engine, sessions, definition, db } = await harness()
    const adapter = new MockAdapter(['hang'])
    const remove = ctx.llm.registerAdapter(['hanging'], adapter)
    engine.register({ ...definition, config: { ...definition.config, model: { provider: 'hanging', model: 'test' } } })
    const run = engine.triggerManual(definition.id, brandString<TaskRequestId>('model-abort'), null)
    const controller = new AbortController()
    await sessions.ensure(run, controller.signal)
    const work = sessions.model(run, 'analysis', 'prompt', controller.signal)
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' })
    try {
      await expect.poll(() => adapter.requests.length).toBe(1)
      controller.abort()
      await rejected
      expect(db.operation(run.id, '@model:analysis')?.state).toBe('prepared')
    } finally { controller.abort(); await work.catch(() => {}); await sessions.close(run.id); remove() }
  })

  it('releases a revision after its last Agent, including inherited child compositions', async () => {
    const { ctx, redeclare } = await harness()
    const registry = taskAgentPresetRegistry(ctx)
    const revision = await registry.captureRevision('test')
    await redeclare([{ name: './presets/fixture.mjs', config: {} }])
    const parent = createScope(ctx, {})
    const child = createScope(ctx, {})
    try {
      expect(await registry.mountRevision(parent.ctx, revision)).toEqual({ id: 'test' })
      expect(registry.composeFrom(child.ctx, parent.ctx)).toBe('test')
      expect(livePresetMounts(ctx.fiber)).toHaveLength(2)
      await parent.dispose()
      expect(livePresetMounts(ctx.fiber)).toHaveLength(2)
      await child.dispose()
      expect(livePresetMounts(ctx.fiber)).toHaveLength(1)
    } finally { await child.dispose(); await parent.dispose() }
  })

  it('releases replaced compositions only after their joined Agents leave', async () => {
    const { ctx, redeclare } = await harness()
    const registry = taskAgentPresetRegistry(ctx)
    const first = createScope(ctx, {})
    const second = createScope(ctx, {})
    try {
      await registry.mountRevision(first.ctx, await registry.captureRevision('test'))
      await redeclare([{ name: './presets/fixture.mjs', config: {} }])
      await registry.mountRevision(second.ctx, await registry.captureRevision('test'))
      expect(livePresetMounts(ctx.fiber)).toHaveLength(2)
      await first.dispose()
      expect(livePresetMounts(ctx.fiber)).toHaveLength(1)
      await second.dispose()
      expect(livePresetMounts(ctx.fiber)).toHaveLength(1)
    } finally { await second.dispose(); await first.dispose() }
  })

  it('creates a missing persisted Session during recovery', async () => {
    const { ctx, db, engine, sessions, definition } = await harness()
    engine.register(definition)
    const run = engine.triggerManual(definition.id, brandString<TaskRequestId>('manual'), null)
    expect(await ctx.sessionPersistence.stat(run.sessionId)).toBeUndefined()
    await sessions.recover()
    expect(await ctx.sessionPersistence.stat(run.sessionId)).toBeDefined()
    expect(ctx.agents.get(run.sessionId)).toBeUndefined()
    expect(db.pendingSessions()).toEqual([])
  })
  it('allows reads and rejects writes outside the task owner operation', async () => {
    const { ctx, engine, definition } = await harness()
    engine.register(definition)
    const run = engine.triggerManual(definition.id, brandString<TaskRequestId>('manual'), null)
    await engine.cancel(run.id)
    const reader = await ctx.sessionPersistence.open(run.sessionId, 'read')
    expect((await reader.read()).events).toEqual([])
    await reader.close()
    await expect(ctx.sessionPersistence.open(run.sessionId, 'write')).rejects.toThrow('task-owned')
    await expect(ctx.agents.resume({ resumeSessionId: run.sessionId })).rejects.toThrow('task-owned')
  })
  it('persists the delivered model input and correlated completion', async () => {
    const { ctx, engine, db, adapter, definition } = await harness()
    engine.register(definition)
    const run = engine.triggerManual(definition.id, brandString<TaskRequestId>('manual'), null)
    engine.tick(); await engine.drain()
    expect(db.run(run.id), db.run(run.id)?.reason ?? '').toMatchObject({ status: 'succeeded', result: 'first answer' })
    expect(adapter.requests).toHaveLength(1)
    const reader = await ctx.sessionPersistence.open(run.sessionId, 'read')
    const { events } = await reader.read()
    await reader.close()
    expect(events.filter(event => event.type === 'user/message')).toHaveLength(1)
    const message = events.find(event => event.type === 'user/message')!
    expect(modelAnswer(events, message.data.id)).toBe('first answer')
    expect(() => modelAnswer(events, 'absent')).toThrow('no completed turn')
    expect(() => modelAnswer(events.filter(event => event.type !== 'assistant/message'), message.data.id)).toThrow('did not complete with an answer')
    expect(() => modelAnswer(events.map(event => event.type === 'turn/end'
      ? { ...event, data: { ...event.data, reason: { kind: 'blocked' as const } } } : event), message.data.id)).toThrow('did not complete with an answer')
    expect(db.outbox(run.id)).toEqual([])
    await expect(ctx.agents.resume({ resumeSessionId: run.sessionId })).rejects.toThrow('task-owned')
  })

  it('reuses a recorded model operation after stage recovery without another model request', async () => {
    const { ctx, engine, db, adapter, definition } = await harness()
    let fail = true
    engine.register({ ...definition, runSpecial: async (stage) => {
      const text = await stage.model('analysis', 'Analyze this task.')
      if (fail) { fail = false; throw new Error('crash before business checkpoint') }
      return { kind: 'succeed', result: text }
    } })
    const run = engine.triggerManual(definition.id, brandString<TaskRequestId>('manual'), null)
    engine.tick(); await engine.drain()
    expect(db.run(run.id)?.status).toBe('blocked')
    const agent = ctx.agents.get(run.sessionId)!
    expect(() =>{  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'bypass' }], source: { kind: 'user' } })) }).toThrow('task-owned')
    engine.sendInput(run.id, brandString<TaskRequestId>('resume'), 'continue')
    engine.tick(); await engine.drain()
    expect(db.run(run.id), db.run(run.id)?.reason ?? '').toMatchObject({ status: 'succeeded', result: 'first answer' })
    expect(adapter.requests).toHaveLength(1)
  })

  it('materializes an empty Session when cancellation precedes Agent acquisition', async () => {
    const { ctx, engine, db, definition } = await harness()
    engine.register(definition)
    const run = engine.triggerManual(definition.id, brandString<TaskRequestId>('manual'), null)
    await engine.cancel(run.id)
    expect(db.run(run.id)?.status).toBe('cancelled')
    const reader = await ctx.sessionPersistence.open(run.sessionId, 'read')
    expect((await reader.read()).events).toEqual([])
    await reader.close()
  })

  it('repairs terminal outbox acknowledgement without repeating business execution', async () => {
    const { ctx, engine, db, sessions, definition } = await harness()
    engine.register(definition)
    const run = engine.triggerManual(definition.id, brandString<TaskRequestId>('manual'), null)
    engine.sendInput(run.id, brandString<TaskRequestId>('extra'), 'retain this input')
    const terminal = { ...db.run(run.id)!, status: 'cancelled' as const, cleanup: 'complete' as const, terminalAt: Date.now() }
    db.transaction(() => { db.consume(run.id, terminal.inputRevision); db.putRun(terminal) })
    const acknowledge = vi.spyOn(db, 'acknowledge').mockImplementationOnce(() => { throw new Error('lost acknowledgement') })
    await expect(sessions.recover()).rejects.toThrow('lost acknowledgement')
    acknowledge.mockRestore()
    await sessions.recover()
    expect(db.pendingSessions()).toEqual([])
    const reader = await ctx.sessionPersistence.open(run.sessionId, 'read')
    const { events } = await reader.read()
    await reader.close()
    expect(events).toEqual([])
    expect(db.pendingSessions()).toEqual([])
  })
})
