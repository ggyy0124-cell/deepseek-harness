/** Run statistics and context insight fold the stored Session log with the registered projection units and read only new events
 * afterwards. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage, createSystemMessage, createToolResultMessage, createUserMessage, ToolCallId, type TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError, type SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as sessionStats from '@deepseek-ai/dsh-session-stats'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { TaskRun } from '@deepseek-ai/dsh-task'
import { runContextSchema, runStatsSchema } from '@deepseek-ai/dsh-task-api-protocol'
import { z } from 'zod'
import { HttpProblem } from '../src/http.ts'
import { readRunContext, readRunStats, RunStatsCache } from '../src/stats.ts'
import { stub } from '../../task-local/tests/stub.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
const signal = new AbortController().signal

/** A live Session whose committed events are recorded the way they reach storage. */
async function harness(units = true, context = false) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (units) {
    await ctx.plugin(TokenMeter)
    await ctx.plugin(sessionStats)
  }
  if (context) registerContextUnits(ctx)
  const session = ctx.sessions.create()
  const stored: SessionEvent[] = []
  ctx.on('session/event', (owner: Session, event: SessionEvent) => { if (owner === session) stored.push(event) })
  const readStored = async (offset: number = 0, length?: number) => ({
    events: stored.slice(offset, length === undefined ? undefined : offset + length), eventState: 'owned' as const,
  })
  const read = vi.fn(readStored)
  const handle = stub<SessionHandle>({ header: session.header, inheritedEventCount: session.inheritedEventCount, read,
    [Symbol.asyncDispose]: async () => {} })
  const open = vi.fn(async () => handle)
  // The reader only needs the identity fields of the engine record.
  const run = { id: 'run-1', sessionId: session.id } as TaskRun
  const tasks = { getRun: vi.fn((id: string) => (id === run.id ? run : undefined)) }
  const read$ = (cache: RunStatsCache) => readRunStats(tasks, { open }, ctx.sessionProjections, cache, run.id, signal)
    .then(value => runStatsSchema.parse(value))
  const context$ = (cache: RunStatsCache) => readRunContext(tasks, { open }, ctx.sessionProjections, cache, run.id, signal)
    .then(value => runContextSchema.parse(value))
  return { ctx, session, stored, read, open, tasks, run, stats: read$, context: context$ }
}

/** Stand-ins for the `dsh-context` plugin's units: the gateway reads them only by key, so their values are opaque here. */
function registerContextUnits(ctx: Context) {
  const counter = z.object({ steps: z.number() })
  // The plugin's keys are not in the harness projection maps; it registers them the same way.
  ctx.sessionProjections.register({
    key: 'contextTimeline', stateSchema: counter, stateVersion: 1, init: () => ({ steps: 0 }),
    apply: (state: { steps: number }, event: SessionEvent) => (event.type === 'assistant/message' ? { steps: state.steps + 1 } : state),
    wire: {
      viewSchema: z.any(),
      view: (state: { steps: number }) =>
        ({ ok: true, requests: Array.from({ length: state.steps }, (_, seq) => ({ seq })), model: undefined }),
    },
  } as never)
  ctx.sessionProjections.register({
    key: 'contextHeaders', stateSchema: counter, stateVersion: 1, init: () => ({ steps: 0 }), apply: (state: { steps: number }) => state,
    wire: { viewSchema: z.any(), view: () => ({ headers: [] }) },
  } as never)
}

const usage = (inputTokens: number, outputTokens: number, cacheReadTokens: number): TokenUsage =>
  ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens: 0 })

/** One loop turn: system prompt, request header and route, a user message, one tool call and the assistant answer. */
function turn(session: Session, number: number, used: TokenUsage) {
  if (number === 1) {
    session.append('system/message', { turn: 1, step: 1, message: createSystemMessage('You fix defects.') }, { surfaceOp: 'append' })
    session.append('request/context', { provider: 'mock', model: 'mock', contextWindow: 1000 })
    session.append('request/header', { reason: 'initial', header: { config: { provider: 'mock', model: 'mock' },
      tools: [{ name: 'bash', description: 'run a command', parameters: { type: 'object', properties: {} } }] } })
  }
  session.append('turn/start', { turn: number })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `request ${number}` }], source: { kind: 'user' } }),
    { surfaceOp: 'append' })
  session.append('step/start', { turn: number, step: 1 })
  const callId = ToolCallId(`call-${number}`)
  session.append('tool/call', { turn: number, step: 1, callId, name: 'bash', arguments: '{}' })
  session.append('tool/result', { turn: number, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'ok' }],
    isError: false }) }, { surfaceOp: 'append' })
  session.append('assistant/message', { stream: [], turn: number, step: 1, usage: used, message: createMessage({ role: 'assistant',
    content: [{ type: 'text', text: `answer ${number}` }], source: { kind: 'model', provider: 'mock', model: 'mock' } }) },
  { surfaceOp: 'append' })
  session.append('step/end', { turn: number, step: 1 })
  session.append('turn/end', { turn: number, reason: { kind: 'completed' } })
}

describe('Run statistics', () => {
  it('serves the values the live projections show and folds only the events stored after the previous read', async () => {
    const h = await harness()
    turn(h.session, 1, usage(100, 20, 300))
    const cache = new RunStatsCache(4)
    const first = await h.stats(cache)
    const live = h.ctx.sessionProjections.snapshot(h.session).values
    expect(first).toMatchObject({ runId: 'run-1', sessionId: h.session.id, asOfSeq: h.stored.length - 1,
      session: live.sessionStats, usage: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 0 },
      context: { pressureTokens: 400, projectedTokens: live.contextPressure?.projectedTokens, contextWindow: 1000 },
      composition: live.contextBreakdown })
    expect(first.session).toMatchObject({ turns: 1, steps: 1 })
    expect(first.composition?.systemTokens).toBeGreaterThan(0)
    expect(first.composition?.toolsTokens).toBeGreaterThan(0)
    expect(h.read).toHaveBeenLastCalledWith(0, undefined, { signal })
    const end = h.stored.length - 1
    turn(h.session, 2, usage(50, 10, 450))
    const second = await h.stats(cache)
    expect(h.read).toHaveBeenLastCalledWith(end, undefined, { signal })
    expect(second.session).toMatchObject({ turns: 2, steps: 2 })
    expect(second.usage).toEqual({ uncachedInputTokens: 150, outputTokens: 30, cacheReadTokens: 750, cacheWriteTokens: 0 })
    expect(second).toMatchObject({ asOfSeq: h.stored.length - 1, context: { pressureTokens: 500 },
      session: h.ctx.sessionProjections.snapshot(h.session).values.sessionStats })
    expect(await h.stats(cache)).toEqual(second)
    expect(h.read).toHaveBeenLastCalledWith(h.stored.length - 1, undefined, { signal })
  })

  it('refolds from the first event when the log changed under its checkpoint or the checkpoint was evicted', async () => {
    const h = await harness()
    turn(h.session, 1, usage(100, 20, 300))
    const cache = new RunStatsCache(1)
    const first = await h.stats(cache)
    const last = h.stored.at(-1) as SessionEvent
    h.stored[h.stored.length - 1] = { ...last, time: last.time + 1 }
    expect(await h.stats(cache)).toEqual(first)
    const offsets = (): (number | undefined)[] => h.read.mock.calls.map(([offset]: Parameters<typeof h.read>) => offset)
    expect(offsets()).toEqual([0, h.stored.length - 1, 0])
    h.stored.splice(-2)
    expect((await h.stats(cache)).asOfSeq).toBe(h.stored.length - 1)
    expect(offsets().at(-1)).toBe(0)
    cache.put('other-session', { checkpoint: {}, endSeq: -1, anchor: '' })
    await h.stats(cache)
    expect(offsets().at(-1)).toBe(0)
  })

  it('reports null for figures whose unit the host does not compose and an empty log as position -1', async () => {
    const h = await harness(false)
    const cache = new RunStatsCache(2)
    expect(await h.stats(cache)).toEqual({ runId: 'run-1', sessionId: h.session.id, asOfSeq: -1, session: null, usage: null,
      context: null, composition: null })
    expect(await h.stats(cache)).toMatchObject({ asOfSeq: -1 })
    const metered = await harness()
    const empty = await metered.stats(new RunStatsCache(2))
    expect(empty).toMatchObject({ asOfSeq: -1, usage: { uncachedInputTokens: 0, outputTokens: 0 },
      context: { pressureTokens: null, projectedTokens: null, contextWindow: null } })
  })

  it('rejects unknown Runs and Sessions that storage does not have yet', async () => {
    const h = await harness()
    const cache = new RunStatsCache(2)
    await expect(readRunStats(h.tasks, { open: h.open }, h.ctx.sessionProjections, cache, 'missing', signal))
      .rejects.toMatchObject({ status: 404, code: 'not_found' })
    h.open.mockRejectedValueOnce(new SessionPersistenceNotFoundError(h.session.id))
    await expect(h.stats(cache)).rejects.toMatchObject({ status: 409, code: 'session_unavailable' })
    h.open.mockRejectedValueOnce(new Error('disk failure'))
    await expect(h.stats(cache)).rejects.not.toBeInstanceOf(HttpProblem)
    const aborted = AbortSignal.abort()
    await expect(readRunStats(h.tasks, { open: h.open }, h.ctx.sessionProjections, cache, h.run.id, aborted)).rejects.toThrow()
  })
})

describe('Run context insight', () => {
  it('passes the plugin views through as JSON and shares the fold cache with the statistics', async () => {
    const h = await harness(true, true)
    turn(h.session, 1, usage(100, 20, 300))
    const cache = new RunStatsCache(4)
    expect(await h.context(cache)).toEqual({ runId: 'run-1', sessionId: h.session.id, asOfSeq: h.stored.length - 1,
      timeline: { ok: true, requests: [{ seq: 0 }] }, headers: { headers: [] } })
    const end = h.stored.length - 1
    turn(h.session, 2, usage(50, 10, 450))
    expect((await h.stats(cache)).session).toMatchObject({ turns: 2 })
    expect(h.read).toHaveBeenLastCalledWith(end, undefined, { signal })
    expect((await h.context(cache)).timeline).toEqual({ ok: true, requests: [{ seq: 0 }, { seq: 1 }] })
    expect(h.read).toHaveBeenLastCalledWith(h.stored.length - 1, undefined, { signal })
  })

  it('reports a host without the plugin as unavailable and a missing header unit as null', async () => {
    const h = await harness()
    turn(h.session, 1, usage(100, 20, 300))
    await expect(h.context(new RunStatsCache(2))).rejects.toMatchObject({ status: 404, code: 'context_unavailable' })
    const partial = await harness(false)
    partial.ctx.sessionProjections.register({
      key: 'contextTimeline', stateSchema: z.object({}), stateVersion: 1, init: () => ({}), apply: (state: object) => state,
      wire: { viewSchema: z.any(), view: () => ({ ok: true }) },
    } as never)
    expect(await partial.context(new RunStatsCache(2))).toMatchObject({ asOfSeq: -1, timeline: { ok: true }, headers: null })
  })

  it('rejects unknown Runs and Sessions that storage does not have yet', async () => {
    const h = await harness(true, true)
    const cache = new RunStatsCache(2)
    await expect(readRunContext(h.tasks, { open: h.open }, h.ctx.sessionProjections, cache, 'missing', signal))
      .rejects.toMatchObject({ status: 404, code: 'not_found' })
    h.open.mockRejectedValueOnce(new SessionPersistenceNotFoundError(h.session.id))
    await expect(h.context(cache)).rejects.toMatchObject({ status: 409, code: 'session_unavailable' })
  })
})
