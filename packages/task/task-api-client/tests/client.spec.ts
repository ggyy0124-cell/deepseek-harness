/** Client validation and authentication operate through standard Fetch objects. */
import { describe, expect, it, vi } from 'vitest'
import { TaskApiClient, TaskApiError } from '../src/index.ts'

const baseUrl = 'http://127.0.0.1:3081/api/task/v1'
const authentication = () => ({ bearer: 'device-token' })

describe('Task JSON client', () => {
  it('rejects invalid event limits, command identities and undeclared arguments before transport', async () => {
    for (const eventLimitBytes of [0, -1, 1.1, Number.NaN]) {
      expect(() => new TaskApiClient({ baseUrl, fetch, authentication, eventLimitBytes })).toThrow('event byte limit')
    }
    const transport = vi.fn<typeof globalThis.fetch>()
    const client = new TaskApiClient({ baseUrl, fetch: transport, authentication })
    await expect(client.request('listDefinitions', { params: {} })).rejects.toThrow('path parameters')
    await expect(client.request('getRun', { params: { runId: 'r1' }, query: {} })).rejects.toThrow('query parameters')
    await expect(client.request('cancelRun', { params: { runId: 'r1' }, idempotencyKey: 'with space' })).rejects.toThrow('Idempotency-Key')
    await expect(client.upload('r1', [], 'with space')).rejects.toThrow('retry identity')
    await expect(client.credential('BAD/REFERENCE')).rejects.toThrow('credential reference')
    expect(transport).not.toHaveBeenCalled()
  })
  it('rejects malformed credential status without returning extra fields', async () => {
    const transport = vi.fn<typeof globalThis.fetch>()
    const client = new TaskApiClient({ baseUrl, fetch: transport, authentication })
    for (const value of [null, true, {}, { configured: null }, { configured: true }, { configured: true, writable: null }]) {
      transport.mockResolvedValueOnce(Response.json(value))
      await expect(client.credential('TASK_KEY')).rejects.toThrow('Invalid credential status')
    }
    transport.mockResolvedValueOnce(Response.json({ configured: true, writable: false, secret: 'private' }))
    expect(await client.credential('TASK_KEY')).toEqual({ configured: true, writable: false })
  })
  it('lists credential references without values and validates the listing', async () => {
    const transport = vi.fn<typeof globalThis.fetch>()
    const client = new TaskApiClient({ baseUrl, fetch: transport, authentication })
    const item = { reference: 'TASK_KEY', configured: true, writable: true, definitionIds: ['zentao.defects'] }
    transport.mockResolvedValueOnce(Response.json({ items: [item] }))
    expect(await client.credentials()).toEqual([item])
    const url = transport.mock.calls[0]![0]
    expect(url instanceof URL ? url.href : url).toBe(`${baseUrl}/credentials`)
    transport.mockResolvedValueOnce(Response.json({ items: [{ ...item, reference: 'not a reference' }] }))
    await expect(client.credentials()).rejects.toThrow()
  })
  it('validates successful responses and propagates network failure without retrying', async () => {
    const transport = vi.fn<typeof globalThis.fetch>()
    const client = new TaskApiClient({ baseUrl, fetch: transport, authentication })
    for (const response of [new Response(null), Response.json({ items: [] }, { status: 201 }), new Response('private')]) {
      transport.mockResolvedValueOnce(response)
      await expect(client.request('listDefinitions', {})).rejects.toThrow('unexpected success')
    }
    transport.mockRejectedValueOnce(new Error('Connection closed'))
    await expect(client.request('listDefinitions', {})).rejects.toThrow('Connection closed')
    expect(transport).toHaveBeenCalledTimes(4)
  })
  it('rejects invalid event responses and forwards independent Session cursors', async () => {
    const transport = vi.fn<typeof globalThis.fetch>()
    const client = new TaskApiClient({ baseUrl, fetch: transport, authentication })
    const signal = new AbortController().signal
    for (const response of [new Response(null), new Response(null, { status: 204 }), new Response('private')]) {
      transport.mockResolvedValueOnce(response)
      await expect(client.events({ signal }).next()).rejects.toThrow('unexpected event')
    }
    transport.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(client.events({ signal }).next()).rejects.toThrow('invalid error response')
    transport.mockResolvedValueOnce(new Response('', { headers: { 'content-type': 'text/event-stream' } }))
    expect(await client.sessionEvents({ runId: 'r1', cursor: 'session-cursor', signal }).next()).toMatchObject({ done: true })
    const url = transport.mock.calls.at(-1)![0]
    expect(url instanceof URL ? url.href : url).toBe(`${baseUrl}/runs/r1/events?cursor=session-cursor`)
  })
  it('uses browser CSRF for file uploads and validates file response metadata', async () => {
    const transport = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ items: [] }))
    const client = new TaskApiClient({ baseUrl, fetch: transport, authentication: () => ({ csrf: 'browser-csrf' }) })
    expect(await client.upload('r1', [], 'files1')).toEqual([])
    const [, init] = transport.mock.calls[0]!
    expect(new Headers(init?.headers).get('x-csrf-token')).toBe('browser-csrf')
    expect(init?.credentials).toBe('include')
    expect(await client.attachments('r1')).toEqual([])
    transport.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(client.download('r1', 'missing')).rejects.toThrow('invalid error response')
  })
  it('uses browser credentials for credential reads and writes without returning the value', async () => {
    const transport = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ configured: true, writable: true }))
    const client = new TaskApiClient({ baseUrl, fetch: transport, authentication: () => ({ csrf: 'browser-csrf' }) })
    await client.credential('TASK_KEY')
    await client.credential('TASK_KEY', 'private')
    const read = transport.mock.calls[0]![1]!
    const write = transport.mock.calls[1]![1]!
    expect(read.method).toBe('GET')
    expect(new Headers(read.headers).has('x-csrf-token')).toBe(false)
    expect(write.method).toBe('PUT')
    expect(new Headers(write.headers).get('x-csrf-token')).toBe('browser-csrf')
    expect(write.body).toBe('{"value":"private"}')
  })
  it('rejects protocol credential failures', async () => {
    const problem = { type: 'urn:dsh:task:credential', status: 403, title: 'Forbidden', detail: 'Denied', instance: '/credentials/TASK_KEY', code: 'denied', requestId: 'request' }
    const transport = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(problem), {
      status: 403, headers: { 'content-type': 'application/problem+json' },
    }))
    const client = new TaskApiClient({ baseUrl, fetch: transport, authentication })
    await expect(client.credential('TASK_KEY')).rejects.toMatchObject({ problem })
  })
  it('uploads every supplied file and sends the multipart body', async () => {
    const transport = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ items: [] }))
    const client = new TaskApiClient({ baseUrl, fetch: transport, authentication })
    await client.upload('r1', [new File(['content'], 'note.txt')], 'files2')
    const body = transport.mock.calls[0]![1]!.body
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).getAll('files')).toHaveLength(1)
  })
  it('downloads Session attachments with bearer authentication and a validated message position', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('file'))
    const client = new TaskApiClient({ baseUrl, fetch, authentication })
    expect(await (await client.downloadSessionAttachment('r1', 4, 2)).text()).toBe('file')
    const [url, init] = fetch.mock.calls[0]!
    expect(url instanceof URL ? url.href : url).toBe(`${baseUrl}/runs/r1/session-attachments/4/2`)
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer device-token')
    expect(init?.redirect).toBe('error')
    await expect(client.downloadSessionAttachment('r1', -1, 2)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('requests versioned resources without leaking credentials across redirects', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ items: [] }))
    const client = new TaskApiClient({ baseUrl, fetch, authentication })
    expect(await client.request('listDefinitions', {})).toEqual({ items: [] })
    const [url, init] = fetch.mock.calls[0]!
    expect(url instanceof URL ? url.href : url).toBe(`${baseUrl}/definitions`)
    expect(init?.redirect).toBe('error')
    expect(init?.credentials).toBe('omit')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer device-token')
  })
  it('validates commands before making a network request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const client = new TaskApiClient({ baseUrl, fetch, authentication })
    await expect(client.request('cancelRun', { params: { runId: 'r1' } })).rejects.toThrow('Idempotency-Key')
    await expect(client.request('getRun', { params: { runId: '../secret' } })).rejects.toThrow()
    await expect(client.request('listDefinitions', { body: { unexpected: true } })).rejects.toThrow('body')
    await expect(client.request('listRuns', { query: { limit: '201' } })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('sends cookie credentials and CSRF on browser commands', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ runId: 'r1', status: 'cancelling' }, { status: 202 }))
    const client = new TaskApiClient({ baseUrl, fetch, authentication: () => ({ csrf: 'session-csrf' }) })
    await client.request('cancelRun', { params: { runId: 'r1' }, idempotencyKey: 'command1' })
    const [, init] = fetch.mock.calls[0]!
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).get('x-csrf-token')).toBe('session-csrf')
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('command1')
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
  })
  it('sends browser reads without CSRF and forwards query and cancellation', async () => {
    const transport = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }))
      .mockResolvedValueOnce(new Response('', { headers: { 'content-type': 'text/event-stream' } }))
    const signal = new AbortController().signal
    const client = new TaskApiClient({ baseUrl, fetch: transport, authentication: () => ({ csrf: 'session-csrf' }) })
    await client.request('listDefinitions', {})
    await client.request('listRuns', { query: { limit: '2' }, signal })
    expect(await client.sessionEvents({ runId: 'r1', signal }).next()).toMatchObject({ done: true })
    const [readUrl, readInit] = transport.mock.calls[0]!
    expect(readUrl instanceof URL ? readUrl.href : readUrl).toBe(`${baseUrl}/definitions`)
    expect(new Headers(readInit?.headers).has('x-csrf-token')).toBe(false)
    expect(readInit?.credentials).toBe('include')
    const [queryUrl, queryInit] = transport.mock.calls[1]!
    expect(queryUrl instanceof URL ? queryUrl.href : queryUrl).toBe(`${baseUrl}/runs?limit=2`)
    expect(queryInit?.signal).toBe(signal)
    expect(transport.mock.calls[2]![1]?.credentials).toBe('include')
  })
  it('applies an empty query object when a query-capable operation omits it', async () => {
    const transport = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ items: [], nextCursor: null }))
    const client = new TaskApiClient({ baseUrl, fetch: transport, authentication })
    await client.request('listRuns', {})
    const url = transport.mock.calls[0]![0]
    expect(url instanceof URL ? url.search : '').toBe('')
  })
  it('preserves typed conflict details without retrying a write', async () => {
    const problem = { type: 'urn:dsh:task:conflict', status: 409, title: 'Conflict', detail: 'Interaction changed', instance: '/runs/r1', code: 'interaction-stale', requestId: 'request1', currentRevision: 2 }
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(problem), { status: 409, headers: { 'content-type': 'application/problem+json' } }))
    const client = new TaskApiClient({ baseUrl, fetch, authentication })
    const result = client.request('respond', { params: { runId: 'r1', waitId: 'w1' }, body: { revision: 1, response: true }, idempotencyKey: 'reply1' })
    await expect(result).rejects.toBeInstanceOf(TaskApiError)
    await expect(result).rejects.toMatchObject({ problem })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not expose non-protocol error bodies', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('private stack', { status: 500 }))
    const client = new TaskApiClient({ baseUrl, fetch, authentication })
    await expect(client.request('listDefinitions', {})).rejects.toThrow('invalid error response (500)')
  })
  it('ignores added response fields and rejects inconsistent problem status', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ items: [], secret: 'leak' }))
    const client = new TaskApiClient({ baseUrl, fetch, authentication })
    expect(await client.request('listDefinitions', {})).toEqual({ items: [] })
    fetch.mockResolvedValue(new Response(JSON.stringify({ type: 'urn:x', status: 400, title: '', detail: '', instance: '', code: 'bad', requestId: 'r' }), { status: 409, headers: { 'content-type': 'application/problem+json' } }))
    await expect(client.request('listDefinitions', {})).rejects.toThrow('status differs')
  })
  it.each(['file:///tmp/api', 'https://secret@example.com/api', `${baseUrl}?token=x`, `${baseUrl}#token=x`])('rejects invalid base URL %s', (value) => {
    expect(() => new TaskApiClient({ baseUrl: value, fetch: globalThis.fetch, authentication })).toThrow('base URL')
  })
})
