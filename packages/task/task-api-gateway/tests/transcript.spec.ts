/** Transcript reads retain Task ownership and never acquire Session write access. */
import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionSeq, type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session'
import type { TaskRun } from '@deepseek-ai/dsh-task'
import { SessionPersistenceNotFoundError, type SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { transcriptPageSchema } from '@deepseek-ai/dsh-task-api-protocol'
import { readTaskTranscript, taskTranscriptContent } from '../src/transcript.ts'
import { downloadSessionAttachment } from '../src/session-attachments.ts'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { AttachmentId, type AttachmentStore, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { HttpProblem } from '../src/http.ts'
import { stub } from '../../task-local/tests/stub.ts'

const signal = new AbortController().signal
const sessionId = brandString<SessionId>('task-session')
// The reader only needs these immutable identity fields from the engine record.
const run = { id: 'task-run', sessionId } as TaskRun
function fixture() {
  // Raw durable input deliberately includes fields excluded from the public projection.
  const raw: unknown = [
    { seq: 0, time: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, time: 1, type: 'user/message', surfaceOp: 'append', data: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } } },
    { seq: 2, time: 2, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: 'analysis' }, { type: 'tool-call', id: 'call', name: 'inspect', arguments: '{}' }], source: { kind: 'model', provider: 'test', model: 'model-a', replayState: 'private-provider' } }, stream: [{ type: 'text-chunks', time0: 2, index: 0, dt: [], texts: ['private-stream'] }], usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 5, reasoningTokens: 8 } } },
    { seq: 3, time: 3, type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'call' }, toolCallId: 'call', isError: true, content: [{ type: 'text', text: 'failed' }, { type: 'file', attachment: { attachmentId: 'opaque', name: 'note.txt', bytes: 4, path: 'private-path' } }] }, meta: 'private-metadata' } },
  ]
  const events = raw as SessionEvent[]
  const close = vi.fn(async () => {})
  const read = vi.fn(async (offset: number = 0, length: number = events.length) => ({ events: events.slice(offset, offset + length), eventState: 'owned' as const }))
  // A read-only handle double exposes only operations the reader is permitted to use.
  const handle = stub<SessionHandle>({ read, [Symbol.asyncDispose]: close })
  const open = vi.fn(async () => handle)
  const tasks = { getRun: vi.fn(() => run) }
  const page = async (query: Record<string, string> = {}, maxBytes = 1_000_000) =>
    transcriptPageSchema.parse(await readTaskTranscript(tasks, { open }, run.id, query, 2, maxBytes, signal))
  return { page, events, open, close, read, tasks }
}

/** Durable events of one loop turn as the Session writes them; `time` is the event time in milliseconds. */
const loop = {
  turnStart: (seq: number, time: number, turn: number) => ({ seq, time, type: 'turn/start', data: { turn } }),
  turnEnd: (seq: number, time: number, turn: number) => ({ seq, time, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } }),
  stepStart: (seq: number, time: number, turn: number, step: number) => ({ seq, time, type: 'step/start', data: { turn, step } }),
  stepEnd: (seq: number, time: number, turn: number, step: number) => ({ seq, time, type: 'step/end', data: { turn, step } }),
  user: (seq: number, time: number, kind = 'user') => ({
    seq, time, type: 'user/message', surfaceOp: 'append', data: { content: [{ type: 'text', text: `user-${seq}` }], source: { kind } },
  }),
  header: (seq: number, time: number, reason: string, tools?: unknown) => ({
    seq, time, type: 'request/header',
    data: { reason, header: { config: { provider: 'test', model: 'model-a', maxTokens: 4096 }, ...(tools === undefined ? {} : { tools }) } },
  }),
  assistant: (seq: number, time: number, turn: number, step: number, firstToken: number) => ({
    seq, time, type: 'assistant/message', surfaceOp: 'append',
    data: { turn, step, message: { role: 'assistant', content: [{ type: 'text', text: `assistant-${seq}` }], source: { kind: 'model', provider: 'test', model: 'model-a' } },
      stream: [{ type: 'text-chunks', time0: firstToken, index: 0, dt: [], texts: ['text'] }] },
  }),
  call: (seq: number, time: number, callId: string) => ({
    seq, time, type: 'tool/call', data: { turn: 1, step: 1, callId, name: 'inspect', arguments: '{}' },
  }),
  result: (seq: number, time: number, callId: string) => ({
    seq, time, type: 'tool/result', surfaceOp: 'append',
    data: { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: 'done' }] } },
  }),
}
const iso = (time: number) => new Date(time).toISOString()
/** Loop position of a cursor taken before any event. */
const unstarted = { turn: null, step: null, calls: [] }

describe('Task transcript windows', () => {
  it('streams only attachments in visible messages and closes every read handle', async () => {
    const f = fixture()
    const readFileStream = vi.fn(async function* () { yield new TextEncoder().encode('file') })
    const readImage = vi.fn(async (ref: ImageAttachmentRef) => ({ ref, data: new Uint8Array([1, 2, 3]) }))
    const store: Pick<AttachmentStore, 'readFileStream' | 'readImage'> = { readFileStream, readImage }
    const server = createServer((request, response) => {
      const index = Number(new URL(request.url!, 'http://localhost').searchParams.get('index') ?? '1')
      void downloadSessionAttachment({ open: f.open }, store, run, 3, index, response).catch((error: unknown) => {
        if (response.headersSent) response.destroy()
        else { response.statusCode = error instanceof HttpProblem ? error.status : 500; response.end() }
      })
    })
    try {
      server.listen(0, '127.0.0.1'); await once(server, 'listening')
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('No bound test port')
      const url = `http://127.0.0.1:${address.port}/`
      const response = await fetch(url)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('file')
      expect(response.headers.get('content-disposition')).toContain('note.txt')
      expect((await fetch(url + '?index=0')).status).toBe(404)
      expect((await fetch(url + '?index=9')).status).toBe(404)
      f.open.mockRejectedValueOnce(new SessionPersistenceNotFoundError(sessionId))
      expect((await fetch(url)).status).toBe(409)
      const tool = f.events[3]!
      if (tool.type !== 'tool/result') throw new Error('Expected tool fixture')
      const message: typeof tool.data.message = { ...tool.data.message, content: [{ type: 'image', attachment: {
        attachmentId: AttachmentId('a'.repeat(64)), mediaType: 'image/png', bytes: 3, width: 1, height: 1,
      } }] }
      f.events[3] = { ...tool, data: { ...tool.data, message } }
      const image = await fetch(url + '?index=0')
      expect(image.headers.get('content-type')).toBe('image/png')
      expect(image.headers.get('content-disposition')).toContain('a'.repeat(64))
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
      f.events[3] = { ...f.events[3], surfaceOp: { op: 'replace', startSeq: SessionSeq(0), endSeq: SessionSeq(0) } }
      expect((await fetch(url)).status).toBe(404)
      expect(readFileStream).toHaveBeenCalledOnce()
      expect(readImage).toHaveBeenCalledOnce()
      await expect.poll(() => f.close.mock.calls.length).toBe(5)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
    }
  })

  it('aborts before writing to an already destroyed attachment response', async () => {
    const f = fixture()
    const writeHead = vi.fn()
    const response = stub<ServerResponse>(Object.assign(new EventEmitter(), { destroyed: true, writeHead }))
    const store: Pick<AttachmentStore, 'readFileStream' | 'readImage'> = {
      readFileStream: vi.fn(async function* () { yield new TextEncoder().encode('file') }),
      readImage: vi.fn(),
    }
    await expect(downloadSessionAttachment({ open: f.open }, store, run, 3, 1, response))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(writeHead).not.toHaveBeenCalled()
    expect(f.close).toHaveBeenCalledOnce()
  })

  it('aborts an attachment read when the client closes before the response finishes', async () => {
    const entered = Promise.withResolvers<AbortSignal>()
    const open = vi.fn(async (_session: SessionId, _mode: string, options: { signal: AbortSignal }) => {
      entered.resolve(options.signal)
      return new Promise<SessionHandle>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => { reject(new DOMException('Client disconnected', 'AbortError')) }, { once: true })
      })
    })
    const response = Object.assign(new EventEmitter(), { destroyed: false, writableFinished: false }) as ServerResponse
    const pending = downloadSessionAttachment({ open },
      { readFileStream: vi.fn(), readImage: vi.fn() }, run, 3, 1, response)
    const signal = await entered.promise
    response.emit('close')
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(signal.aborted).toBe(true)
  })

  it('pages over internal events and projects messages without replay or storage metadata', async () => {
    const f = fixture()
    const first = await f.page()
    expect(first.items).toEqual([{ sequence: 1, at: '1970-01-01T00:00:00.001Z', role: 'user', callId: null, isError: false, model: null, usage: null, blocks: [{ kind: 'text', text: 'hello' }], turn: 1, step: null, source: { kind: 'user' }, startedAt: null, firstTokenAt: null }])
    expect(first.items).toMatchSnapshot()
    expect(first.hasMore).toBe(true)
    const second = await f.page({ cursor: first.nextCursor })
    expect(second.items.map(item => item.role)).toEqual(['assistant', 'tool'])
    expect(second.items[0]).toMatchObject({ model: 'model-a', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 5, reasoningTokens: 8 } })
    expect(second.items[0]).toMatchObject({ turn: 1, step: 1, source: null, startedAt: null, firstTokenAt: '1970-01-01T00:00:00.002Z' })
    expect(second.items[1]).toMatchObject({ model: null, usage: null, turn: 1, step: 1, source: null, startedAt: null, firstTokenAt: null })
    expect(second.items[1]).toMatchObject({ callId: 'call', isError: true, blocks: [{ kind: 'text', text: 'failed' }, { kind: 'file', name: 'note.txt', bytes: 4, mediaType: 'application/octet-stream' }] })
    expect(JSON.stringify(second)).not.toContain('private-')
    expect(second.hasMore).toBe(false)
    expect(f.open).toHaveBeenCalledWith(sessionId, 'read', { signal })
    expect(f.close).toHaveBeenCalledTimes(2)
    expect(f.read.mock.calls.every(([, length]) => length !== undefined && length <= 3)).toBe(true)
  })
  it('ends a window at the byte budget, keeps oversized messages whole and resumes at the next event', async () => {
    const f = fixture()
    const message = (seq: number, size: number) => ({
      seq, time: seq, type: 'assistant/message', surfaceOp: 'append',
      data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(size) }], source: { kind: 'model', provider: 'test', model: 'model-b' } },
        stream: [], ...(seq === 1 ? { usage: { inputTokens: 1, outputTokens: 2 } } : {}) },
    })
    const turn = (seq: number) => ({ seq, time: seq, type: 'turn/start', data: { turn: seq } })
    const raw: unknown = [turn(0), message(1, 4000), message(2, 4000), turn(3), message(4, 4000), message(5, 20000), message(6, 10)]
    f.events.length = 0
    f.events.push(...(raw as SessionEvent[]))
    const sequences: number[][] = []
    const reported: boolean[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard++) {
      const page = await f.page({ limit: '10', ...(cursor === undefined ? {} : { cursor }) }, 9000)
      sequences.push(page.items.map(item => item.sequence))
      reported.push(...page.items.map(item => item.usage !== null))
      cursor = page.nextCursor
      if (!page.hasMore) break
    }
    expect(sequences).toEqual([[1, 2], [4], [5], [6]])
    expect(reported).toEqual([true, false, false, false, false])
    expect(await f.page({ limit: '10' }, 1)).toMatchObject({
      items: [{ sequence: 1, model: 'model-b', usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null } }],
      hasMore: true,
    })
  })
  it('projects loop position, request timing and request headers, carrying the loop position across windows', async () => {
    const f = fixture()
    const tool = { name: 'inspect', description: 'Inspect a target', parameters: { type: 'object', properties: { target: { type: 'string' } } } }
    const raw: unknown = [
      loop.turnStart(0, 1000, 1),
      loop.user(1, 1010),
      loop.stepStart(2, 1020, 1, 1),
      loop.header(3, 1030, 'initial', [tool]),
      loop.user(4, 1040, 'skill-catalog'),
      loop.assistant(5, 1500, 1, 1, 1200),
      loop.call(6, 1510, 'call-a'),
      loop.result(7, 1900, 'call-a'),
      loop.stepEnd(8, 1910, 1, 1),
      loop.stepStart(9, 1920, 1, 2),
      loop.header(10, 1930, 'change'),
      loop.assistant(11, 2400, 1, 2, 2100),
      loop.stepEnd(12, 2410, 1, 2),
      loop.turnEnd(13, 2420, 1),
      loop.user(14, 3000),
    ]
    f.events.splice(0, f.events.length, ...(raw as SessionEvent[]))
    const whole = await f.page({ limit: '20' })
    expect(whole.items.map(({ sequence, turn, step, source, startedAt, firstTokenAt }) => (
      { sequence, turn, step, source, startedAt, firstTokenAt }
    ))).toEqual([
      { sequence: 1, turn: 1, step: null, source: { kind: 'user' }, startedAt: null, firstTokenAt: null },
      { sequence: 4, turn: 1, step: 1, source: { kind: 'skill-catalog' }, startedAt: null, firstTokenAt: null },
      { sequence: 5, turn: 1, step: 1, source: null, startedAt: iso(1020), firstTokenAt: iso(1200) },
      { sequence: 7, turn: 1, step: 1, source: null, startedAt: iso(1510), firstTokenAt: null },
      { sequence: 11, turn: 1, step: 2, source: null, startedAt: iso(1920), firstTokenAt: iso(2100) },
      { sequence: 14, turn: null, step: null, source: { kind: 'user' }, startedAt: null, firstTokenAt: null },
    ])
    const config = { provider: 'test', model: 'model-a', maxTokens: 4096 }
    expect(whole.requests).toEqual([
      { sequence: 3, at: iso(1030), reason: 'initial', config, tools: [tool] },
      { sequence: 10, at: iso(1930), reason: 'change', config, tools: [] },
    ])
    const items: typeof whole.items = []
    const requests: typeof whole.requests = []
    let cursor: string | undefined
    for (let guard = 0; guard < 20; guard++) {
      const page = await f.page({ limit: '1', ...(cursor === undefined ? {} : { cursor }) })
      items.push(...page.items)
      requests.push(...page.requests)
      cursor = page.nextCursor
      if (!page.hasMore) break
    }
    expect({ items, requests }).toEqual({ items: whole.items, requests: whole.requests })
  })
  it('counts request headers in the byte budget so a header cannot widen a window', async () => {
    const f = fixture()
    const raw: unknown = [loop.turnStart(0, 0, 1), loop.user(1, 1), loop.header(2, 2, 'initial', []), loop.user(3, 3)]
    f.events.splice(0, f.events.length, ...(raw as SessionEvent[]))
    const records: number[][] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard++) {
      const page = await f.page({ limit: '10', ...(cursor === undefined ? {} : { cursor }) }, 1)
      records.push([...page.items.map(item => item.sequence), ...page.requests.map(request => request.sequence)])
      cursor = page.nextCursor
      if (!page.hasMore) break
    }
    expect(records).toEqual([[1], [2], [3]])
  })
  it('remembers the newest tool calls only and skips calls whose id cannot fit in a cursor', async () => {
    const f = fixture()
    const long = 'c'.repeat(200)
    const raw: unknown = [
      loop.turnStart(0, 0, 1),
      loop.stepStart(1, 1, 1, 1),
      ...['a', 'b', 'c', 'd', 'e'].map((id, index) => loop.call(2 + index, 10 + index, id)),
      loop.call(7, 20, long),
      loop.result(8, 30, 'a'),
      loop.result(9, 31, 'e'),
      loop.result(10, 32, long),
    ]
    f.events.splice(0, f.events.length, ...(raw as SessionEvent[]))
    const startedAt: (string | null)[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 20; guard++) {
      const page = await f.page({ limit: '1', ...(cursor === undefined ? {} : { cursor }) })
      startedAt.push(...page.items.map(item => item.startedAt))
      cursor = page.nextCursor
      if (!page.hasMore) break
    }
    expect(startedAt).toEqual([null, iso(14), null])
    expect(cursor?.length).toBeLessThan(2048)
  })
  it('retains an empty continuation and reads later appends without duplicating messages', async () => {
    const f = fixture()
    const all = await f.page({ limit: '10' })
    const empty = await f.page({ cursor: all.nextCursor })
    expect(empty.items).toEqual([])
    expect(empty.nextCursor).toBe(all.nextCursor)
    f.events.push({ ...f.events[1]!, seq: SessionSeq(4), time: 4 })
    const added = await f.page({ cursor: empty.nextCursor })
    expect(added.items.map(item => item.sequence)).toEqual([4])
  })
  it('rejects a changed or truncated continuation anchor and releases its handle', async () => {
    const f = fixture()
    const page = await f.page()
    f.events[1] = { ...f.events[1]!, time: 999 }
    await expect(f.page({ cursor: page.nextCursor })).rejects.toMatchObject({ status: 409, code: 'cursor_stale' })
    f.events.length = 0
    await expect(f.page({ cursor: page.nextCursor })).rejects.toMatchObject({ status: 409 })
    expect(f.close).toHaveBeenCalledTimes(3)
  })
  it('rejects cross-session cursors before opening persistence', async () => {
    const f = fixture()
    const cursor = Buffer.from(JSON.stringify({ version: 1, session: 'other', offset: 0, anchor: '', lifecycle: unstarted })).toString('base64url')
    await expect(f.page({ cursor })).rejects.toMatchObject({ status: 400 })
    expect(f.open).not.toHaveBeenCalled()
  })
  it('rejects malformed cursors and offset-zero cursors with an anchor', async () => {
    const f = fixture()
    await expect(f.page({ cursor: 'not-json' })).rejects.toMatchObject({ status: 400, code: 'invalid_cursor' })
    const cursor = Buffer.from(JSON.stringify({ version: 1, session: sessionId, offset: 0, anchor: 'unexpected', lifecycle: unstarted })).toString('base64url')
    await expect(f.page({ cursor })).rejects.toMatchObject({ status: 400, code: 'invalid_cursor' })
    expect(f.open).not.toHaveBeenCalled()
  })
  it('does not read unowned executions and observes pre-aborted requests', async () => {
    const f = fixture()
    await expect(readTaskTranscript({ getRun: () => undefined }, { open: f.open }, 'missing', {}, 2, 1_000_000, signal)).rejects.toMatchObject({ status: 404 })
    await expect(readTaskTranscript(f.tasks, { open: f.open }, run.id, {}, 2, 1_000_000, AbortSignal.abort())).rejects.toThrow()
    expect(f.open).not.toHaveBeenCalled()
  })
  it('omits model-only replacements from the human transcript', async () => {
    const f = fixture()
    f.events[1] = { ...f.events[1]!, surfaceOp: { op: 'replace', startSeq: SessionSeq(0), endSeq: SessionSeq(0) } } as SessionEvent
    f.events[2] = { ...f.events[2]!, surfaceOp: { op: 'replace', startSeq: SessionSeq(0), endSeq: SessionSeq(0) } } as SessionEvent
    f.events[3] = { ...f.events[3]!, surfaceOp: { op: 'replace', startSeq: SessionSeq(0), endSeq: SessionSeq(0) } } as SessionEvent
    const page = await f.page({ limit: '10' })
    expect(page.items).toEqual([])
    expect(page.hasMore).toBe(false)
  })
  it('closes the read handle when persistence fails', async () => {
    const f = fixture()
    f.read.mockRejectedValueOnce(new Error('read failed'))
    await expect(f.page()).rejects.toThrow('read failed')
    expect(f.close).toHaveBeenCalledOnce()
  })
  it('reports temporarily unavailable Session persistence', async () => {
    const f = fixture()
    f.open.mockRejectedValueOnce(new SessionPersistenceNotFoundError(sessionId))
    await expect(f.page()).rejects.toMatchObject({ status: 409, code: 'session_unavailable' })
  })
  it('projects every supported block and keeps extension blocks opaque', async () => {
    const f = fixture()
    const assistant = f.events[2]!
    const tool = f.events[3]!
    // Extension blocks are merge-extensible, so this event is typed only after it is built.
    const extended: unknown = {
      seq: SessionSeq(0), time: 0, type: 'user/message', surfaceOp: 'append', data: { source: { kind: 'user' }, content: [
        { type: 'reasoning', text: 'reason' },
        { type: 'tool-call', id: 'call', name: 'inspect', arguments: '{}' },
        { type: 'image', attachment: { attachmentId: AttachmentId('b'.repeat(64)), mediaType: 'image/png', bytes: 3, width: 1, height: 1 } },
        { type: 'future-extension', value: true },
      ] },
    }
    f.events.splice(0, f.events.length, extended as SessionEvent)
    const page = await f.page()
    expect(page.items[0]?.blocks).toEqual([
      { kind: 'reasoning', text: 'reason' },
      { kind: 'tool_call', callId: 'call', name: 'inspect', arguments: '{}' },
      { kind: 'image', name: 'b'.repeat(64), bytes: 3, mediaType: 'image/png' },
      { kind: 'unsupported', type: 'future-extension' },
    ])
    expect(taskTranscriptContent(f.events[0]!)).toHaveLength(4)
    expect(taskTranscriptContent(assistant)).toEqual(assistant.type === 'assistant/message' ? assistant.data.message.content : [])
    expect(taskTranscriptContent(tool)).toEqual(tool.type === 'tool/result' ? tool.data.message.content : [])
    expect(taskTranscriptContent({ seq: SessionSeq(4), time: 4, type: 'system/message', surfaceOp: 'append', data: {} } as SessionEvent)).toEqual([])
    expect(taskTranscriptContent({ seq: SessionSeq(4), time: 4, type: 'turn/start', data: { turn: 2 } })).toEqual([])
    const first = f.events[0]!
    if (first.type !== 'user/message') throw new Error('Expected the fixture user message')
    expect(taskTranscriptContent({ ...first, surfaceOp: { op: 'replace', startSeq: SessionSeq(0), endSeq: SessionSeq(0) } })).toEqual([])
  })
})
