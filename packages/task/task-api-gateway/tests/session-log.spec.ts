/** Session log reads return stored events unprojected, retain Task ownership and never acquire Session write access. */
import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionSeq, type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session'
import type { TaskRun } from '@deepseek-ai/dsh-task'
import { SessionPersistenceNotFoundError, type SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { sessionLogPageSchema } from '@deepseek-ai/dsh-task-api-protocol'
import { readSessionLog } from '../src/session-log.ts'
import { stub } from '../../task-local/tests/stub.ts'

const signal = new AbortController().signal
const sessionId = brandString<SessionId>('task-session')
// The reader only needs these immutable identity fields from the engine record.
const run = { id: 'task-run', sessionId } as TaskRun
function fixture() {
  const raw: unknown = [
    { seq: 0, time: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, time: 1, type: 'step/start', data: { turn: 1, step: 1 } },
    { seq: 2, time: 2, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(1200) }], source: { kind: 'model', provider: 'test', model: 'model-a', replayState: 'provider-state' } }, stream: [{ type: 'text-chunks', time0: 2, index: 0, dt: [], texts: ['hi'] }] } },
    { seq: 3, time: 3, type: 'working-directory/change', data: { cwd: '/work' } },
  ]
  const events = raw as SessionEvent[]
  const close = vi.fn(async () => {})
  const read = vi.fn(async (offset: number = 0, length: number = events.length) => ({ events: events.slice(offset, offset + length), eventState: 'owned' as const }))
  // A read-only handle double exposes only operations the reader is permitted to use.
  const handle = stub<SessionHandle>({ read, [Symbol.asyncDispose]: close })
  const open = vi.fn(async () => handle)
  const tasks = { getRun: vi.fn(() => run) }
  const page = async (query: Record<string, string> = {}, maxBytes = 1_000_000) =>
    sessionLogPageSchema.parse(await readSessionLog(tasks, { open }, run.id, query, { pageSize: 2, maxBytes }, signal))
  return { page, events, open, close, read }
}

describe('Task Session log windows', () => {
  it('returns every stored event with its persisted fields and pages forward', async () => {
    const f = fixture()
    const first = await f.page()
    expect(first).toMatchObject({ runId: run.id, sessionId, hasMore: true })
    expect(first.items).toEqual([
      { sequence: 0, at: '1970-01-01T00:00:00.000Z', type: 'turn/start', event: { seq: 0, time: 0, type: 'turn/start', data: { turn: 1 } } },
      { sequence: 1, at: '1970-01-01T00:00:00.001Z', type: 'step/start', event: { seq: 1, time: 1, type: 'step/start', data: { turn: 1, step: 1 } } },
    ])
    const second = await f.page({ cursor: first.nextCursor })
    expect(second.items.map(item => item.type)).toEqual(['assistant/message', 'working-directory/change'])
    expect(second.items[0]!.event).toEqual(f.events[2])
    expect(second.hasMore).toBe(false)
    expect(f.open).toHaveBeenCalledWith(sessionId, 'read', { signal })
    expect(f.close).toHaveBeenCalledTimes(2)
    expect(f.read.mock.calls.every(([, length]) => length !== undefined && length <= 3)).toBe(true)
  })
  it('ends a window at the byte budget, keeps an oversized event whole and resumes at the next event', async () => {
    const f = fixture()
    const sequences: number[][] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard++) {
      const page = await f.page({ limit: '10', ...(cursor === undefined ? {} : { cursor }) }, 1024)
      sequences.push(page.items.map(item => item.sequence))
      cursor = page.nextCursor
      if (!page.hasMore) break
    }
    expect(sequences).toEqual([[0, 1], [2], [3]])
    expect((await f.page({ limit: '10' }, 1)).items.map(item => item.sequence)).toEqual([0])
  })
  it('retains an empty continuation and reads later appends without duplicating events', async () => {
    const f = fixture()
    const all = await f.page({ limit: '10' })
    const empty = await f.page({ cursor: all.nextCursor })
    expect(empty.items).toEqual([])
    expect(empty.nextCursor).toBe(all.nextCursor)
    f.events.push({ ...f.events[0]!, seq: SessionSeq(4), time: 4 })
    expect((await f.page({ cursor: empty.nextCursor })).items.map(item => item.sequence)).toEqual([4])
  })
  it('rejects a changed or truncated continuation anchor and releases its handle', async () => {
    const f = fixture()
    const page = await f.page()
    f.events[1] = { ...f.events[1]!, time: 999 }
    await expect(f.page({ cursor: page.nextCursor })).rejects.toMatchObject({ status: 409, code: 'cursor_stale' })
    f.events.length = 0
    await expect(f.page({ cursor: page.nextCursor })).rejects.toMatchObject({ status: 409, code: 'cursor_stale' })
    expect(f.close).toHaveBeenCalledTimes(3)
  })
  it('rejects malformed, cross-session and offset-zero anchored cursors before opening persistence', async () => {
    const f = fixture()
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    await expect(f.page({ cursor: 'not-json' })).rejects.toMatchObject({ status: 400, code: 'invalid_cursor' })
    await expect(f.page({ cursor: encode({ version: 1, session: 'other', offset: 0, anchor: '' }) })).rejects.toMatchObject({ status: 400, code: 'invalid_cursor' })
    await expect(f.page({ cursor: encode({ version: 1, session: sessionId, offset: 0, anchor: 'unexpected' }) })).rejects.toMatchObject({ status: 400, code: 'invalid_cursor' })
    expect(f.open).not.toHaveBeenCalled()
  })
  it('does not read unowned executions and observes pre-aborted requests', async () => {
    const f = fixture()
    const limits = { pageSize: 2, maxBytes: 1_000_000 }
    await expect(readSessionLog({ getRun: () => undefined }, { open: f.open }, 'missing', {}, limits, signal)).rejects.toMatchObject({ status: 404 })
    await expect(readSessionLog({ getRun: () => run }, { open: f.open }, run.id, {}, limits, AbortSignal.abort())).rejects.toThrow()
    expect(f.open).not.toHaveBeenCalled()
  })
  it('closes the read handle when persistence fails and reports an unavailable Session', async () => {
    const f = fixture()
    f.read.mockRejectedValueOnce(new Error('read failed'))
    await expect(f.page()).rejects.toThrow('read failed')
    expect(f.close).toHaveBeenCalledOnce()
    f.open.mockRejectedValueOnce(new SessionPersistenceNotFoundError(sessionId))
    await expect(f.page()).rejects.toMatchObject({ status: 409, code: 'session_unavailable' })
  })
})
