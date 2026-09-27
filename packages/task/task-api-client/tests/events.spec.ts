/** Fetch event decoding and caller-owned cancellation. */
import { describe, expect, it } from 'vitest'
import { TaskApiClient } from '../src/index.ts'
import { readTaskEvents } from '../src/events.ts'
const cursor = '00000000-0000-0000-0000-000000000001:1'
const ready = { kind: 'ready', cursor }
const frame = `id: ${cursor}\nevent: ready\ndata: ${JSON.stringify(ready)}\n\n`
function response(chunks: string[]): Response {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
    controller.close()
  } }), { headers: { 'Content-Type': 'text/event-stream' } })
}
describe('Task event decoder', () => {
  it('rejects absent bodies, malformed JSON and failed streams while releasing readers', async () => {
    await expect(Array.fromAsync(readTaskEvents(new Response(null), 1024))).rejects.toThrow('no body')
    await expect(Array.fromAsync(readTaskEvents(response(['event: ready\ndata: private-invalid\n\n']), 1024)))
      .rejects.toThrow('invalid JSON')
    expect(await Array.fromAsync(readTaskEvents(response(['ignored\n\n' + frame]), 1024))).toEqual([ready])
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('Disconnected')) } })
    await expect(Array.fromAsync(readTaskEvents(new Response(stream), 1024))).rejects.toThrow('Disconnected')
    expect(stream.locked).toBe(false)
  })
  it('decodes split frames and ignores heartbeats and future event names', async () => {
    const chunks = [': heartbeat\n\nevent: future\ndata: {}\n\n' + frame.slice(0, 15), frame.slice(15)]
    expect(await Array.fromAsync(readTaskEvents(response(chunks), 1024))).toEqual([ready])
  })
  it('handles CRLF split across network reads', async () => {
    const crlf = frame.replaceAll('\n', '\r\n')
    const index = crlf.indexOf('\r') + 1
    expect(await Array.fromAsync(readTaskEvents(response([crlf.slice(0, index), crlf.slice(index)]), 1024))).toEqual([ready])
  })
  it('rejects conflicting frame identities and incomplete delivery', async () => {
    await expect(Array.fromAsync(readTaskEvents(response([frame.replace('event: ready', 'event: task')]), 1024))).rejects.toThrow('identity')
    await expect(Array.fromAsync(readTaskEvents(response([frame.slice(0, -1)]), 1024))).rejects.toThrow('incomplete')
  })
  it('bounds complete and partial frames by UTF-8 byte size', async () => {
    await expect(Array.fromAsync(readTaskEvents(response([frame]), 20))).rejects.toThrow('limit')
    await expect(Array.fromAsync(readTaskEvents(response(['data: ' + '中'.repeat(20)]), 32))).rejects.toThrow('limit')
    expect(await Array.fromAsync(readTaskEvents(response([frame + frame]), new TextEncoder().encode(frame).length))).toEqual([ready, ready])
  })
  it('passes resume identity and cancellation to Fetch without importing Cordis', async () => {
    const control = new AbortController()
    const client = new TaskApiClient({ baseUrl: 'https://tasks.example/api/task/v1', authentication: () => ({ bearer: 'device' }),
      fetch: async (input, init) => {
        expect(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url).toContain(`events?cursor=${encodeURIComponent(cursor)}`)
        expect(init?.signal).toBe(control.signal)
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer device')
        expect(init?.credentials).toBe('omit')
        return response([frame])
      } })
    expect(await Array.fromAsync(client.events({ signal: control.signal, cursor }))).toEqual([ready])
  })
})
