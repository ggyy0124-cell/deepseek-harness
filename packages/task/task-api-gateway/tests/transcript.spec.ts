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
    { seq: 2, time: 2, type: 'assistant/message', surfaceOp: 'append', data: { message: { content: [{ type: 'reasoning', text: 'analysis' }, { type: 'tool-call', id: 'call', name: 'inspect', arguments: '{}' }], source: { replayState: 'private-provider' } }, stream: ['private-stream'] } },
    { seq: 3, time: 3, type: 'tool/result', surfaceOp: 'append', data: { message: { role: 'tool', source: { kind: 'tool', callId: 'call' }, toolCallId: 'call', isError: true, content: [{ type: 'text', text: 'failed' }, { type: 'file', attachment: { attachmentId: 'opaque', name: 'note.txt', bytes: 4, path: 'private-path' } }] }, meta: 'private-metadata' } },
  ]
  const events = raw as SessionEvent[]
  const close = vi.fn(async () => {})
  const read = vi.fn(async (offset: number = 0, length: number = events.length) => ({ events: events.slice(offset, offset + length), eventState: 'owned' as const }))
  // A read-only handle double exposes only operations the reader is permitted to use.
  const handle = stub<SessionHandle>({ read, [Symbol.asyncDispose]: close })
  const open = vi.fn(async () => handle)
  const tasks = { getRun: vi.fn(() => run) }
  const page = async (query: Record<string, string> = {}) =>
    transcriptPageSchema.parse(await readTaskTranscript(tasks, { open }, run.id, query, 2, signal))
  return { page, events, open, close, read, tasks }
}

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
    expect(first.items).toEqual([{ sequence: 1, at: '1970-01-01T00:00:00.001Z', role: 'user', callId: null, isError: false, blocks: [{ kind: 'text', text: 'hello' }] }])
    expect(first.items).toMatchSnapshot()
    expect(first.hasMore).toBe(true)
    const second = await f.page({ cursor: first.nextCursor })
    expect(second.items.map(item => item.role)).toEqual(['assistant', 'tool'])
    expect(second.items[1]).toMatchObject({ callId: 'call', isError: true, blocks: [{ kind: 'text', text: 'failed' }, { kind: 'file', name: 'note.txt', bytes: 4, mediaType: 'application/octet-stream' }] })
    expect(JSON.stringify(second)).not.toContain('private-')
    expect(second.hasMore).toBe(false)
    expect(f.open).toHaveBeenCalledWith(sessionId, 'read', { signal })
    expect(f.close).toHaveBeenCalledTimes(2)
    expect(f.read.mock.calls.every(([, length]) => length !== undefined && length <= 3)).toBe(true)
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
    const cursor = Buffer.from(JSON.stringify({ version: 1, session: 'other', offset: 0, anchor: '' })).toString('base64url')
    await expect(f.page({ cursor })).rejects.toMatchObject({ status: 400 })
    expect(f.open).not.toHaveBeenCalled()
  })
  it('rejects malformed cursors and offset-zero cursors with an anchor', async () => {
    const f = fixture()
    await expect(f.page({ cursor: 'not-json' })).rejects.toMatchObject({ status: 400, code: 'invalid_cursor' })
    const cursor = Buffer.from(JSON.stringify({ version: 1, session: sessionId, offset: 0, anchor: 'unexpected' })).toString('base64url')
    await expect(f.page({ cursor })).rejects.toMatchObject({ status: 400, code: 'invalid_cursor' })
    expect(f.open).not.toHaveBeenCalled()
  })
  it('does not read unowned executions and observes pre-aborted requests', async () => {
    const f = fixture()
    await expect(readTaskTranscript({ getRun: () => undefined }, { open: f.open }, 'missing', {}, 2, signal)).rejects.toMatchObject({ status: 404 })
    await expect(readTaskTranscript(f.tasks, { open: f.open }, run.id, {}, 2, AbortSignal.abort())).rejects.toThrow()
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
