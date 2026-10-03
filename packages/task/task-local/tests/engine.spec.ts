/** Transactional scheduling and execution behavior without timing-dependent sleeps. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import * as fs from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoader } from '@deepseek-ai/cordis-plugin-loader'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TaskCommand, TaskPrincipalId, TaskDefinition, TaskDefinitionId, TaskRequestId, TaskRun, TaskStage } from '@deepseek-ai/dsh-task'
import { SCHEMA_VERSION, TaskDatabase } from '../src/database.ts'
import { TaskEngine, type TaskSessions, type TaskEngineOptions } from '../src/engine.ts'
import { nextCalendar } from '../src/calendar.ts'
import { RuntimeInteractions } from '../src/interactions.ts'
import { TaskPluginCode } from '../src/plugin-code.ts'
import { stub } from './stub.ts'

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return { ...original, openSync: vi.fn(original.openSync) }
})

const definitionId = brandString<TaskDefinitionId>('business')
const request = (id: string): TaskRequestId => brandString<TaskRequestId>(id)
const disposers: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })

function definition(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: definitionId, title: 'Business', codeVersion: '1',
    config: { schedule: { kind: 'manual' }, concurrency: 2, preset: 'standard', permissionPreset: 'default', workspacePath: tmpdir(), business: null },
    parseInput: value => value as TaskRun['input'], parseCheckpoint: value => value as TaskRun['checkpoint'],
    runSpecial: async () => ({ kind: 'succeed', result: 'done' }),
    priority: () => 0, resources: () => [],
    classifyError: (_error, run) => ({ kind: 'block', checkpoint: run.checkpoint, reason: 'needs repair' }),
    cleanup: async () => {}, ...overrides,
  }
}
function setup(path = ':memory:', concurrency = 4, options: Partial<TaskEngineOptions> = {}) {
  let now = Date.UTC(2026, 8, 10, 0, 0)
  const db = new TaskDatabase(path)
  const sessions: TaskSessions = { ensure: vi.fn(async () => {}), flush: vi.fn(async () => {}), model: vi.fn(async () => 'answer'), abort: vi.fn(), close: vi.fn(async () => {}) }
  const log = vi.fn()
  const engine = new TaskEngine(db, sessions, { concurrency,
    cancellationGraceMs: 30000, cleanupTimeoutMs: 120000, shutdownTimeoutMs: 120000,
    catchupLimit: 100, catchupHorizonMs: 2592000000, pendingLimit: 100,
    priorityAgingIntervalMs: 60000, priorityAgingCap: 100, clock: () => now, log, ...options })
  let closed = false
  async function close() { if (closed) return; closed = true; await engine.shutdown(); db.close() }
  disposers.push(close)
  return { db, sessions, engine, log, close, advance: (ms: number) => { now += ms },
    turn: async () => { engine.tick(); await engine.drain() } }
}

describe('durable tasks', () => {
  it('migrates a definition that predates declared forms and checks its schema revision', async () => {
    const root = mkdtempSync(join(tmpdir(), 'task-schema-zero-'))
    disposers.push(async () => { rmSync(root, { recursive: true, force: true }) })
    const path = join(root, 'tasks.sqlite')
    const first = setup(path)
    first.engine.register(definition())
    const principal = brandString<TaskPrincipalId>('owner')
    expect(() => first.engine.command(principal, request('old-schema'), { kind: 'configure',
      definitionId, revision: 1, configSchemaVersion: 1, config: definition().config }))
      .toThrow('schema version differs')
    await first.close()
    const second = setup(path)
    second.engine.register(definition({
      forms: { version: 1, business: { type: 'object' }, input: {} },
      config: { ...definition().config, business: {} },
      migrateConfig: (_business, version) => ({ migratedFrom: version }),
    }))
    const current = second.db.definitions()[0]!
    expect(current.config.business).toEqual({ migratedFrom: 0 })
    expect(() => second.engine.command(principal, request('wrong-schema'), { kind: 'configure',
      definitionId, revision: current.revision, configSchemaVersion: 0, config: current.config }))
      .toThrow('schema version differs')
    const run = second.engine.command(principal, request('start'), { kind: 'trigger', definitionId, input: null })
    if (run.kind !== 'run') throw new Error('Expected an execution')
    const cancellation = second.engine.command(principal, request('stop'), { kind: 'cancel', runId: run.run.id })
    expect(cancellation.kind).toBe('cancellation')
    const replay = second.engine.command(principal, request('stop-again'), { kind: 'cancel', runId: run.run.id })
    expect(replay.kind).toBe('cancellation')
    await second.engine.drain()
  })

  it('rejects expired confirmations and records unknown thrown stage failures', async () => {
    const { engine, db, turn, advance } = setup()
    engine.register(definition({ runSpecial: async () => { throw 'failed without Error' },
      classifyError: (_error, run) => ({ kind: 'block', checkpoint: run.checkpoint, reason: 'operator repair' }) }))
    const run = engine.triggerManual(definitionId, request('primitive'), null)
    await turn()
    expect(db.run(run.id)?.status).toBe('blocked')
    expect(db.journal(0).find(entry => entry.event === 'stage.error')?.details).toMatchObject({ error: 'unknown' })
    await engine.remove(definitionId)
    engine.register(definition({ runSpecial: async () => ({ kind: 'wait', checkpoint: null,
      prompt: 'Confirm', expiresAt: Date.UTC(2026, 8, 10) + 100 }) }))
    engine.setEnabled(definitionId, true)
    const waiting = engine.triggerManual(definitionId, request('expires'), null)
    await turn()
    const prompt = db.run(waiting.id)!.wait!
    expect(prompt.createdAt).toBe(Date.UTC(2026, 8, 10))
    advance(101)
    expect(() => { engine.respond(waiting.id, prompt.id, prompt.revision, request('expired'), true) })
      .toThrow('stale or closed')
  })

  it('keeps an active poll exclusive after its scheduling interval changes', async () => {
    const { engine, db, turn } = setup()
    const config = { ...definition().config, schedule: { kind: 'polling' as const, intervalMs: 1000 } }
    engine.register(definition({ config, runSpecial: async () => ({ kind: 'wait', checkpoint: null, prompt: '?' }) }))
    expect(() => engine.triggerManual(definitionId, request('not-manual'), null)).toThrow('only manual')
    await turn()
    engine.updateConfig(definitionId, 1, { ...config, schedule: { kind: 'polling', intervalMs: 100 } })
    await turn()
    expect(db.runs()).toHaveLength(1)
    expect(db.runs()[0]).toMatchObject({ outcome: null, occurrence: { scheduledAt: Date.UTC(2026, 8, 10), missed: null } })
  })

  it.each(['error', 'primitive'] as const)('disables a poll after a %s discovery admission failure', async (failure) => {
    const { engine, db, turn } = setup()
    engine.register(definition({ config: { ...definition().config, schedule: { kind: 'polling', intervalMs: 100 } },
      parseInput: () => { if (failure === 'error') throw new Error('discovery unavailable'); throw 'discovery unavailable' } }))
    await turn()
    expect(db.definitions()[0]).toMatchObject({ enabled: false,
      blockedReason: `schedule evaluation failed (${failure === 'error' ? 'Error' : 'unknown'})` })
    expect(db.runs()).toEqual([])
    expect(db.journal(0).some(item => item.event === 'schedule.blocked')).toBe(true)
    engine.setEnabled(definitionId, false)
    expect(db.definitions()[0]?.blockedReason).not.toBeNull()
    engine.setEnabled(definitionId, true)
    expect(db.definitions()[0]).toMatchObject({ enabled: true, blockedReason: null })
  })

  it('retains an unfinished scan on configuration updates and closes an exhausted schedule', async () => {
    const { engine, db, turn } = setup(':memory:', 4, { catchupHorizonMs: 1 })
    const config = { ...definition().config, schedule: { kind: 'scheduled' as const, cron: '0 0 31 2 *', timezone: 'UTC', misfire: 'all' as const, overlap: 'queue' as const } }
    engine.register(definition({ config }))
    const from = Date.UTC(2026, 8, 9)
    db.putCalendarScan(definitionId, { from, through: from + 1, count: 1, last: from, pressured: false })
    engine.updateConfig(definitionId, 1, { ...config, concurrency: 1 })
    expect(db.definitions()[0]?.nextDueAt).toBe(from)
    expect(db.calendarScan(definitionId)).toBeUndefined()
    await turn()
    expect(db.definitions()[0]?.nextDueAt).toBeNull()
    expect(db.runs()).toEqual([])
  })

  it('runs one recently missed calendar slot under the skip policy', async () => {
    const { engine, db, turn, advance } = setup()
    engine.register(definition({ config: { ...definition().config,
      schedule: { kind: 'scheduled', cron: '* * * * *', timezone: 'UTC', misfire: 'skip', overlap: 'queue' } } }))
    advance(90_000)
    await turn()
    expect(db.runs()).toHaveLength(1)
    expect(db.runs()[0]?.input).toMatchObject({ missedCount: 1 })
    expect(db.runs()[0]?.occurrence).toEqual({ scheduledAt: Date.UTC(2026, 8, 10, 0, 1), missed: null })
  })

  it.each(['retire', 'cancel'] as const)('records failed %s command cleanup for later repair', async (kind) => {
    const { engine, db, turn } = setup()
    engine.register(definition({ runSpecial: async () => ({ kind: 'wait', checkpoint: null, prompt: 'Review' }),
      cleanup: async () => { throw new Error('cleanup unavailable') } }))
    const run = engine.triggerManual(definitionId, request(`${kind}-cleanup`), null)
    await turn()
    const principal = brandString<TaskPrincipalId>('owner')
    if (kind === 'retire')
      expect(engine.command(principal, request('retire-command'), { kind, definitionId, revision: 1 }).kind)
        .toBe('retirement')
    else
      expect(engine.command(principal, request('cancel-command'), { kind, runId: run.id }).kind)
        .toBe('cancellation')
    await expect.poll(() => db.run(run.id)?.cleanup).toBe('blocked')
    if (kind === 'retire') expect(db.retirement(definitionId)?.state).toBe('blocked')
  })

  it('keeps a recovered retirement blocked when its plugin cleanup still fails', async () => {
    const { engine, db, turn } = setup()
    engine.register(definition({ runSpecial: async () => ({ kind: 'wait', checkpoint: null, prompt: 'Review' }),
      cleanup: async () => { throw new Error('resource still busy') } }))
    const run = engine.triggerManual(definitionId, request('recovered-retirement'), null)
    await turn()
    engine.requestRetirement(definitionId)
    engine.recoverRetirements()
    await expect.poll(() => db.retirement(definitionId)?.state).toBe('blocked')
    expect(db.run(run.id)?.cleanup).toBe('blocked')
  })

  it('replays supplemental inputs and confirmations without adding another input revision', async () => {
    const { engine, db, turn } = setup()
    engine.register(definition({ runSpecial: async () => ({ kind: 'wait', checkpoint: null, prompt: '?', expiresAt: Date.UTC(2026, 8, 10) + 100 }) }))
    const run = engine.triggerManual(definitionId, request('replay'), null)
    engine.sendInput(run.id, request('input'), 1)
    engine.sendInput(run.id, request('input'), 1)
    await turn()
    const wait = db.run(run.id)!.wait!
    engine.respond(run.id, wait.id, wait.revision, request('answer'), true)
    engine.respond(run.id, wait.id, wait.revision, request('answer'), true)
    expect(db.run(run.id)?.inputRevision).toBe(2)
    await engine.remove(definitionId)
    engine.recoverRetirements()
    await engine.remove(definitionId)
    await expect(engine.checkConfig(definitionId, definition().config, new AbortController().signal)).rejects.toThrow('not installed')
  })

  it('rejects missing executions and non-JSON plugin input without reserving work', () => {
    const { engine, db } = setup()
    expect(() => engine.cancel(brandString<TaskRun['id']>('missing'))).toThrow('unknown task run')
    engine.register(definition({ parseInput: () => NaN }))
    expect(() => engine.triggerManual(definitionId, request('non-json'), null)).toThrow('losslessly JSON serializable')
    expect(db.runs()).toEqual([])
  })

  it.each(['code', 'ordinary-handler', 'terminal-intent'] as const)('reconciles retained execution %s with the installed plugin', async (mode) => {
    const { engine, db, turn } = setup()
    engine.register(definition({ classifyError: (error, run) => ({ kind: 'block', checkpoint: run.checkpoint, reason: String(error) }) }))
    const run = engine.triggerManual(definitionId, request('retained'), null)
    if (mode === 'code') db.putRun({ ...run, codeVersion: 'missing' })
    else if (mode === 'ordinary-handler') db.putRun({ ...run, kind: 'ordinary' })
    else {
      db.putOperation(run.id, '@terminal', 'confirmed', { status: 'failed', result: null, reason: 'retained failure' })
      db.putRun({ ...run, status: 'cancelling' })
    }
    await turn()
    if (mode === 'terminal-intent') expect(db.run(run.id)).toMatchObject({ status: 'failed', reason: 'retained failure' })
    else expect(db.run(run.id)?.reason).toContain(mode === 'code' ? 'code revision is unavailable' : 'ordinary task handler is unavailable')
  })

  it('respects plugin concurrency while another stage holds its permit', async () => {
    const entered = Promise.withResolvers<boolean>()
    const release = Promise.withResolvers<boolean>()
    const { engine, db } = setup()
    engine.register(definition({ config: { ...definition().config, concurrency: 1 }, runSpecial: async () => {
      entered.resolve(true); await release.promise; return { kind: 'succeed', result: null }
    } }))
    engine.triggerManual(definitionId, request('one'), null)
    const next = engine.triggerManual(definitionId, request('two'), null)
    try {
      engine.tick(); await entered.promise
      expect(db.run(next.id)?.status).toBe('provisioning')
    } finally { release.resolve(true); await engine.drain() }
  })

  it('reports deadline journal failure after waiting for cancellation to drain', async () => {
    vi.useFakeTimers()
    const { engine, db } = setup(':memory:', 1, { cancellationGraceMs: 10 })
    const entered = Promise.withResolvers<boolean>(); const release = Promise.withResolvers<boolean>()
    engine.register(definition({ runSpecial: async () => { entered.resolve(true); await release.promise; return { kind: 'succeed', result: null } } }))
    const original = db.log.bind(db)
    const log = vi.spyOn(db, 'log').mockImplementation((run, event, at, details) => {
      if (event === 'cancel.timeout') throw new Error('journal unavailable')
      original(run, event, at, details)
    })
    let cancelled: Promise<unknown> | undefined
    try {
      const run = engine.triggerManual(definitionId, request('deadline-audit'), null)
      engine.tick(); await entered.promise
      cancelled = engine.cancel(run.id).catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(10)
      release.resolve(true)
      expect(await cancelled).toMatchObject({ message: 'task deadline audit failed' })
    } finally { release.resolve(true); await cancelled; log.mockRestore(); vi.useRealTimers() }
  })

  it('deduplicates stage operations and resource acquisitions and expires escaped capabilities', async () => {
    const { engine, db, turn } = setup()
    const acquire = vi.fn(async () => ({ handle: 'shared' }))
    const external = vi.fn(async () => 'confirmed')
    let escaped: TaskStage | undefined
    engine.register(definition({ resourceHandlers: { external: { acquire, reconcile: acquire, cleanup: async () => {} } },
      runSpecial: async (stage) => {
        escaped = stage
        const first = stage.resource('resource', 'external', {})
        expect(stage.resource('resource', 'external', {})).toBe(first)
        expect(() => stage.resource('resource', 'external', { changed: true })).toThrow('identity conflict')
        expect(() => stage.resource('resource', 'other', {})).toThrow('identity conflict')
        for (const key of ['', '@reserved']) expect(() => stage.operation(key, external, external)).toThrow('empty or reserved')
        const result = stage.operation('external', external, external)
        expect(stage.operation('external', external, external)).toBe(result)
        await first
        const value = await result
        return stage.run.checkpoint === null ? { kind: 'advance', checkpoint: true } : { kind: 'succeed', result: value }
      } }))
    const run = engine.triggerManual(definitionId, request('capabilities'), null)
    await turn()
    expect(() => escaped!.model('late', 'late')).toThrow('capability has expired')
    await turn()
    expect(db.run(run.id)?.result).toBe('confirmed')
    expect(acquire).toHaveBeenCalledOnce()
    expect(external).toHaveBeenCalledOnce()
  })

  it.each(['missing-handlers', 'empty-key'] as const)('rejects special dispatch with %s', async (mode) => {
    const { engine, db, turn } = setup()
    engine.register(definition({ ...(mode === 'empty-key' ? {
      businessKey: () => ' ', compareUpdate: () => 'ignore' as const,
      runOrdinary: async () => ({ kind: 'succeed' as const, result: null }),
    } : {}),
    runSpecial: async (stage) => { await stage.dispatch(request('child'), null); return { kind: 'succeed', result: null } },
    classifyError: (error, run) => ({ kind: 'block', checkpoint: run.checkpoint, reason: String(error) }) }))
    const run = engine.triggerManual(definitionId, request('dispatch'), null)
    await expect(engine.dispatch(run.id, request('not-running'), null)).rejects.toThrow('admitted special task')
    await turn()
    expect(db.run(run.id)?.reason).toContain(mode === 'empty-key' ? 'must not be empty' : 'cannot dispatch')
    expect(db.runs()).toHaveLength(1)
  })

  it('lets discovery cancel an associated ordinary execution without creating another Session', async () => {
    const { engine, db, sessions, turn } = setup()
    const abort = vi.spyOn(sessions, 'abort')
    engine.register(definition({ businessKey: () => 'same-business', compareUpdate: () => 'cancel',
      runOrdinary: async () => ({ kind: 'wait', checkpoint: true, prompt: 'Wait' }),
      runSpecial: async (stage) => {
        const first = await stage.dispatch(request('first'), 1)
        const second = await stage.dispatch(request('second'), 2)
        expect(second).toMatchObject({ outcome: 'associated', runId: first.runId, changed: true })
        return { kind: 'succeed', result: first.runId }
      } }))
    const parent = engine.triggerManual(definitionId, request('parent'), null)
    await turn(); await turn()
    const child = db.runs().find(run => run.kind === 'ordinary')!
    expect(child.status).toBe('cancelled')
    expect(abort).toHaveBeenCalledWith(child.id)
    expect(db.run(parent.id)?.result).toBe(child.id)
  })

  it('rejects duplicate definitions, incomplete child handlers and invalid deployment configuration', async () => {
    const { engine } = setup()
    expect(() => { engine.register(definition({ runOrdinary: async () => ({ kind: 'succeed', result: null }) })) }).toThrow('businessKey and compareUpdate')
    expect(() => { engine.register(definition({ businessKey: () => 'key' })) }).toThrow('businessKey and compareUpdate')
    expect(() => { engine.register(definition({ config: { ...definition().config, workspacePath: 'relative' } })) }).toThrow('must be absolute')
    expect(() => { engine.register(definition({ config: { ...definition().config,
      schedule: { kind: 'scheduled', cron: 'invalid', timezone: 'UTC', misfire: 'all', overlap: 'queue' } } })) }).toThrow('calendar expression')
    engine.register(definition())
    expect(() => { engine.register(definition()) }).toThrow('already registered')
    expect(await engine.checkConfig(definitionId, definition().config, new AbortController().signal)).toEqual([])
    expect(await engine.formOptions(definitionId, 'field', definition().config, new AbortController().signal)).toEqual([])
    expect(() => { engine.updateConfig(definitionId, 1, { ...definition().config, schedule: { kind: 'polling', intervalMs: 100 } }) }).toThrow('trigger kind')
    expect(() => { engine.setEnabled(brandString<TaskDefinitionId>('missing'), true) }).toThrow('unknown task definition')
    expect(() => { engine.sendInput(brandString<TaskRun['id']>('missing'), request('missing'), null) }).toThrow('unknown task run')
    await engine.shutdown()
    engine.tick()
    expect(() => engine.triggerManual(definitionId, request('closed'), null)).toThrow('host is stopping')
    await engine.remove(definitionId)
  })

  it.each(['trigger', 'code', 'retiring-code', 'removed-schema', 'downgraded-schema', 'same-schema'] as const)('refuses incompatible %s replacements against saved work', async (change) => {
    const root = mkdtempSync(join(tmpdir(), 'task-registration-'))
    disposers.push(async () => { rmSync(root, { recursive: true, force: true }) })
    const first = setup(join(root, 'tasks.sqlite'))
    const original = definition({ forms: { version: 2, business: {}, input: {} } })
    first.engine.register(original)
    first.engine.triggerManual(definitionId, request('active'), null)
    if (change === 'retiring-code') first.engine.requestRetirement(definitionId)
    await first.close()
    const second = setup(join(root, 'tasks.sqlite'))
    const replacement = change === 'trigger' ? { ...original, config: { ...original.config, schedule: { kind: 'polling' as const, intervalMs: 100 } } }
      : change === 'code' || change === 'retiring-code' ? { ...original, codeVersion: '2' }
        : change === 'removed-schema' ? definition()
          : { ...original, forms: { version: change === 'downgraded-schema' ? 1 : 2, business: { type: 'null' }, input: {} } }
    expect(() => { second.engine.register(replacement) }).toThrow()
    expect(second.db.definitions()[0]?.codeVersion).toBe('1')
  })

  it.each(['priority', 'nonfinite-priority', 'stage-resources'] as const)('blocks admission after %s failure without acquiring permits', async (failure) => {
    const { engine, db, turn } = setup()
    engine.register(definition({ ...(failure === 'stage-resources'
      ? { stageResources: () => { throw new Error('resources unavailable') } }
      : { priority: () => { if (failure === 'priority') throw 'external failure'; return NaN } }) }))
    const run = engine.triggerManual(definitionId, request('bad-admission'), null)
    await turn()
    expect(db.run(run.id)?.status).toBe('blocked')
    expect(engine.diagnostics().activePermits).toBe(0)
    expect(db.journal(0).some(item => item.event === 'admission.error')).toBe(true)
  })

  it('advances through retry waiting and preserves the final business failure', async () => {
    const { engine, db, turn, advance } = setup()
    engine.register(definition({ runSpecial: async stage => stage.run.checkpoint === null
      ? { kind: 'advance', checkpoint: 'next' }
      : stage.run.checkpoint === 'next' ? { kind: 'retry', at: stage.run.updatedAt + 100, checkpoint: 'retry', reason: 'temporarily offline' }
        : { kind: 'fail', reason: 'business rejected' } }))
    const run = engine.triggerManual(definitionId, request('stages'), null)
    await turn(); expect(db.run(run.id)?.status).toBe('queued')
    await turn(); expect(db.run(run.id)?.status).toBe('waiting_retry')
    await turn(); expect(db.run(run.id)?.status).toBe('waiting_retry')
    advance(100); await turn()
    expect(db.run(run.id)).toMatchObject({ status: 'failed', reason: 'business rejected' })
    await engine.cancel(run.id)
    expect(() => { engine.sendInput(run.id, request('late'), null) }).toThrow('read-only')
  })

  it.each(['fail', 'classifier-error', 'invalid-retry', 'checkpoint-error'] as const)('contains %s while classifying a failed stage', async (mode) => {
    const { engine, db, turn } = setup()
    engine.register(definition({
      runSpecial: async () => { throw new Error('stage failure') },
      ...(mode === 'checkpoint-error' ? { parseCheckpoint: () => { throw 'checkpoint failure' } } : {}),
      classifyError: (_error, run) => {
        if (mode === 'classifier-error') throw new Error('classifier failed')
        if (mode === 'fail') return { kind: 'fail', reason: 'permanent' }
        if (mode === 'invalid-retry') return { kind: 'retry', at: run.updatedAt, checkpoint: null, reason: 'retry' }
        return { kind: 'block', checkpoint: null, reason: 'repair' }
      },
    }))
    const run = engine.triggerManual(definitionId, request('failure'), null)
    await turn()
    if (mode === 'fail') expect(db.run(run.id)).toMatchObject({ status: 'failed', reason: 'permanent' })
    else if (mode === 'classifier-error') expect(db.run(run.id)).toMatchObject({ status: 'blocked', reason: 'plugin error classifier failed; inspect task diagnostics' })
    else expect(db.journal(0).some(item => item.event === 'worker.failed')).toBe(true)
  })

  it('rejects future database generations and releases the host lock after opening fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'task-future-database-'))
    disposers.push(async () => { rmSync(root, { recursive: true, force: true }) })
    const path = join(root, 'tasks.sqlite')
    const raw = new DatabaseSync(path)
    try { raw.exec(`PRAGMA user_version=${SCHEMA_VERSION + 1}`) } finally { raw.close() }
    expect(() => new TaskDatabase(path)).toThrow('unsupported task database version')
    const owner = new DatabaseSync(`${path}.owner`)
    try { expect(() => { owner.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE') }).not.toThrow() }
    finally { owner.close() }
  })

  it('releases its lock when the filesystem rejects database creation', () => {
    const root = mkdtempSync(join(tmpdir(), 'task-unwritable-database-'))
    disposers.push(async () => { rmSync(root, { recursive: true, force: true }) })
    const path = join(root, 'tasks.sqlite')
    const failure = Object.assign(new Error('Read-only filesystem'), { code: 'EROFS' })
    const open = vi.spyOn(fs, 'openSync').mockImplementationOnce(() => { throw failure })
    try { expect(() => new TaskDatabase(path)).toThrow(failure) }
    finally { open.mockRestore() }
    const db = new TaskDatabase(path)
    db.close()
    db.close()
  })

  it('retains private plugin recovery evidence and rejects unavailable page anchors', () => {
    const { db } = setup()
    expect(db.pluginSource(definitionId)).toBeUndefined()
    db.putPluginSource(definitionId, { module: 'file:///business.mjs', config: null })
    db.putPluginSource(definitionId, { module: 'file:///updated.mjs', config: { enabled: true } })
    expect(db.pluginSource(definitionId)).toEqual({ module: 'file:///updated.mjs', config: { enabled: true } })
    expect(db.queryRuns({ limit: 1 })).toEqual({ items: [], head: null, hasMore: false })
    expect(() => db.queryRuns({ limit: 1, head: brandString<TaskRun['id']>('missing') })).toThrow('anchor is unavailable')
  })

  it('resolves retained revision owners and aggregates shared and exclusive resource holders', () => {
    const { db, engine } = setup()
    engine.register(definition())
    const first = engine.triggerManual(definitionId, request('holder-one'), null)
    const second = engine.triggerManual(definitionId, request('holder-two'), null)
    expect(db.revisionOwner({ ...first, configRevision: first.configRevision + 1 }).configRevision).toBe(first.configRevision + 1)
    expect(db.revisionOwner(second).id).toBe(first.id)
    expect(db.forSession('absent')).toBeUndefined()
    expect(db.forSession(first.sessionId)?.id).toBe(first.id)
    expect(db.observation(first.id)).toBeNull()
    db.observe(first.id, { revision: 1 })
    expect(db.observation(first.id)).toEqual({ revision: 1 })
    expect(db.acquire({ ...first, resources: ['exclusive', 'shared'] }, [], { shared: 2 })).toBe(true)
    expect(db.acquire({ ...second, resources: ['shared'] }, [], { shared: 2 })).toBe(true)
    const diagnostics = db.diagnostics({ shared: 2 })
    expect(diagnostics.resources).toEqual([
      { name: 'exclusive', capacity: 1, runIds: [first.id] },
      { name: 'shared', capacity: 2, runIds: [first.id, second.id].sort() },
    ])
    expect(diagnostics).toMatchObject({ totalRuns: 2, activeRuns: 2, queuedRuns: 2 })
  })

  it('compares nested idempotency data by object keys while preserving array order', () => {
    const { db } = setup()
    db.putReceipt('nested', 'same', { z: [1, { b: false, a: null }], a: true }, 'saved')
    expect(db.receipt('nested', 'same', { a: true, z: [1, { a: null, b: false }] })).toBe('saved')
    expect(() => db.receipt('nested', 'same', { a: true, z: [{ a: null, b: false }, 1] })).toThrow('different input')
  })

  it('reconciles ready resources before reusing them after a host restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'task-resource-restart-'))
    disposers.push(async () => { rmSync(root, { recursive: true, force: true }) })
    const path = join(root, 'tasks.sqlite')
    const first = setup(path)
    first.engine.register(definition())
    const run = first.engine.triggerManual(definitionId, request('resource-restart'), null)
    first.db.putResource({ runId: run.id, key: 'browser', type: 'browser', request: {}, value: 'old-handle', state: 'ready' })
    first.db.putResource({ runId: run.id, key: 'unconfirmed', type: 'browser', request: {}, value: null, state: 'prepared' })
    await first.close()
    const second = setup(path)
    expect(second.db.managedResources(run.id)[0]?.state).toBe('prepared')
    const acquire = vi.fn(async () => 'new-handle')
    const reconcile = vi.fn(async () => 'reconnected-handle')
    second.engine.register(definition({ resourceHandlers: { browser: { acquire, reconcile, cleanup: async () => {} } },
      runSpecial: async stage => ({ kind: 'succeed', result: await stage.resource('browser', 'browser', {}) }) }))
    await second.turn()
    expect(acquire).not.toHaveBeenCalled()
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(second.db.run(run.id)?.result).toBe('reconnected-handle')
  })

  it('admits and replays retirement atomically while rejecting a stale definition revision', async () => {
    const { engine, db } = setup()
    engine.register(definition())
    engine.triggerManual(definitionId, request('retired-run'), null)
    const command: TaskCommand = { kind: 'retire', definitionId, revision: db.definitions()[0]!.revision }
    const receipt = engine.command(principal, request('retire-command'), command)
    expect(receipt.kind).toBe('retirement')
    await engine.drain()
    expect(db.retirement(definitionId)?.state).toBe('complete')
    expect(engine.command(principal, request('retire-command'), command)).toEqual(receipt)
    expect(() => engine.command(principal, request('stale-retire'), command)).toThrow('revision conflict')
  })

  it('keeps history pages bounded to their initial head and reports filter changes', async () => {
    const { engine, db } = setup()
    engine.register(definition())
    const first = engine.triggerManual(definitionId, request('page-one'), null)
    const second = engine.triggerManual(definitionId, request('page-two'), null)
    const initial = db.queryRuns({ limit: 1, status: ['provisioning'] })
    expect(initial.items.map(run => run.id)).toEqual([second.id])
    engine.triggerManual(definitionId, request('page-three'), null)
    const next = db.queryRuns({ limit: 1, head: initial.head!, after: second.id, status: ['provisioning'] })
    expect(next.items.map(run => run.id)).toEqual([first.id])
    expect(next.hasMore).toBe(false)
    expect(db.queryRuns({ limit: 5, status: [] }).items).toEqual([])
    expect(db.queryRuns({ limit: 5, parentRunId: first.id }).items).toEqual([])
    await engine.cancel(second.id)
    expect(db.queryRuns({ limit: 5, status: ['cancelled', 'provisioning'] }).items).toHaveLength(3)
    expect(() => db.queryRuns({ limit: 1, head: initial.head!, after: second.id, status: ['provisioning'] })).toThrow('membership changed')
    expect(engine.diagnostics()).toMatchObject({ totalRuns: 3, activeRuns: 2, completedRuns: 1, queuedRuns: 2, activePermits: 0 })
  })

  it('shares concurrent acquisition calls and records each resource cleanup before releasing locks', async () => {
    const { engine, db, turn } = setup()
    const acquire = vi.fn(async () => 'handle')
    const cleanup = vi.fn(async () => {})
    engine.register(definition({ resourceHandlers: { browser: { acquire, reconcile: acquire, cleanup } },
      runSpecial: async (stage) => {
        expect(await Promise.all([stage.resource('browser', 'browser', {}), stage.resource('browser', 'browser', {})])).toEqual(['handle', 'handle'])
        return { kind: 'succeed', result: null }
      } }))
    const run = engine.triggerManual(definitionId, request('managed'), null)
    await turn()
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(db.managedResources(run.id)[0]?.state).toBe('released')
    expect(db.run(run.id)?.status).toBe('succeeded')
  })

  it('recovers a blocked retirement with its original code before allowing replacement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'task-retirement-'))
    disposers.push(async () => { rmSync(root, { recursive: true, force: true }) })
    const path = join(root, 'tasks.sqlite')
    const first = setup(path)
    first.engine.register(definition({ cleanup: async () => { throw new Error('resource remains live') } }))
    const run = first.engine.triggerManual(definitionId, request('retirement'), null)
    await expect(first.engine.remove(definitionId)).rejects.toThrow()
    expect(first.db.retirement(definitionId)?.state).toBe('blocked')
    await first.close()
    const second = setup(path)
    expect(() =>{  second.engine.register(definition({ codeVersion: '2' })) }).toThrow('original plugin code')
    second.engine.recoverRetirements()
    expect(second.db.journal(0).some(entry => entry.event === 'retirement.code-missing')).toBe(true)
    second.engine.register(definition())
    expect(() =>{  second.engine.setEnabled(definitionId, true) }).toThrow('retirement')
    second.engine.recoverRetirements()
    await second.engine.remove(definitionId)
    expect(second.db.run(run.id)).toMatchObject({ status: 'cancelled', cleanup: 'complete' })
    expect(second.db.retirement(definitionId)?.state).toBe('complete')
    expect(typeof second.db.retirement(definitionId)?.completedAt).toBe('number')
    second.engine.register(definition({ codeVersion: '2' }))
  })

  it('enforces resource capacities across waiting runs until cleanup releases ownership', async () => {
    const { engine, db, turn } = setup(':memory:', 4, { resourceCapacities: { browser: 2 } })
    const base = definition()
    engine.register(definition({ config: { ...base.config, concurrency: 4 }, resources: () => ['browser'],
      runSpecial: async () => ({ kind: 'wait', checkpoint: null, prompt: 'review' }) }))
    const runs = ['one', 'two', 'three'].map(id => engine.triggerManual(definitionId, request(id), null))
    await turn()
    expect(runs.map(run => db.run(run.id)?.status)).toEqual(['waiting_input', 'waiting_input', 'provisioning'])
    await engine.cancel(runs[0]!.id)
    await turn()
    expect(db.run(runs[2]!.id)?.status).toBe('waiting_input')
  })

  it.each(['cancel', 'command', 'shutdown'] as const)('records %s timeout while retaining the drain barrier', async (mode) => {
    vi.useFakeTimers()
    const { engine, db } = setup(':memory:', 1, { cancellationGraceMs: 10, shutdownTimeoutMs: 10 })
    let enter: (() => void) | undefined
    let release: (() => void) | undefined
    const entered = new Promise<void>((resolve) => { enter = resolve })
    engine.register(definition({ runSpecial: async () => {
      enter?.()
      await new Promise<void>((resolve) => { release = resolve })
      return { kind: 'succeed', result: null }
    } }))
    let stopping: Promise<void> | undefined
    try {
      const run = engine.triggerManual(definitionId, request(mode), null)
      engine.tick()
      await entered
      let done = false
      if (mode === 'command')
        engine.command(principal, request('cancel-command'), { kind: 'cancel', runId: run.id })
      stopping = (mode === 'shutdown' ? engine.shutdown() : engine.cancel(run.id)).then(() => { done = true })
      await vi.advanceTimersByTimeAsync(10)
      expect(done).toBe(false)
      expect(db.run(run.id)?.terminalAt).toBeNull()
      expect(db.journal(0).some(entry => entry.event === `${mode === 'shutdown' ? 'shutdown' : 'cancel'}.timeout`)).toBe(true)
      release?.()
      await stopping
      expect(db.run(run.id)?.status).toBe(mode === 'shutdown' ? 'recovering' : 'cancelled')
    } finally { release?.(); await stopping; vi.useRealTimers() }
  })

  it('retains resource locks when cleanup exceeds its deadline', async () => {
    vi.useFakeTimers()
    const { engine, db } = setup(':memory:', 1, { cleanupTimeoutMs: 10 })
    let entered: (() => void) | undefined
    const started = new Promise<void>((resolve) => { entered = resolve })
    engine.register(definition({
      resources: () => ['exclusive'],
      cleanup: async (_run, signal) => {
        entered?.()
        await new Promise<void>((resolve) => { signal.addEventListener('abort', () =>{  resolve() }, { once: true }) })
      },
    }))
    try {
      const run = engine.triggerManual(definitionId, request('cleanup-timeout'), null)
      engine.tick()
      await started
      await vi.advanceTimersByTimeAsync(10)
      await engine.drain()
      expect(db.run(run.id)).toMatchObject({ status: 'blocked', cleanup: 'blocked', terminalAt: null })
      expect(db.journal(0).some(entry => entry.event === 'cleanup.timeout')).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it('ages waiting priority with a cap and preserves FIFO ties', async () => {
    const { engine, advance, turn } = setup(':memory:', 1, { priorityAgingCap: 2 })
    const admitted: string[] = []
    engine.register(definition({
      priority: run => Number(run.input),
      runSpecial: async (stage) => { admitted.push(stage.run.id); return { kind: 'succeed', result: null } },
    }))
    const old = engine.triggerManual(definitionId, request('old'), 0)
    advance(600_000)
    const urgent = engine.triggerManual(definitionId, request('urgent'), 3)
    const tied = engine.triggerManual(definitionId, request('tied'), 2)
    await turn()
    expect(admitted).toEqual([urgent.id])
    await turn()
    expect(admitted).toEqual([urgent.id, old.id])
    await turn()
    expect(admitted).toEqual([urgent.id, old.id, tied.id])
  })

  it('coalesces a missed range across bounded scans and survives a pending-run limit', async () => {
    const { engine, db, turn, advance } = setup(':memory:', 1, { catchupLimit: 2, pendingLimit: 1 })
    const base = definition()
    engine.register(definition({
      config: { ...base.config, schedule: { kind: 'scheduled', cron: '* * * * *', timezone: 'UTC', misfire: 'coalesce', overlap: 'queue' } },
      runSpecial: async () => ({ kind: 'wait', checkpoint: null, prompt: 'review' }),
    }))
    advance(60_000); await turn()
    const first = db.runs()[0]!
    advance(300_000); await turn(); await turn(); await turn()
    expect(db.runs()).toHaveLength(1)
    expect(db.calendarScan(definitionId)).toMatchObject({ count: 5, pressured: true })
    await turn()
    expect(db.calendarScan(definitionId)?.count).toBe(5)
    await engine.cancel(first.id)
    await turn()
    expect(db.runs()[1]?.input).toMatchObject({ missedCount: 5 })
    expect(db.calendarScan(definitionId)).toBeUndefined()
  })

  it('records the horizon skip and keeps the all-policy cursor at unmaterialized work', async () => {
    const { engine, db, turn, advance } = setup(':memory:', 1, { catchupHorizonMs: 180_000, pendingLimit: 1 })
    const base = definition()
    engine.register(definition({
      config: { ...base.config, schedule: { kind: 'scheduled', cron: '* * * * *', timezone: 'UTC', misfire: 'all', overlap: 'queue' } },
      runSpecial: async () => ({ kind: 'wait', checkpoint: null, prompt: 'review' }),
    }))
    advance(600_000); await turn()
    expect(db.runs()).toHaveLength(1)
    const due = db.definitions()[0]?.nextDueAt
    await turn()
    expect(db.definitions()[0]?.nextDueAt).toBe(due)
    expect(db.journal(0).filter(entry => entry.event === 'calendar.horizon-skipped')).toHaveLength(1)
    await engine.cancel(db.runs()[0]!.id)
    await turn()
    expect(db.runs()[1]?.input).toMatchObject({ scheduledAt: due })
  })

  it('disables a failing schedule without starving another plugin', async () => {
    const { engine, db, turn } = setup()
    const base = definition()
    engine.register(definition({
      config: { ...base.config, schedule: { kind: 'polling', intervalMs: 1000 } },
      parseInput: () => { throw new Error('invalid source configuration') },
    }))
    const healthy = definition({ id: brandString<TaskDefinitionId>('healthy') })
    engine.register(healthy)
    const run = engine.triggerManual(healthy.id, request('start'), null)
    await turn()
    expect(db.run(run.id)?.status).toBe('succeeded')
    expect(db.definitions().find(value => value.id === definitionId)?.enabled).toBe(false)
    expect(db.journal(0).some(entry => entry.event === 'schedule.blocked')).toBe(true)
  })

  it('releases compiler reservations at a business wait while retaining the run worktree', async () => {
    const { engine, db, turn } = setup(':memory:', 1)
    engine.register(definition({
      resources: input => [`worktree:${JSON.stringify(input)}`], stageResources: () => ['compiler'],
      runSpecial: async () => ({ kind: 'wait', checkpoint: null, prompt: 'review build' }),
    }))
    engine.triggerManual(definitionId, request('first'), 'first')
    engine.triggerManual(definitionId, request('second'), 'second')
    await turn(); await turn()
    expect(db.runs().map(run => run.status)).toEqual(['waiting_input', 'waiting_input'])
  })

  it.each(['all', 'coalesce', 'skip'] as const)('records calendar catchup with the %s policy', async (misfire) => {
    const { engine, db, turn, advance } = setup()
    const base = definition()
    engine.register(definition({
      config: { ...base.config, schedule: { kind: 'scheduled', cron: '* * * * *', timezone: 'UTC', misfire, overlap: 'queue' } },
      runSpecial: async () => ({ kind: 'wait', checkpoint: null, prompt: 'review period' }),
    }))
    advance(185_000)
    await turn()
    const runs = db.runs()
    expect(runs).toHaveLength(misfire === 'all' ? 3 : misfire === 'coalesce' ? 1 : 0)
    if (misfire === 'all') expect(runs.map(run => run.status)).toEqual(['waiting_input', 'provisioning', 'provisioning'])
    if (misfire === 'coalesce') {
      expect(runs[0]?.input).toMatchObject({ missedCount: 3 })
      expect(runs[0]?.occurrence).toEqual({ scheduledAt: Date.UTC(2026, 8, 10, 0, 3),
        missed: { from: Date.UTC(2026, 8, 10, 0, 1), through: Date.UTC(2026, 8, 10, 0, 3), count: 3 } })
    }
    if (misfire === 'all') expect(runs.map(run => run.occurrence?.scheduledAt))
      .toEqual([1, 2, 3].map(minute => Date.UTC(2026, 8, 10, 0, minute)))
    expect(db.journal(0).some(entry => entry.event === 'calendar.scanned')).toBe(true)
    await turn()
    expect(db.runs()).toHaveLength(runs.length)
  })

  it('reserves one Session across duplicate manual commands and refuses changed request data', async () => {
    const { engine, db, turn, log } = setup()
    engine.register(definition())
    const run = engine.triggerManual(definitionId, request('manual'), { id: 1 })
    expect(engine.triggerManual(definitionId, request('manual'), { id: 1 }).sessionId).toBe(run.sessionId)
    expect(() => engine.triggerManual(definitionId, request('manual'), { id: 2 })).toThrow('different input')
    await turn()
    expect(db.run(run.id)).toMatchObject({ status: 'succeeded', cleanup: 'complete' })
    expect(log).toHaveBeenCalledWith('run.ended', expect.anything())
    expect(db.journal(0).map(entry => entry.event)).toContain('stage.started')
  })

  it('lets dispatched work outlive its parent and inherits its exact config revision', async () => {
    const { engine, db, turn } = setup()
    const plugin = definition({
      runSpecial: async (stage) => {
        await stage.dispatch(request('bug'), { id: 123 })
        return { kind: 'succeed', result: null }
      },
      runOrdinary: async () => ({ kind: 'wait', checkpoint: 'review', prompt: 'approve?' }),
      businessKey: input => String((input as { id: number }).id), compareUpdate: () => 'ignore',
    })
    engine.register(plugin)
    const parent = engine.triggerManual(definitionId, request('start'), null)
    engine.updateConfig(definitionId, 1, { ...plugin.config, business: { new: true } })
    await turn()
    const child = db.runs().find(run => run.kind === 'ordinary')!
    expect(child).toMatchObject({ parentRunId: parent.id, configRevision: 1, config: { business: null } })
    expect(child.sessionId).not.toBe(parent.sessionId)
    expect(db.run(parent.id)?.status).toBe('succeeded')
    await turn()
    expect(db.run(child.id)?.status).toBe('waiting_input')
  })

  it('atomically associates unfinished business work and creates a successor only after terminal cleanup', async () => {
    const { engine, db, turn } = setup()
    const receipts: unknown[] = []
    engine.register(definition({
      runSpecial: async (stage) => {
        receipts.push(await stage.dispatch(request('bug'), { id: 1 }))
        receipts.push(await stage.dispatch(request('bug'), { id: 1 }))
        return { kind: 'succeed', result: null }
      },
      runOrdinary: async () => ({ kind: 'wait', checkpoint: null, prompt: '?' }),
      businessKey: () => '1', compareUpdate: () => 'ignore',
    }))
    engine.triggerManual(definitionId, request('first'), null)
    engine.triggerManual(definitionId, request('second'), null)
    await turn()
    expect(db.runs().filter(run => run.kind === 'ordinary')).toHaveLength(1)
    expect(receipts[0]).toEqual(receipts[2])
    const child = db.runs().find(run => run.kind === 'ordinary')!
    await engine.cancel(child.id)
    engine.triggerManual(definitionId, request('third'), null)
    await turn()
    expect(db.runs().filter(run => run.kind === 'ordinary')).toHaveLength(2)
  })

  it('associates rediscovery without reviving ordinary work whose cleanup is blocked', async () => {
    const { engine, db, turn } = setup()
    const receipts: unknown[] = []
    const runOrdinary = vi.fn(async () => ({ kind: 'wait' as const, checkpoint: null, prompt: '?' }))
    const compareUpdate = vi.fn(() => 'update' as const)
    engine.register(definition({
      runSpecial: async (stage) => {
        receipts.push(await stage.dispatch(request('bug'), { version: stage.run.input }))
        return { kind: 'succeed', result: null }
      },
      runOrdinary,
      businessKey: () => 'bug', compareUpdate,
      cleanup: async (run) => { if (run.kind === 'ordinary') throw new Error('resource remains live') },
    }))
    engine.triggerManual(definitionId, request('first'), 1)
    await turn(); await turn()
    const child = db.runs().find(run => run.kind === 'ordinary')!
    expect(runOrdinary).toHaveBeenCalledOnce()
    await expect(engine.cancel(child.id)).rejects.toThrow('resource remains live')
    expect(db.run(child.id)).toMatchObject({ status: 'blocked', cleanup: 'blocked' })

    engine.triggerManual(definitionId, request('second'), 2)
    await turn(); await turn()
    expect(receipts[1]).toMatchObject({ outcome: 'associated', runId: child.id, changed: false })
    expect(db.run(child.id)).toMatchObject({ status: 'blocked', cleanup: 'blocked' })
    expect(db.observation(child.id)).toEqual({ version: 1 })
    expect(db.runs().filter(run => run.kind === 'ordinary')).toHaveLength(1)
    expect(compareUpdate).not.toHaveBeenCalled()
    expect(runOrdinary).toHaveBeenCalledOnce()
  })

  it('associates rediscovery without delivering updates to a cancelling ordinary run', async () => {
    const { engine, db, turn } = setup()
    const releaseCleanup = Promise.withResolvers<undefined>()
    const receipts: unknown[] = []
    const compareUpdate = vi.fn(() => 'update' as const)
    engine.register(definition({
      runSpecial: async (stage) => {
        receipts.push(await stage.dispatch(request('bug'), stage.run.input))
        return { kind: 'succeed', result: null }
      },
      runOrdinary: async () => ({ kind: 'wait', checkpoint: null, prompt: '?' }),
      businessKey: () => 'bug', compareUpdate,
      cleanup: async (run) => { if (run.kind === 'ordinary') await releaseCleanup.promise },
    }))
    engine.triggerManual(definitionId, request('first'), 1)
    await turn(); await turn()
    const child = db.runs().find(run => run.kind === 'ordinary')!
    const cancelled = engine.cancel(child.id)
    try {
      expect(db.run(child.id)?.status).toBe('cancelling')
      engine.triggerManual(definitionId, request('second'), 2)
      engine.tick()
      await expect.poll(() => receipts.length).toBe(2)
      expect(receipts[1]).toMatchObject({ outcome: 'associated', runId: child.id, changed: false })
      expect(db.run(child.id)?.status).toBe('cancelling')
      expect(db.observation(child.id)).toBe(1)
      expect(compareUpdate).not.toHaveBeenCalled()
    } finally {
      releaseCleanup.resolve(undefined)
      await cancelled
      await engine.drain()
    }
    expect(db.run(child.id)?.status).toBe('cancelled')
  })

  it('ignores unchanged discoveries and invalidates an old confirmation on a meaningful update', async () => {
    const { engine, db, turn } = setup()
    let version = 1
    engine.register(definition({
      runSpecial: async (stage) => { await stage.dispatch(request('bug'), { version }); return { kind: 'succeed', result: null } },
      runOrdinary: async stage => ({ kind: 'wait', checkpoint: stage.inputs.length, prompt: 'approve?' }),
      businessKey: () => 'bug', compareUpdate: (previous, incoming) => JSON.stringify(previous) === JSON.stringify(incoming) ? 'ignore' : 'update',
    }))
    engine.triggerManual(definitionId, request('first'), null)
    await turn(); await turn()
    const child = db.runs().find(run => run.kind === 'ordinary')!
    const wait = child.wait!
    engine.triggerManual(definitionId, request('same'), null)
    await turn()
    expect(db.run(child.id)?.wait).toEqual(wait)
    version = 2
    engine.triggerManual(definitionId, request('changed'), null)
    await turn()
    expect(() =>{  engine.respond(child.id, wait.id, wait.revision, request('response'), true) }).toThrow('stale')
    await turn()
    expect(db.run(child.id)?.checkpoint).toBe(1)
    expect(db.run(child.id)?.wait?.id).not.toBe(wait.id)
  })

  it('rejects ordinary and expired stage dispatch authority', async () => {
    const { engine, db, turn } = setup()
    let parentStage: TaskStage | undefined
    engine.register(definition({
      runSpecial: async (stage) => { parentStage = stage; await stage.dispatch(request('child'), null); return { kind: 'succeed', result: null } },
      runOrdinary: async (stage) => {
        await expect(stage.dispatch(request('grandchild'), null)).rejects.toThrow('special')
        return { kind: 'succeed', result: null }
      }, businessKey: () => 'one', compareUpdate: () => 'ignore',
    }))
    engine.triggerManual(definitionId, request('first'), null)
    await turn(); await turn()
    expect(() => parentStage!.dispatch(request('late'), null)).toThrow('expired')
    expect(db.runs()).toHaveLength(2)
  })

  it('releases execution slots while waiting but retains exclusive resources until cleanup', async () => {
    const { engine, db, turn } = setup(':memory:', 1)
    engine.register(definition({ resources: () => ['repo:one'], runSpecial: async () => ({ kind: 'wait', checkpoint: null, prompt: '?' }) }))
    const first = engine.triggerManual(definitionId, request('a'), null)
    const second = engine.triggerManual(definitionId, request('b'), null)
    await turn(); await turn()
    const waiting = db.runs().find(run => run.status === 'waiting_input')!
    expect(db.runs().filter(run => run.status === 'provisioning')).toHaveLength(1)
    await engine.cancel(waiting.id)
    await turn()
    expect(db.runs().filter(run => run.status === 'waiting_input')).toHaveLength(1)
    expect(new Set([first.sessionId, second.sessionId]).size).toBe(2)
  })

  it('preserves checkpoint and Session identity through a host restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-task-'))
    disposers.push(async () => { rmSync(directory, { recursive: true, force: true }) })
    const first = setup(join(directory, 'tasks.sqlite'))
    const plugin = definition({ runSpecial: async stage => stage.run.checkpoint === null
      ? { kind: 'wait', checkpoint: 'review', prompt: '?' }
      : { kind: 'succeed', result: stage.inputs[0]!.value } })
    first.engine.register(plugin)
    const run = first.engine.triggerManual(definitionId, request('first'), null)
    await first.turn()
    const wait = first.db.run(run.id)!.wait!
    await first.close()
    const second = setup(join(directory, 'tasks.sqlite'))
    second.engine.register(plugin)
    second.engine.respond(run.id, wait.id, wait.revision, request('response'), 'approved')
    await second.turn()
    expect(second.db.run(run.id)).toMatchObject({ sessionId: run.sessionId, status: 'succeeded', result: 'approved' })
    expect(() =>{  second.engine.sendInput(run.id, request('late'), 'again') }).toThrow('read-only')
  })

  it('does not overlap polling and waits from completion rather than trigger time', async () => {
    const { engine, db, turn, advance } = setup()
    const base = definition()
    engine.register(definition({ config: { ...base.config, schedule: { kind: 'polling', intervalMs: 1000 } }, runSpecial: async () => ({ kind: 'wait', checkpoint: null, prompt: '?' }) }))
    await turn()
    advance(5000); await turn()
    expect(db.runs()).toHaveLength(1)
    await engine.cancel(db.runs()[0]!.id)
    advance(999); await turn()
    expect(db.runs()).toHaveLength(1)
    advance(1); await turn()
    expect(db.runs()).toHaveLength(2)
  })

  it('retains uncertain external operations and reconciles instead of executing a second write', async () => {
    const { engine, db, turn } = setup()
    const execute = vi.fn(async () => { throw new Error('connection lost after submission') })
    const reconcile = vi.fn(async () => 'already submitted')
    engine.register(definition({ runSpecial: async stage => ({ kind: 'succeed', result: await stage.operation('submit', execute, reconcile) }) }))
    const run = engine.triggerManual(definitionId, request('first'), null)
    await turn()
    expect(db.run(run.id)?.status).toBe('blocked')
    engine.sendInput(run.id, request('retry'), null)
    await turn()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(db.run(run.id)?.result).toBe('already submitted')
  })

  it('refuses a second host and releases ownership when its database closes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-task-lock-'))
    disposers.push(async () => { rmSync(directory, { recursive: true, force: true }) })
    const path = join(directory, 'tasks.sqlite')
    const first = setup(path)
    expect(() => new TaskDatabase(path)).toThrow('active host')
    await first.close()
    const second = setup(path)
    expect(second.db.runs()).toEqual([])
  })

  it('blocks resource release when plugin cleanup fails', async () => {
    const { engine, db, turn } = setup()
    const cleanup = vi.fn().mockRejectedValueOnce(new Error('resource still live')).mockResolvedValue(undefined)
    engine.register(definition({ cleanup, resources: () => ['browser:one'] }))
    const run = engine.triggerManual(definitionId, request('first'), null)
    await turn()
    expect(db.run(run.id)).toMatchObject({ status: 'blocked', cleanup: 'blocked', terminalAt: null,
      outcome: 'succeeded', result: 'done', reason: 'resource cleanup failed; retry cleanup after repair' })
    await engine.cancel(run.id)
    expect(db.run(run.id)).toMatchObject({ status: 'succeeded', outcome: 'succeeded', result: 'done', cleanup: 'complete' })
  })

  it('retries blocked cleanup through a command that keeps the recorded outcome', async () => {
    const { engine, db, turn } = setup()
    const cleanup = vi.fn().mockRejectedValueOnce(new Error('first attempt'))
      .mockRejectedValueOnce(new Error('second attempt')).mockResolvedValue(undefined)
    engine.register(definition({ cleanup, runSpecial: async () => ({ kind: 'fail', reason: 'business rejected' }) }))
    const principal = brandString<TaskPrincipalId>('owner')
    const run = engine.triggerManual(definitionId, request('failed-run'), null)
    expect(() => engine.command(principal, request('not-blocked'), { kind: 'cleanup', runId: run.id }))
      .toThrow('cleanup is not blocked')
    await turn()
    expect(db.run(run.id)).toMatchObject({ status: 'blocked', cleanup: 'blocked', outcome: 'failed' })
    expect(engine.command(principal, request('retry-1'), { kind: 'cleanup', runId: run.id }))
      .toEqual({ kind: 'cancellation', runId: run.id, status: 'cancelling' })
    await expect.poll(() => cleanup.mock.calls.length).toBe(2)
    await engine.drain()
    expect(db.run(run.id)).toMatchObject({ status: 'blocked', cleanup: 'blocked', outcome: 'failed' })
    engine.command(principal, request('retry-2'), { kind: 'cleanup', runId: run.id })
    await engine.drain()
    expect(db.run(run.id)).toMatchObject({ status: 'failed', outcome: 'failed', reason: 'business rejected', cleanup: 'complete' })
    expect(db.journal(0).filter(entry => entry.event === 'cleanup.retry')).toHaveLength(2)
    expect(() => engine.command(principal, request('ended'), { kind: 'cleanup', runId: run.id })).toThrow('read-only')
  })

  it('cancels in-flight work on plugin removal but preserves it on host shutdown', async () => {
    const { engine, db } = setup()
    const entered = Promise.withResolvers<undefined>()
    engine.register(definition({ runSpecial: async (stage) => {
      entered.resolve(undefined)
      await new Promise<void>((resolve) =>{  stage.signal.addEventListener('abort', () =>{  resolve() }, { once: true }) })
      return { kind: 'succeed', result: 'must not commit' }
    } }))
    const run = engine.triggerManual(definitionId, request('first'), null)
    engine.tick(); await entered.promise
    await engine.remove(definitionId)
    expect(db.run(run.id)?.status).toBe('cancelled')
    expect(db.definitions()[0]?.installed).toBe(false)
  })

  it('rejects stale stage completion when new input arrived during execution', async () => {
    const { engine, db } = setup()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    engine.register(definition({ runSpecial: async () => { entered.resolve(undefined); await release.promise; return { kind: 'succeed', result: 'stale' } } }))
    const run = engine.triggerManual(definitionId, request('first'), null)
    engine.tick(); await entered.promise
    engine.sendInput(run.id, request('update'), 'changed')
    release.resolve(undefined); await engine.drain()
    expect(db.run(run.id)).toMatchObject({ status: 'queued', result: null })
  })
})

describe('calendar', () => {
  it('skips a nonexistent DST wall time and uses only the earlier repeated wall time', () => {
    const rule = { kind: 'scheduled', cron: '30 2 * * *', timezone: 'America/New_York', misfire: 'all', overlap: 'allow' } as const
    expect(nextCalendar(rule, Date.parse('2026-03-08T00:00:00Z'))).toBe(Date.parse('2026-03-09T06:30:00Z'))
    const autumn = { ...rule, cron: '30 1 * * *' }
    expect(nextCalendar(autumn, Date.parse('2026-11-01T00:00:00Z'))).toBe(Date.parse('2026-11-01T05:30:00Z'))
    expect(nextCalendar(autumn, Date.parse('2026-11-01T05:30:00Z'))).toBe(Date.parse('2026-11-02T06:30:00Z'))
  })
  it('computes a configured wall-clock occurrence in Asia/Shanghai', () => {
    expect(nextCalendar({ kind: 'scheduled', cron: '0 9 * * *', timezone: 'Asia/Shanghai', misfire: 'coalesce', overlap: 'queue' }, Date.UTC(2026, 8, 10, 0))).toBe(Date.UTC(2026, 8, 10, 1))
  })
  it('rejects unknown timezones and non-five-field expressions', () => {
    const rule = { kind: 'scheduled', cron: '* * * * *', timezone: 'invalid', misfire: 'all', overlap: 'allow' } as const
    expect(() => nextCalendar(rule, 0)).toThrow()
    expect(() => nextCalendar({ ...rule, timezone: 'UTC', cron: '* * * * * *' }, 0)).toThrow('five-field')
  })
})

const principal = brandString<TaskPrincipalId>('owner')

describe('atomic administrative commands', () => {
  it('bounds journal pages and exposes the committed head', () => {
    const { engine, db } = setup()
    expect(db.journalHead()).toBe(0)
    engine.register(definition())
    engine.command(principal, request('one'), { kind: 'trigger', definitionId, input: null })
    const first = db.journal(0, 1)
    expect(first).toHaveLength(1)
    const second = db.journal(first[0]!.sequence, 1)
    expect(second).toHaveLength(1)
    expect(second[0]!.sequence).toBeGreaterThan(first[0]!.sequence)
    expect(db.journalHead()).toBe(db.journal(0).at(-1)!.sequence)
  })
  it('replays the original admission snapshot after completion and database reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'task-command-'))
    disposers.push(async () => { rmSync(directory, { recursive: true, force: true }) })
    const path = join(directory, 'tasks.sqlite')
    const first = setup(path)
    first.engine.register(definition())
    const command: TaskCommand = { kind: 'trigger', definitionId, input: { a: 1, b: 2 } }
    const admitted = first.engine.command(principal, request('one'), command)
    expect(admitted).toMatchObject({ kind: 'run', run: { status: 'provisioning' } })
    await first.turn()
    expect(first.db.runs()[0]?.status).toBe('succeeded')
    await first.close()
    const second = setup(path)
    second.engine.register(definition())
    expect(second.engine.command(principal, request('one'), { ...command, input: { b: 2, a: 1 } })).toEqual(admitted)
    expect(second.db.runs()).toHaveLength(1)
    expect(second.db.journal(0).filter(entry => entry.event === 'command.admitted')).toHaveLength(1)
    expect(() => second.engine.command(principal, request('one'), { ...command, input: { a: 3 } })).toThrow('different input')
  })

  it('isolates caller retry keys and rejects reuse across operations', () => {
    const { engine, db } = setup()
    engine.register(definition())
    const command: TaskCommand = { kind: 'trigger', definitionId, input: null }
    engine.command(principal, request('one'), command)
    engine.command(brandString<TaskPrincipalId>('other'), request('one'), command)
    expect(db.runs()).toHaveLength(2)
    expect(() => engine.command(principal, request('one'), { kind: 'enable', definitionId, revision: 1, enabled: false })).toThrow('different input')
    expect(db.definitions()[0]?.enabled).toBe(true)
  })

  it('rolls back task rows, nested receipts, and diagnostics when receipt persistence fails', () => {
    const { engine, db, log } = setup()
    engine.register(definition())
    log.mockClear()
    const original = db.putReceipt.bind(db)
    const receipt = vi.spyOn(db, 'putReceipt').mockImplementation((scope, ...args) => {
      if (scope.startsWith('command:')) throw new Error('disk failure')
      original(scope, ...args)
    })
    const command: TaskCommand = { kind: 'trigger', definitionId, input: null }
    expect(() => engine.command(principal, request('one'), command)).toThrow('disk failure')
    expect(db.runs()).toEqual([])
    expect(db.journal(0).map(entry => entry.event)).toEqual(['definition.registered'])
    expect(log).not.toHaveBeenCalled()
    receipt.mockRestore()
    expect(engine.command(principal, request('one'), command)).toMatchObject({ kind: 'run' })
    expect(db.runs()).toHaveLength(1)
  })

  it('keeps enable revisions and replay responses independent of later configuration', () => {
    const { engine, db } = setup()
    const business = definition()
    engine.register(business)
    const command: TaskCommand = { kind: 'enable', definitionId, revision: 1, enabled: false }
    const first = engine.command(principal, request('disable'), command)
    expect(first).toMatchObject({ kind: 'definition', definition: { revision: 2, enabled: false } })
    expect(() => engine.command(principal, request('stale'), { ...command, enabled: true })).toThrow('revision conflict')
    engine.command(principal, request('configure'), { kind: 'configure', definitionId, revision: 2,
      config: { ...business.config, concurrency: 3 } })
    expect(db.definitions()[0]?.revision).toBe(3)
    expect(() => engine.command(principal, request('old'), { ...command, enabled: true }))
      .toThrow(expect.objectContaining({ name: 'TaskCommandError', code: 'revision_conflict', currentRevision: 3 }))
    expect(engine.command(principal, request('disable'), command)).toEqual(first)
  })

  it('persists cancellation admission before cleanup and replays it after termination', async () => {
    const { engine, db, turn } = setup()
    const cleanup = vi.fn(async () => {})
    engine.register(definition({ cleanup }))
    const run = engine.triggerManual(definitionId, request('start'), null)
    const command: TaskCommand = { kind: 'cancel', runId: run.id }
    const admitted = engine.command(principal, request('cancel'), command)
    expect(admitted).toEqual({ kind: 'cancellation', runId: run.id, status: 'cancelling' })
    expect(db.run(run.id)?.status).toBe('cancelling')
    expect(cleanup).not.toHaveBeenCalled()
    await turn()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(db.run(run.id)?.status).toBe('cancelled')
    expect(engine.command(principal, request('cancel'), command)).toEqual(admitted)
    expect(() => engine.command(principal, request('another'), command)).toThrow('read-only')
  })

  it('does not abort a running stage when cancellation admission rolls back', async () => {
    const { engine, db } = setup()
    let release!: () => void
    let entered!: () => void
    let signal!: AbortSignal
    const started = new Promise<void>((resolve) => { entered = resolve })
    const pending = new Promise<void>((resolve) => { release = resolve })
    const cleanup = vi.fn(async () => {})
    engine.register(definition({ cleanup, runSpecial: async (stage) => {
      signal = stage.signal
      entered()
      await pending
      return { kind: 'succeed', result: null }
    } }))
    const run = engine.triggerManual(definitionId, request('start'), null)
    engine.tick()
    await started
    try {
      const original = db.putReceipt.bind(db)
      const receipt = vi.spyOn(db, 'putReceipt').mockImplementation((scope, ...args) => {
        if (scope.startsWith('command:')) throw new Error('disk failure')
        original(scope, ...args)
      })
      try {
        expect(() => engine.command(principal, request('cancel'), { kind: 'cancel', runId: run.id })).toThrow('disk failure')
        expect(signal.aborted).toBe(false)
        expect(db.run(run.id)?.status).toBe('running')
      } finally { receipt.mockRestore() }
      engine.command(principal, request('cancel'), { kind: 'cancel', runId: run.id })
      expect(signal.aborted).toBe(true)
      expect(cleanup).not.toHaveBeenCalled()
    } finally { release(); await engine.drain() }
    expect(cleanup).toHaveBeenCalledOnce()
    expect(db.run(run.id)?.status).toBe('cancelled')
  })

  it('replays supplemental input and version-bound responses without delivering them twice', async () => {
    const { engine, db, turn } = setup()
    engine.register(definition({ runSpecial: async () => ({ kind: 'wait', checkpoint: null, prompt: 'review' }) }))
    const run = engine.triggerManual(definitionId, request('start'), null)
    await turn()
    const input: TaskCommand = { kind: 'input', runId: run.id, input: 'updated' }
    const admitted = engine.command(principal, request('input'), input)
    await turn()
    const wait = db.run(run.id)!.wait!
    expect(engine.command(principal, request('input'), input)).toEqual(admitted)
    expect(db.run(run.id)?.wait).toEqual(wait)
    const response: TaskCommand = { kind: 'respond', runId: run.id, waitId: wait.id, revision: wait.revision, response: true }
    const answered = engine.command(principal, request('reply'), response)
    expect(engine.command(principal, request('reply'), response)).toEqual(answered)
    expect(() => engine.command(principal, request('second-reply'), response)).toThrow('stale')
    expect(db.inputs(run.id, true).map(entry => entry.kind)).toEqual(['input', 'response'])
  })

  it('rolls back nested savepoints without publishing their observers', () => {
    const { db } = setup()
    const observed: string[] = []
    db.transaction(() => {
      db.afterCommit(() => { observed.push('outer') })
      expect(() => db.transaction(() => {
        db.putReceipt('test', 'rollback', null, true)
        db.afterCommit(() => { observed.push('rollback') })
        throw new Error('inner failure')
      })).toThrow('inner failure')
      db.transaction(() => {
        db.putReceipt('test', 'success', null, true)
        db.afterCommit(() => { observed.push('inner') })
      })
      expect(observed).toEqual([])
    })
    expect(db.receipt('test', 'rollback', null)).toBeUndefined()
    expect(db.receipt('test', 'success', null)).toBe(true)
    expect(observed).toEqual(['outer', 'inner'])
  })
})

describe('Task plugin code recovery', () => {
  it.each(['v1', 'v2'] as const)('captures the resolved module and evaluated configuration with a %s loader', async (version) => {
    const { engine, db } = setup()
    const root = mkdtempSync(join(tmpdir(), 'task-plugin-code-'))
    disposers.push(async () => { rmSync(root, { recursive: true, force: true }) })
    const module = pathToFileURL(join(root, 'business.mjs')).href
    const bytes = 'export function apply() {}\n'
    fs.writeFileSync(new URL(module), bytes)
    const ctx = new Context()
    disposers.push(async () => { await ctx.fiber.dispose() })
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    const code = new TaskPluginCode(ctx, db, engine)
    const resolve = vi.fn(() => ({ url: module, format: 'module' }))
    // Node's internal loader is the external dependency; Cordis owns the real entry and fiber.
    ctx.loader.internal = stub<ModuleLoader>({ version, resolveSync: resolve, import: async () => ({ apply() {} }) })
    const config = version === 'v1' ? null : { enabled: true }
    const id = await ctx.loader.root.create({ name: './business.mjs', config })
    const owner = ctx.loader.resolve(id).fiber!.ctx
    code.capture(owner, definitionId)
    expect(db.pluginSource(definitionId)).toEqual({ module, digest: createHash('sha256').update(bytes).digest('hex'), config })
    if (version === 'v1') expect(resolve).toHaveBeenCalledWith('./business.mjs', ctx.baseUrl, {})
    else expect(resolve).toHaveBeenCalledWith(ctx.baseUrl, { specifier: './business.mjs' })
    code.capture(ctx, definitionId)
    const loader = ctx.loader.internal
    ctx.loader.internal = undefined
    expect(() => { code.capture(owner, definitionId) }).toThrow('application module loader')
    ctx.loader.internal = loader
    Object.defineProperty(ctx.loader.root.tree.ctx, 'baseUrl', { value: undefined, configurable: true })
    expect(() => { code.capture(owner, definitionId) }).toThrow('resolution base')
  })

  it.each(['unchanged', 'changed', 'missing-loader', 'invalid-source', 'cleanup-failed'] as const)('recovers removed plugin cleanup with %s code evidence', async (mode) => {
    const root = mkdtempSync(join(tmpdir(), 'task-code-recovery-'))
    disposers.push(async () => { rmSync(root, { recursive: true, force: true }) })
    const module = pathToFileURL(join(root, 'business.mjs')).href
    const bytes = 'export function apply() {}\n'
    fs.writeFileSync(new URL(module), bytes)
    const first = setup(join(root, 'tasks.sqlite'))
    first.engine.register(definition())
    const run = first.engine.triggerManual(definitionId, request('removed-code'), null)
    first.db.putPluginSource(definitionId, { module, digest: createHash('sha256').update(bytes).digest('hex'), config: null })
    await first.close()
    const { engine, db } = setup(join(root, 'tasks.sqlite'))
    const ctx = new Context()
    disposers.push(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(Loader)
    const code = new TaskPluginCode(ctx, db, engine)
    const disposed = vi.fn()
    const cleanup = vi.fn(async () => {})
    if (mode === 'cleanup-failed') cleanup.mockRejectedValueOnce(new Error('resource unavailable'))
    const imported = vi.fn(async () => ({ apply(owner: Context) {
      code.capture(owner, definitionId)
      engine.register(definition({ cleanup }))
      owner.effect(() => disposed)
    } }))
    ctx.loader.internal = stub<ModuleLoader>({ version: 'v2', import: imported })
    if (mode === 'changed') fs.writeFileSync(new URL(module), 'changed')
    if (mode === 'missing-loader') ctx.loader.internal = undefined
    if (mode === 'invalid-source') db.putPluginSource(definitionId, {})
    await code.recover()
    await engine.drain()
    if (mode === 'cleanup-failed') {
      await expect.poll(() => db.retirement(definitionId)?.state).toBe('blocked')
      expect(disposed).not.toHaveBeenCalled()
      await code.recover()
      expect(disposed).not.toHaveBeenCalled()
      await engine.remove(definitionId)
      await Promise.all([code.flush(), code.flush()])
      expect(disposed).toHaveBeenCalledOnce()
      expect(imported).toHaveBeenCalledOnce()
    } else if (mode === 'unchanged') {
      await expect.poll(() => disposed.mock.calls.length).toBe(1)
      expect(db.run(run.id)?.status).toBe('cancelled')
      expect(db.retirement(definitionId)?.state).toBe('complete')
      expect(cleanup).toHaveBeenCalledOnce()
      await code.recover()
      expect(imported).toHaveBeenCalledOnce()
    } else {
      expect(imported).not.toHaveBeenCalled()
      expect(db.retirement(definitionId)?.state).not.toBe('complete')
      expect(db.run(run.id)?.terminalAt).toBeNull()
    }
  })
})

describe('Task forms and runtime interactions', () => {
  it('retains a committed answer when the caller aborts before promise settlement', async () => {
    const { db, engine } = setup()
    engine.register(definition())
    const run = engine.triggerManual(definitionId, request('answer-abort'), null)
    db.putRun({ ...run, status: 'running' })
    const controller = new AbortController()
    const answer = engine.interactions.ask(run.id,
      { source: 'agent_question', title: 'Choose', description: '', schema: {}, callId: null, questions: null, expiresAt: null }, controller.signal)
    const pending = db.interactions(run.id)[0]!
    engine.interactions.respond(run.id, pending.id, pending.revision, 'accepted')
    controller.abort()
    await expect(answer).resolves.toBe('accepted')
    expect(db.interactions(run.id)[0]).toMatchObject({ state: 'answered', answer: 'accepted' })
    expect(db.journal(0).some(item => item.event === 'interaction.withdrawn')).toBe(false)
  })
  it('withdraws persisted questions after restart without accepting their old answers', () => {
    const { db, engine } = setup()
    engine.register(definition())
    const run = engine.triggerManual(definitionId, request('interrupted-question'), null)
    const question = { id: brandString<import('@deepseek-ai/dsh-task').TaskWaitId>('interrupted'), runId: run.id,
      revision: 1, source: 'agent_question' as const, title: 'Choose', description: '', schema: {},
      callId: null, questions: null, expiresAt: null, createdAt: run.createdAt, state: 'waiting' as const, answer: null }
    db.putInteraction(question)
    db.putInteraction({ ...question, id: brandString<import('@deepseek-ai/dsh-task').TaskWaitId>('answered'), state: 'answered', answer: true })
    const audit = vi.fn()
    const interactions = new RuntimeInteractions(db, () => run.createdAt, audit)
    expect(db.interactions().map(item => item.state)).toEqual(['withdrawn', 'answered'])
    expect(audit).toHaveBeenCalledExactlyOnceWith(run.id, 'interaction.interrupted')
    expect(() => { interactions.respond(run.id, question.id, 1, true) }).toThrow('stale')
  })
  it.each(['expiry', 'revision', 'terminal'] as const)('withdraws live runtime questions on %s', async (change) => {
    const { db, engine, advance } = setup()
    engine.register(definition({ runSpecial: async stage => ({ kind: 'succeed', result: await engine.interactions.ask(stage.run.id,
      { source: 'agent_question', title: 'Choose', description: '', schema: {}, callId: null, questions: null, expiresAt: stage.run.createdAt + 100 }, stage.signal) }) }))
    const run = engine.triggerManual(definitionId, request('expired-question'), null)
    engine.tick()
    await expect.poll(() => db.interactions(run.id).length).toBe(1)
    const question = db.interactions(run.id)[0]!
    engine.interactions.expire()
    expect(db.interactions(run.id)[0]?.state).toBe('waiting')
    if (change === 'expiry') advance(101)
    else {
      const current = db.run(run.id)!
      db.putRun(change === 'revision' ? { ...current, inputRevision: current.inputRevision + 1 } : { ...current, status: 'cancelling' })
    }
    expect(() => { engine.interactions.respond(run.id, question.id, question.revision, true) }).toThrow('stale')
    engine.interactions.expire()
    await engine.drain()
    expect(db.interactions(run.id)[0]?.state).toBe('withdrawn')
    engine.interactions.expire()
    expect(db.journal(0).filter(item => item.event === 'interaction.withdrawn')).toHaveLength(1)
  })
  it('rejects runtime questions before admission and respects pre-aborted callers', async () => {
    const { engine } = setup()
    engine.register(definition())
    const run = engine.triggerManual(definitionId, request('not-admitted'), null)
    const question = { source: 'agent_question' as const, title: 'Choose', description: '', schema: {}, callId: null, questions: null, expiresAt: null }
    await expect(engine.interactions.ask(run.id, question, new AbortController().signal)).rejects.toThrow('admitted stage')
    await expect(engine.interactions.ask(brandString<import('@deepseek-ai/dsh-task').TaskRunId>('missing'), question,
      new AbortController().signal)).rejects.toThrow('admitted stage')
    await expect(engine.interactions.ask(run.id, question, AbortSignal.abort(new Error('Already cancelled')))).rejects.toThrow('Already cancelled')
  })
  it('validates business configuration and manual input at admission', async () => {
    const { engine, db, turn } = setup()
    const plugin = definition({ forms: { version: 1, business: { type: 'null' }, input: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'integer' } } } } })
    engine.register(plugin)
    expect(() => engine.triggerManual(definitionId, request('invalid-input'), { id: 'wrong' })).toThrow('schema')
    expect(db.runs()).toHaveLength(0)
    expect(() => { engine.updateConfig(definitionId, 1, { ...plugin.config, business: 'wrong' }) }).toThrow('schema')
    const run = engine.triggerManual(definitionId, request('valid-input'), { id: 1 })
    await turn()
    expect(db.run(run.id)?.status).toBe('succeeded')
  })
  it('requires explicit schema migration and preserves saved configuration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'task-schema-'))
    disposers.push(async () => { rmSync(root, { recursive: true, force: true }) })
    const path = join(root, 'tasks.sqlite')
    const first = setup(path)
    first.engine.register(definition({ forms: { version: 1, business: { type: 'null' }, input: {} } }))
    await first.close()
    const second = setup(path)
    const plugin = definition({ forms: { version: 2, business: { type: 'object' }, input: {} }, config: { ...definition().config, business: {} } })
    expect(() => { second.engine.register(plugin) }).toThrow('migrateConfig')
    second.engine.register({ ...plugin, migrateConfig: (_value, version) => ({ migratedFrom: version }) })
    expect(second.db.definitions()[0]).toMatchObject({ revision: 2, config: { business: { migratedFrom: 1 } }, forms: { version: 2 } })
  })
  it('persists an approval before display and resolves only the first valid committed response', async () => {
    const { engine, db } = setup()
    const principal = brandString<TaskPrincipalId>('owner')
    engine.register(definition({ runSpecial: async stage => ({ kind: 'succeed', result: await engine.interactions.ask(stage.run.id,
      { source: 'tool_approval', title: 'Publish', description: '', schema: { enum: ['allowed-once', 'rejected'] }, callId: null, questions: null, expiresAt: null }, stage.signal) }) }))
    const run = engine.triggerManual(definitionId, request('approval-run'), null)
    engine.tick()
    await expect.poll(() => db.interactions(run.id).length).toBe(1)
    const pending = db.interactions(run.id)[0]!
    expect(db.run(run.id)?.status).toBe('running')
    const command: TaskCommand = { kind: 'respond', runId: run.id, waitId: pending.id, revision: pending.revision, response: 'allowed-once' }
    expect(() => engine.command(principal, request('bad-answer'), { ...command, response: true })).toThrow('schema')
    const original = engine.command(principal, request('approval-answer'), command)
    expect(engine.command(principal, request('approval-answer'), command)).toEqual(original)
    expect(() => engine.command(principal, request('second-answer'), command)).toThrow('stale')
    await engine.drain()
    expect(db.run(run.id)).toMatchObject({ status: 'succeeded', result: 'allowed-once' })
    expect(db.interactions(run.id)[0]?.state).toBe('answered')
  })
  it('withdraws live questions when cancellation drains their stage', async () => {
    const { engine, db } = setup()
    engine.register(definition({ runSpecial: async stage => ({ kind: 'succeed', result: await engine.interactions.ask(stage.run.id,
      { source: 'agent_question', title: 'Choose', description: '', schema: {}, callId: null, questions: null, expiresAt: null }, stage.signal) }) }))
    const run = engine.triggerManual(definitionId, request('question-run'), null)
    engine.tick()
    await expect.poll(() => db.interactions(run.id).length).toBe(1)
    await engine.cancel(run.id)
    expect(db.interactions(run.id)[0]?.state).toBe('withdrawn')
    expect(db.run(run.id)?.status).toBe('cancelled')
  })
  it('delivers one durable business timeout input', async () => {
    const { engine, db, turn, advance } = setup()
    engine.register(definition({ runSpecial: async stage => stage.inputs.length ? { kind: 'succeed', result: stage.inputs[0]!.value }
      : { kind: 'wait', checkpoint: null, prompt: 'Confirm', schema: { type: 'boolean' }, expiresAt: Date.UTC(2026, 8, 10, 0, 0) + 100 } }))
    const run = engine.triggerManual(definitionId, request('expires'), null)
    await turn(); advance(101); await turn()
    expect(db.run(run.id)).toMatchObject({ status: 'succeeded', result: { kind: 'timeout' } })
  })
})

describe('Task presentation records', () => {
  it('validates supplemental input against the schema captured by the run', async () => {
    const { engine, db } = setup()
    const supplement = { type: 'object', required: ['text'], additionalProperties: false, properties: { text: { type: 'string' } } }
    engine.register(definition({ forms: { version: 1, business: { type: 'null' }, input: {}, supplement },
      runSpecial: async () => ({ kind: 'wait', checkpoint: null, prompt: 'Review' }) }))
    const run = engine.triggerManual(definitionId, request('supplement-run'), null)
    expect(db.run(run.id)?.forms?.supplement).toEqual(supplement)
    expect(() => { engine.sendInput(run.id, request('wrong-shape'), { note: 'missing text' }) }).toThrow('schema')
    engine.sendInput(run.id, request('valid-shape'), { text: 'Retry after the fix' })
    expect(db.inputs(run.id).map(input => input.value)).toEqual([{ text: 'Retry after the fix' }])
    await engine.cancel(run.id)
  })

  it('reads records written before presentation fields existed', () => {
    const root = mkdtempSync(join(tmpdir(), 'task-presentation-'))
    disposers.push(async () => { rmSync(root, { recursive: true, force: true }) })
    const path = join(root, 'tasks.sqlite')
    const db = new TaskDatabase(path)
    const base = { sessionId: 'task-session', definitionId, kind: 'manual', parentRunId: null, businessKey: null, codeVersion: '1',
      configRevision: 1, config: definition().config, input: null, checkpoint: null, revision: 1, inputRevision: 0, wait: null,
      retryAt: null, result: null, reason: null, createdAt: 1, updatedAt: 2, cleanup: 'complete', resources: [] }
    db.close()
    const raw = new DatabaseSync(path)
    try {
      for (const [id, status, terminalAt] of [['ended', 'succeeded', 3], ['active', 'queued', null]] as const)
        raw.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?)').run(id, `${id}-session`, definitionId, null, terminalAt,
          JSON.stringify({ ...base, id, sessionId: `${id}-session`, status, terminalAt,
            wait: id === 'active' ? { id: 'wait', revision: 0, prompt: 'Old prompt' } : null }))
      raw.prepare('INSERT INTO definitions VALUES (?,?)').run(definitionId, JSON.stringify({ id: definitionId, title: 'Business',
        codeVersion: '1', revision: 1, enabled: true, installed: true, config: definition().config, nextDueAt: null }))
      for (const [id, createdAt, state] of [['later', 20, 'waiting'], ['earlier', 10, 'waiting'], ['done', 5, 'answered']] as const)
        raw.prepare('INSERT INTO interactions VALUES (?,?,?)').run(id, 'active', JSON.stringify({ id, runId: 'active', revision: 0,
          source: 'tool_approval', title: 'Publish', description: '', schema: {}, createdAt, expiresAt: null, state, answer: null }))
    } finally { raw.close() }
    const reopened = new TaskDatabase(path)
    disposers.push(async () => { reopened.close() })
    expect(reopened.run(brandString<TaskRun['id']>('ended'))).toMatchObject({ outcome: 'succeeded', occurrence: null })
    expect(reopened.run(brandString<TaskRun['id']>('active'))).toMatchObject({ outcome: null, wait: { prompt: 'Old prompt' } })
    expect(reopened.run(brandString<TaskRun['id']>('active'))?.wait).not.toHaveProperty('createdAt')
    expect(reopened.definitions()[0]?.blockedReason).toBeNull()
    expect(reopened.waitingInteractions().map(item => [item.id, item.callId, item.questions])).toEqual([['earlier', null, null], ['later', null, null]])
  })
})
