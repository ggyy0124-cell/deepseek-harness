/** Local provider admission, notifications and service disposal with real SQLite and Session providers. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { TaskDefinition, TaskDefinitionId, TaskRequestId } from '@deepseek-ai/dsh-task'
import { z } from 'zod'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { taskHost } from './host-fixture.ts'
import { TaskPluginCode } from '../src/plugin-code.ts'
import { TaskEngine } from '../src/engine.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, statfs: vi.fn(original.statfs) }
})

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const id = brandString<TaskDefinitionId>('provider-business')
const request = (value: string) => brandString<TaskRequestId>(value)
async function fixture(deferred = false, overrides: Partial<TaskDefinition> = {}) {
  let ready = () => {}
  const host = await taskHost(deferred ? (ctx) => {
    ctx.provide('appReady', { onReady(listener) { ready = listener; return () => { ready = () => {} } } })
  } : undefined)
  cleanup.push(host.close)
  const { ctx, directory } = host
  const definition: TaskDefinition = {
    id, title: 'Provider task', codeVersion: '1',
    config: { schedule: { kind: 'manual' }, concurrency: 2, preset: 'minimal', permissionPreset: 'default', workspacePath: directory, business: null },
    parseInput: value => z.json().parse(value), parseCheckpoint: value => z.json().parse(value),
    priority: () => 0, resources: () => [],
    runSpecial: async stage => stage.inputs.length ? { kind: 'succeed', result: stage.inputs[0]!.value }
      : { kind: 'wait', checkpoint: true, prompt: 'Continue', schema: {} },
    classifyError: (_error, run) => ({ kind: 'block', checkpoint: run.checkpoint, reason: 'repair' }), cleanup: async () => {}, ...overrides,
  }
  let unregister = async () => {}
  const owner = await ctx.plugin({ name: 'provider-business', inject: ['tasks'], apply(owner: Context) {
    unregister = owner.tasks.register(owner, definition)
  } })
  return { ...host, definition, owner, unregister, ready: () => { ready() } }
}

describe('Local Task provider', () => {
  it('reports a root shutdown failure while still disposing the provider', async () => {
    const { ctx } = await fixture()
    const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    const shutdown = vi.spyOn(TaskEngine.prototype, 'shutdown').mockRejectedValueOnce(new Error('host drain failed'))
    try {
      await ctx.fiber.dispose()
      expect(errors).toHaveBeenCalledWith('task.shutdown.failed Error: host drain failed')
    } finally { shutdown.mockRestore(); errors.mockRestore() }
  })

  it('reports failed and pressured filesystem statistics explicitly', async () => {
    const { ctx, directory } = await fixture()
    const observed = await fs.statfs(directory)
    vi.mocked(fs.statfs).mockRejectedValueOnce(new Error('statistics unavailable'))
    expect((await ctx.tasks.diagnostics()).storage).toBeNull()
    vi.mocked(fs.statfs).mockResolvedValueOnce(Object.assign(observed, { blocks: 0, bavail: 0 }))
    expect((await ctx.tasks.diagnostics()).storage).toMatchObject({ pressure: true, totalBytes: 0 })
  })

  it('logs scheduler and plugin-release failures and continues subsequent ticks', async () => {
    const { ctx } = await fixture(true)
    const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    const recover = vi.spyOn(TaskPluginCode.prototype, 'recover').mockRejectedValueOnce(new Error('recovery failed'))
    const other = await fixture(true)
    other.ready()
    await expect.poll(async () => (await other.ctx.tasks.diagnostics()).scheduler).toBe('failed')
    recover.mockRestore()
    const working = await fixture(true)
    const log = vi.spyOn(working.ctx.logger, 'error').mockImplementation(() => {})
    const tick = vi.spyOn(TaskEngine.prototype, 'tick').mockImplementationOnce(() => { throw new Error('tick failed') })
    working.ready()
    await expect.poll(() => log.mock.calls.some(([event]) => event === 'task.scheduler.tick-failed')).toBe(true)
    tick.mockRestore()
    const release = vi.spyOn(TaskPluginCode.prototype, 'flush').mockRejectedValueOnce(new Error('release failed'))
    await expect.poll(() => log.mock.calls.some(([event]) => event === 'task.retirement.dispose-failed; plugin release remains pending')).toBe(true)
    release.mockRestore()
    expect((await working.ctx.tasks.diagnostics()).scheduler).toBe('running')
    log.mockRestore(); errors.mockRestore()
  })

  it('routes provider dispatch and runtime confirmations through admitted Sessions', async () => {
    const { ctx } = await fixture(false, {
      businessKey: () => 'child', compareUpdate: () => 'ignore',
      runOrdinary: async () => ({ kind: 'succeed', result: null }),
      runSpecial: async (stage) => {
        const agent = ctx.agents.get(stage.run.sessionId)!
        const next = vi.fn(async () => ({ kind: 'enter' as const, messages: [] }))
        expect(await ctx.waterfall('agent/pre-step', { agent, turn: 0, step: 0, messages: [], signal: stage.signal }, next)).toEqual({ kind: 'enter', messages: [] })
        expect(next).toHaveBeenCalledOnce()
        const result = await ctx.tools.execute({ agent, callId: ToolCallId('admitted'), name: 'unknown', arguments: {}, signal: stage.signal })
        expect(JSON.stringify(result)).not.toContain('not admitted')
        const child = await ctx.tasks.dispatch(stage.run.sessionId, request('child'), null)
        const approval = await ctx.waterfall('approval/request', { agent, toolName: 'publish', signal: stage.signal }, async () => 'unavailable')
        return { kind: 'succeed', result: { child: child.runId, approval } }
      },
    })
    const run = ctx.tasks.triggerManual(id, request('runtime'), null)
    await expect.poll(() => ctx.tasks.interactions(run.id).length).toBe(1)
    const pending = ctx.tasks.interactions(run.id)[0]!
    expect(ctx.tasks.waitingInteractions()).toEqual([pending])
    ctx.tasks.respond(run.id, pending.id, pending.revision, request('approval'), 'allowed-once')
    await expect.poll(() => ctx.tasks.getRun(run.id)?.status).toBe('succeeded')
    expect(ctx.tasks.interactions(run.id)).toEqual([])
    expect(ctx.tasks.waitingInteractions()).toEqual([])
    expect(ctx.tasks.getRun(run.id)?.result).toMatchObject({ approval: 'allowed-once' })
    expect(ctx.tasks.listRuns()).toHaveLength(2)
  })

  it('waits for application readiness and exposes direct commands through the same engine', async () => {
    const { ctx, definition, ready, unregister } = await fixture(true)
    expect((await ctx.tasks.diagnostics()).scheduler).toBe('starting')
    ctx.tasks.updateConfig(id, 1, { ...definition.config, concurrency: 1 })
    ctx.tasks.setEnabled(id, false)
    ctx.tasks.setEnabled(id, true)
    const run = ctx.tasks.triggerManual(id, request('manual'), null)
    ready()
    await expect.poll(() => ctx.tasks.getRun(run.id)?.status).toBe('waiting_input')
    const wait = ctx.tasks.getRun(run.id)!.wait!
    ctx.tasks.respond(run.id, wait.id, wait.revision, request('answer'), true)
    await expect.poll(() => ctx.tasks.getRun(run.id)?.status).toBe('succeeded')
    const other = ctx.tasks.triggerManual(id, request('other'), null)
    ctx.tasks.sendInput(other.id, request('input'), 'supplement')
    await ctx.tasks.cancel(other.id)
    expect(ctx.tasks.listRuns()).toHaveLength(2)
    expect(ctx.tasks.journal(0).length).toBeGreaterThan(0)
    expect(ctx.tasks.journalPage(0, 1)).toHaveLength(1)
    expect(ctx.tasks.journalHead().sequence).toBeGreaterThan(0)
    await expect(ctx.tasks.dispatch(SessionId('unowned'), request('dispatch'), null)).rejects.toThrow('task-owned')
    await unregister(); await unregister()
    expect(ctx.tasks.getRetirement(id)?.state).toBe('complete')
  })

  it('rejects a second special definition on one plugin fiber', async () => {
    const { ctx, owner, definition } = await fixture()
    expect(() => ctx.tasks.register(owner.ctx, { ...definition, id: brandString<TaskDefinitionId>('second') })).toThrow('exactly one special task')
    expect(ctx.tasks.listDefinitions().map(value => value.id)).toEqual([id])
  })

  it('retries failed notifications and removes a destination when its owner is disposed', async () => {
    const { ctx } = await fixture()
    const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    const deliver = vi.fn(async () => {}).mockRejectedValueOnce(new Error('temporarily offline'))
    let unregister = async () => {}
    const owner = await ctx.plugin({ name: 'notification-owner', inject: ['tasks'], apply(owner: Context) {
      unregister = owner.tasks.registerNotificationProvider(owner, 'destination', { deliver })
      expect(() => owner.tasks.registerNotificationProvider(owner, 'destination', { deliver })).toThrow('already registered')
      expect(() => owner.tasks.registerNotificationProvider(owner, 'bad id', { deliver })).toThrow('invalid')
    } })
    ctx.tasks.triggerManual(id, request('notification'), null)
    await expect.poll(() => deliver.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(errors).toHaveBeenCalledWith('task.notification.failed; delivery remains pending')
    await unregister(); await owner.dispose()
    const before = deliver.mock.calls.length
    const next = ctx.tasks.triggerManual(id, request('next'), null)
    await expect.poll(() => ctx.tasks.getRun(next.id)?.status).toBe('waiting_input')
    expect(deliver).toHaveBeenCalledTimes(before)
    errors.mockRestore()
  })

  it('denies Agent parenting, steps and tools while a Task Session waits', async () => {
    const { ctx } = await fixture()
    const run = ctx.tasks.triggerManual(id, request('waiting'), null)
    await expect.poll(() => ctx.tasks.getRun(run.id)?.status).toBe('waiting_input')
    const agent = ctx.agents.get(run.sessionId)!
    await expect(ctx.agents.create({ sessionId: SessionId('child'), parentAgent: agent })).rejects.toThrow('dispatch ordinary work')
    const signal = new AbortController().signal
    expect(await ctx.waterfall('agent/pre-step', { agent, turn: 0, step: 0, messages: [], signal }, async () => ({ kind: 'enter', messages: [] })))
      .toEqual({ kind: 'reject' })
    const result = await ctx.tools.execute({ agent, callId: ToolCallId('waiting'), name: 'unknown', arguments: {}, signal })
    expect(JSON.stringify(result)).toContain('not admitted')
    const ordinary = await ctx.tools.execute({ callId: ToolCallId('unowned'), name: 'unknown', arguments: {}, signal })
    expect(JSON.stringify(ordinary)).not.toContain('not admitted')
  })

  it('leaves Task records untouched when an ordinary Agent fails to create', async () => {
    const { ctx, directory } = await fixture()
    await expect(ctx.agents.create({ sessionId: SessionId('ordinary'), setup: () => { throw new Error('setup failed') } }))
      .rejects.toThrow('setup failed')
    const db = new DatabaseSync(join(directory, 'tasks.sqlite'))
    const rows = db.prepare("SELECT event FROM journal WHERE event LIKE 'child.%'").all()
    db.close()
    expect(rows).toEqual([])
  })
})
