// @vitest-environment jsdom
/** Browser session lifecycle against a scripted gateway. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commandKey, describeFailure, TaskConnection } from '../src/support/connection.ts'

const TOKEN = 'a'.repeat(43)
const json = (status: number, body: unknown, type = 'application/json') => new Response(JSON.stringify(body), { status, headers: { 'content-type': type } })
const problem = (status: number, code: string) => json(status, {
  type: 'about:blank', status, title: 'rejected', detail: code, instance: '/api/task/v1/requests/1', code, requestId: 'request-1',
}, 'application/problem+json')
const session = { csrf: 'csrf-1', expiresAt: '2026-11-02T00:00:00.000Z' }

/** Replace fetch with a handler keyed by method and API path. */
function gateway(handler: (method: string, path: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: { method: string; path: string; headers: Headers }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const method = init?.method ?? 'GET'
    const path = url.pathname.replace('/api/task/v1/', '')
    calls.push({ method, path, headers: new Headers(init?.headers) })
    return handler(method, path, init)
  }))
  return calls
}

async function settle(connection: TaskConnection, kind: string): Promise<void> {
  await vi.waitFor(() => { expect(connection.state.get().kind).toBe(kind) })
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('TaskConnection', () => {
  it('exchanges a launch fragment and becomes ready once the service is', async () => {
    const calls = gateway((method, path) => {
      if (path === 'auth/exchange') return json(200, session)
      if (path === 'ready') return json(200, { ready: true, stopping: false })
      throw new Error(`unexpected ${method} ${path}`)
    })
    const connection = new TaskConnection('http://127.0.0.1:3081')
    await connection.start(`#launch=${TOKEN}`)
    await settle(connection, 'ready')
    expect(calls[0]).toMatchObject({ method: 'POST', path: 'auth/exchange' })
    expect(connection.state.get()).toEqual({ kind: 'ready', expiresAt: session.expiresAt })
  })

  it('reports invalid links, missing sessions and unreachable services', async () => {
    gateway(() => problem(401, 'authentication_required'))
    const invalid = new TaskConnection('http://127.0.0.1:3081')
    await invalid.start(`#launch=${TOKEN}`)
    expect(invalid.state.get()).toEqual({ kind: 'signed_out', reason: 'link_invalid' })
    const missing = new TaskConnection('http://127.0.0.1:3081')
    await missing.start('')
    expect(missing.state.get()).toEqual({ kind: 'signed_out', reason: 'no_session' })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const offline = new TaskConnection('http://127.0.0.1:3081')
    await offline.start('')
    expect(offline.state.get()).toEqual({ kind: 'unreachable' })
  })

  it('waits while the service recovers', async () => {
    vi.useFakeTimers()
    let ready = false
    gateway((_method, path) => {
      if (path === 'auth/session') return json(200, session)
      return ready ? json(200, { ready: true, stopping: false }) : json(503, { ready: false, stopping: false })
    })
    const connection = new TaskConnection('http://127.0.0.1:3081')
    await connection.start('')
    await vi.waitFor(() => { expect(connection.state.get().kind).toBe('recovering') })
    ready = true
    await vi.advanceTimersByTimeAsync(2000)
    expect(connection.state.get().kind).toBe('ready')
  })

  it('sends CSRF on writes, rereads the session after a CSRF rejection and signs out on expiry', async () => {
    let csrfRejected = false
    let expired = false
    const calls = gateway((method, path) => {
      if (path === 'auth/session') return json(200, { ...session, csrf: 'csrf-2' })
      if (path === 'ready') return json(200, { ready: true, stopping: false })
      if (path === 'auth/exchange') return json(200, session)
      if (path === 'runs/run-1/cancellation') {
        if (!csrfRejected) { csrfRejected = true; return problem(403, 'csrf_rejected') }
        return json(202, { runId: 'run-1', status: 'cancelling' })
      }
      if (path === 'diagnostics') return expired ? problem(401, 'authentication_required') : problem(404, 'not_found')
      throw new Error(`unexpected ${method} ${path}`)
    })
    const connection = new TaskConnection('http://127.0.0.1:3081')
    await connection.start(`#launch=${TOKEN}`)
    await settle(connection, 'ready')
    const key = commandKey()
    expect(await connection.call('cancelRun', { params: { runId: 'run-1' }, idempotencyKey: key })).toEqual({ runId: 'run-1', status: 'cancelling' })
    const writes = calls.filter(call => call.path === 'runs/run-1/cancellation')
    expect(writes.map(call => call.headers.get('x-csrf-token'))).toEqual(['csrf-1', 'csrf-2'])
    expect(writes.map(call => call.headers.get('idempotency-key'))).toEqual([key, key])
    await expect(connection.call('getDiagnostics')).rejects.toSatisfy(error => describeFailure(error).kind === 'problem')
    expect(connection.state.get().kind).toBe('ready')
    expired = true
    await expect(connection.call('getDiagnostics')).rejects.toThrow()
    expect(connection.state.get()).toEqual({ kind: 'signed_out', reason: 'session_ended' })
  })

  it('signs out through the gateway', async () => {
    const calls = gateway((_method, path) => {
      if (path === 'auth/exchange') return json(200, session)
      if (path === 'ready') return json(200, { ready: true, stopping: false })
      return json(200, { signedOut: true })
    })
    const connection = new TaskConnection('http://127.0.0.1:3081')
    await connection.start(`#launch=${TOKEN}`)
    await settle(connection, 'ready')
    await connection.logout()
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: 'auth/logout' })
    expect(calls.at(-1)?.headers.get('x-csrf-token')).toBe('csrf-1')
    expect(connection.state.get()).toEqual({ kind: 'signed_out', reason: 'no_session' })
  })
})

it('describes transport failures without a problem body', () => {
  expect(describeFailure(new TypeError('Failed to fetch'))).toEqual({ kind: 'transport', detail: 'Failed to fetch' })
  expect(commandKey()).toMatch(/^web-[0-9a-f]{32}$/)
})
