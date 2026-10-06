/** Replay admission and bounded stream ownership without timing-dependent sockets. */
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TaskJournalEntry, TaskStoreId, TaskService, TaskRun } from '@deepseek-ai/dsh-task'
import type { SessionHandle, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { streamSessionEvents } from '../src/session-events.ts'
import { streamTaskEvents } from '../src/events.ts'
import { stub } from '../../task-local/tests/stub.ts'

const storeId = brandString<TaskStoreId>('00000000-0000-0000-0000-000000000001')
const options = {
  eventPollMs: 1, eventHeartbeatMs: 1000, eventBatchSize: 1, eventBufferBytes: 1024, eventDrainTimeoutMs: 10, transcriptPageBytes: 65536,
}
class SocketResponse extends EventEmitter {
  writableLength = 0
  destroyed = false
  headersSent = false
  readonly frames: string[] = []
  blocked = false
  writeHead(): void { this.headersSent = true }
  flushHeaders(): void {}
  write(frame: string): boolean { this.frames.push(frame); return !this.blocked }
  destroy(): void { if (this.destroyed) return; this.destroyed = true; this.emit('close') }
  response(): ServerResponse { return stub<ServerResponse>(this) }
}
function taskJournal(event = 'run.ended') {
  const entry: TaskJournalEntry = { sequence: 1, runId: null, event, at: 0, details: { internal: 'not-public' } }
  return { journalHead: () => ({ storeId, sequence: 1 }), journalPage: (after: number) => after < 1 ? [entry] : [] }
}
describe('Task event replay', () => {
  it.each(['replacement', 'truncation'] as const)('closes when journal %s invalidates an admitted stream', async (mode) => {
    const socket = new SocketResponse()
    const journal = taskJournal()
    const original = journal.journalHead()
    await expect(streamTaskEvents(journal, socket.response(), undefined, async () => {
      journal.journalHead = () => mode === 'replacement'
        ? { ...original, storeId: brandString<TaskStoreId>('00000000-0000-0000-0000-000000000002') }
        : { ...original, sequence: 0 }
    }, options)).rejects.toThrow('store changed')
    expect(socket.destroyed).toBe(true)
  })
  it('emits bounded heartbeats and releases a disconnected response', async () => {
    const socket = new SocketResponse()
    let checks = 0
    await streamTaskEvents(taskJournal(), socket.response(), undefined, async () => {
      if (++checks === 2) socket.destroy()
    }, { ...options, eventHeartbeatMs: 0 })
    expect(socket.frames).toContain(': heartbeat\n\n')
    expect(socket.listenerCount('close')).toBe(0)
    await streamTaskEvents(taskJournal(), socket.response(), undefined, async () => {}, options)
    expect(socket.frames).toHaveLength(2)
  })
  it('replays only public journal fields and closes on authorization loss', async () => {
    const socket = new SocketResponse()
    const authorize = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('revoked'))
    await expect(streamTaskEvents(taskJournal(), socket.response(), `${storeId}:0`, authorize, options)).rejects.toThrow('revoked')
    expect(socket.frames).toHaveLength(2)
    expect(socket.frames[1]).toContain('run.ended')
    expect(socket.frames.join('')).not.toContain('internal')
    expect(socket.destroyed).toBe(true)
    expect(socket.listenerCount('close')).toBe(0)
  })
  it('rejects a future cursor before committing response headers', async () => {
    const socket = new SocketResponse()
    await expect(streamTaskEvents(taskJournal(), socket.response(), `${storeId}:2`, () => Promise.resolve(), options)).rejects.toMatchObject({ status: 409 })
    expect(socket.headersSent).toBe(false)
  })
  it('disconnects when a complete frame exceeds the configured buffer', async () => {
    const socket = new SocketResponse()
    await expect(streamTaskEvents(taskJournal('中'.repeat(400)), socket.response(), `${storeId}:0`, () => Promise.resolve(), options)).rejects.toThrow('buffer')
    expect(socket.frames).toHaveLength(1)
    expect(socket.destroyed).toBe(true)
  })
  it('bounds a stalled drain and releases its listeners', async () => {
    const socket = new SocketResponse()
    socket.blocked = true
    await expect(streamTaskEvents(taskJournal(), socket.response(), `${storeId}:0`, () => Promise.resolve(), options)).rejects.toThrow()
    expect(socket.destroyed).toBe(true)
    expect(socket.listenerCount('drain')).toBe(0)
    expect(socket.listenerCount('close')).toBe(0)
  })
})

describe('Session event transport', () => {
  function session(count = 1) {
    const events = Array.from({ length: count }, (_, seq) => ({
      seq, time: seq, type: 'user/message', surfaceOp: 'append', data: { content: [{ type: 'text', text: `hello-${seq}` }], source: { kind: 'user' } },
    }))
    const close = vi.fn(async () => {})
    // The read-only transport needs only ownership lookup and a bounded disposable handle.
    const tasks = stub<TaskService>({ getRun: () => ({ id: 'run', sessionId: 'session' }) as TaskRun })
    const persistence = stub<SessionPersistence>({ open: async () => stub<SessionHandle>({
      read: async (offset: number, count: number) => ({ events: events.slice(offset, offset + count), eventState: 'owned' }),
      [Symbol.asyncDispose]: close,
    }) })
    return { tasks, persistence, close }
  }
  it('retains independent cursors, replays stored messages and disconnects after revocation', async () => {
    const { tasks, persistence, close } = session()
    const socket = new SocketResponse()
    const authorize = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('revoked'))
    await expect(streamSessionEvents(tasks, persistence, 'run', socket.response(), undefined, authorize,
      { ...options, eventBufferBytes: 4096 })).rejects.toThrow('revoked')
    expect(socket.frames).toHaveLength(2)
    expect(socket.frames[1]).toContain('hello')
    expect(close).toHaveBeenCalledTimes(2)
    expect(socket.listenerCount('close')).toBe(0)
    expect(socket.destroyed).toBe(true)
    await streamSessionEvents(tasks, persistence, 'run', socket.response(), undefined, authorize, options)
    expect(close).toHaveBeenCalledTimes(2)
  })
  it('rejects invalid continuations before writing headers', async () => {
    const { tasks, persistence } = session()
    const socket = new SocketResponse()
    await expect(streamSessionEvents(tasks, persistence, 'run', socket.response(), 'invalid', async () => {}, options))
      .rejects.toMatchObject({ status: 400 })
    expect(socket.headersSent).toBe(false)
    expect(socket.listenerCount('close')).toBe(0)
  })
  it.each(['overflow', 'drain'] as const)('bounds Session stream %s and releases socket listeners', async (mode) => {
    const { tasks, persistence } = session()
    const socket = new SocketResponse()
    socket.blocked = mode === 'drain'
    await expect(streamSessionEvents(tasks, persistence, 'run', socket.response(), undefined, async () => {},
      { ...options, eventBufferBytes: mode === 'overflow' ? 1 : 4096 })).rejects.toThrow()
    expect(socket.destroyed).toBe(true)
    expect(socket.listenerCount('drain')).toBe(0)
    expect(socket.listenerCount('close')).toBe(0)
  })
  it('drains consecutive pages without polling and suppresses unchanged pages before the heartbeat', async () => {
    const { tasks, persistence } = session(2)
    const socket = new SocketResponse()
    let checks = 0
    await streamSessionEvents(tasks, persistence, 'run', socket.response(), undefined, async () => {
      if (++checks === 3) socket.destroy()
    }, { ...options, eventBufferBytes: 4096 })
    expect(socket.frames.filter(frame => frame.includes('event: session\n'))).toHaveLength(2)
  })
  it('splits stored messages over the transcript byte budget into consecutive frames', async () => {
    const { tasks, persistence } = session(3)
    const socket = new SocketResponse()
    let checks = 0
    await streamSessionEvents(tasks, persistence, 'run', socket.response(), undefined, async () => {
      if (++checks === 4) socket.destroy()
    }, { ...options, eventBatchSize: 10, eventBufferBytes: 8192, transcriptPageBytes: 1 })
    const frames = socket.frames.filter(frame => frame.includes('event: session\n'))
    expect(frames.map(frame => frame.match(/hello-\d/g))).toEqual([['hello-0'], ['hello-1'], ['hello-2']])
  })
  it('emits a Session heartbeat page when no new event has arrived', async () => {
    const { tasks, persistence } = session()
    const socket = new SocketResponse()
    let checks = 0
    await streamSessionEvents(tasks, persistence, 'run', socket.response(), undefined, async () => {
      if (++checks === 3) socket.destroy()
    }, { ...options, eventBufferBytes: 4096, eventHeartbeatMs: 0 })
    expect(socket.frames.filter(frame => frame.includes('event: session\n')).length).toBeGreaterThan(1)
  })
})
