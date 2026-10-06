/** Instrumented gateway composition exercises HTTP, engine receipts and real Session persistence together. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CredentialProvider, CredentialRecord, CredentialRef } from '@deepseek-ai/dsh-credentials'
import { TaskCommandError, type TaskDefinition, type TaskDefinitionId } from '@deepseek-ai/dsh-task'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TaskApiClient } from '@deepseek-ai/dsh-task-api-client'
import { z } from 'zod'
import { taskHost } from '../../task-local/tests/host-fixture.ts'
import TaskApiGateway, { type Config } from '../src/index.ts'
import { stub } from '../../task-local/tests/stub.ts'

const disposers: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of disposers.splice(0).reverse()) await close() })

async function gateway(definitionOverrides: Partial<TaskDefinition> = {}, gatewayConfig: Partial<Config> = {}, deferReady = false) {
  const host = await taskHost()
  disposers.push(host.close)
  const { ctx, directory } = host
  const secrets = new Map<CredentialRef, string>()
  let record: CredentialRecord | undefined
  let tail: Promise<unknown> = Promise.resolve()
  const credentials: Pick<CredentialProvider, 'readRecord' | 'modifyRecord' | 'set' | 'describe'> = {
    readRecord: async () => structuredClone(record),
    modifyRecord: async (_key, mutate) => {
      const change = tail.then(async () => {
        const next = await mutate(structuredClone(record))
        if (next !== undefined) record = structuredClone(next)
        return structuredClone(record)
      })
      tail = change.catch(() => {})
      return change
    },
    set: async (ref, value) => { secrets.set(ref, value) },
    describe: async ref => ({ configured: secrets.has(ref), writable: true }),
  }
  // This consumer uses these four credential operations; embedded attachments are tested by their owning reader.
  ctx.provide('credentials', credentials as CredentialProvider)
  ctx.provide('attachments', {} as Context['attachments'])
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  let fireReady = () => {}
  if (deferReady) ctx.provide('appReady', {
    onReady(listener) { fireReady = listener; return () => { fireReady = () => {} } },
  } satisfies NonNullable<Context['appReady']>)
  const origin = `http://127.0.0.1:${ctx.webServer.port}`
  // Schemastery's input type includes fields supplied by its runtime defaults.
  const config = TaskApiGateway.Config({ attachmentRoot: join(directory, 'attachments'), eventPollMs: 10, eventHeartbeatMs: 100,
    ...gatewayConfig, ...(gatewayConfig.publicOrigin === '__bound__' ? { publicOrigin: origin } : {}) } as Config)
  const gatewayFiber = await ctx.plugin(TaskApiGateway, config)
  const device = await ctx.taskGateway.createDeviceToken()
  const baseUrl = `${origin}/api/task/v1/`
  const client = new TaskApiClient({ baseUrl, fetch, authentication: () => ({ bearer: device.token }) })
  const raw = (path: string, init: RequestInit = {}) => {
    const headers = new Headers({ Authorization: `Bearer ${device.token}` })
    new Headers(init.headers).forEach((value, key) => { headers.set(key, value) })
    return fetch(baseUrl + path, { ...init, headers, redirect: 'error' })
  }
  const definition: TaskDefinition = {
    id: brandString<TaskDefinitionId>('instrumented'), title: 'Instrumented task', codeVersion: '1',
    config: { schedule: { kind: 'manual' }, concurrency: 1, preset: 'minimal', permissionPreset: 'read-only',
      workspacePath: directory, business: null },
    forms: { version: 1, business: { type: 'null' }, input: {} },
    parseInput: value => z.json().parse(value), parseCheckpoint: value => z.json().parse(value),
    priority: () => 0, resources: () => [],
    runSpecial: async stage => stage.run.checkpoint === null
      ? { kind: 'wait', checkpoint: true, prompt: 'Continue', schema: { type: 'boolean' } }
      : { kind: 'succeed', result: 'Completed' },
    classifyError: (_error, run) => ({ kind: 'block', checkpoint: run.checkpoint, reason: 'repair' }),
    cleanup: async () => {},
    checkConfig: async () => ['valid'],
    options: async () => [{ value: 'option', label: 'Option' }],
    ...definitionOverrides,
  }
  await ctx.plugin({ name: 'gateway-business', inject: ['tasks'], apply(owner: Context) { owner.tasks.register(owner, definition) } })
  return { ...host, client, raw, origin, device, definition, fireReady, gatewayFiber }
}

describe('Task gateway composition', () => {
  it('drains a handler failure and rejects operations after gateway disposal', async () => {
    const { ctx, raw, gatewayFiber } = await gateway()
    // Private request plumbing, reached only to inject a transport failure.
    const internals: unknown = ctx.taskGateway
    const service = internals as {
      handle(request: IncomingMessage, response: ServerResponse): Promise<void>
      assertRunning(): void
      pending: Map<Promise<void>, unknown>
    }
    const handle = vi.spyOn(service, 'handle').mockRejectedValueOnce(new Error('transport failed'))
    await expect(raw('definitions')).rejects.toThrow()
    await expect.poll(() => service.pending.size).toBe(0)
    handle.mockRestore()
    await gatewayFiber.dispose()
    expect(() => { service.assertRunning() }).toThrow('stopping')
  })

  it('keeps a cleanup-blocked run read-only and settles its recorded outcome after a cleanup retry', async () => {
    let failures = 1
    const { client, definition } = await gateway({
      runSpecial: async () => ({ kind: 'succeed', result: 'Completed' }),
      cleanup: async () => { if (failures-- > 0) throw new Error('worktree busy') },
    })
    const run = await client.request('triggerManual', { params: { definitionId: definition.id },
      body: { input: null }, idempotencyKey: 'blocked-cleanup' })
    const read = () => client.request('getRun', { params: { runId: run.id } })
    await expect.poll(async () => (await read()).cleanup).toBe('blocked')
    expect(await read()).toMatchObject({ status: 'blocked', outcome: 'succeeded', terminalAt: null })
    await expect(client.upload(run.id, [new File(['late'], 'late.txt')], 'blocked-upload'))
      .rejects.toMatchObject({ problem: { status: 409, code: 'run_readonly' } })
    expect(await client.request('retryCleanup', { params: { runId: run.id }, idempotencyKey: 'repair' }))
      .toMatchObject({ runId: run.id, status: 'cancelling' })
    await expect.poll(async () => (await read()).status).toBe('succeeded')
    expect(await read()).toMatchObject({ cleanup: 'complete', outcome: 'succeeded', result: 'Completed' })
  })

  it('refuses a transcript read if its response was already destroyed', async () => {
    const { ctx, client, definition } = await gateway()
    const run = await client.request('triggerManual', { params: { definitionId: definition.id },
      body: { input: null }, idempotencyKey: 'closed-transcript' })
    const response = stub<ServerResponse>(Object.assign(new EventEmitter(), { destroyed: true }))
    const internals: unknown = ctx.taskGateway
    const service = internals as { transcript(response: ServerResponse,
      params: Record<string, string>, query: Record<string, string>): Promise<unknown> }
    await expect(service.transcript(response, { runId: run.id }, {})).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('publishes permission choices and reports business availability errors without hiding their category', async () => {
    const { ctx, client, definition } = await gateway({
      checkConfig: async () => { throw new TaskCommandError('unavailable', 'Business service is offline') },
    })
    Object.assign(ctx.permissionPresets, {
      names: ['restricted'], optionOf: () => ({ name: 'Restricted' }),
    })
    expect(await client.request('getCatalog', {})).toMatchObject({ permissions: [{ id: 'restricted', title: 'Restricted' }] })
    await expect(client.request('checkConfig', { params: { definitionId: definition.id },
      body: { config: definition.config }, idempotencyKey: 'service-offline' }))
      .rejects.toMatchObject({ problem: { status: 503, code: 'unavailable' } })
    const other = await gateway({
      checkConfig: async () => { throw new TaskCommandError('invalid_configuration', 'Configuration requires repair') },
    })
    await expect(other.client.request('checkConfig', { params: { definitionId: other.definition.id },
      body: { config: other.definition.config }, idempotencyKey: 'invalid-configuration' }))
      .rejects.toMatchObject({ problem: { status: 400, code: 'invalid_configuration' } })
  })

  it('aborts transcript reads when the caller closes its connection', async () => {
    const { ctx, raw, definition, client } = await gateway()
    const run = await client.request('triggerManual', { params: { definitionId: definition.id },
      body: { input: null }, idempotencyKey: 'transcript-cancel' })
    const entered = Promise.withResolvers<AbortSignal>()
    const cancelled = Promise.withResolvers<boolean>()
    const open = vi.spyOn(ctx.sessionPersistence, 'open').mockImplementation(async (_id, _mode, options) => {
      const signal = options?.signal
      if (signal === undefined) throw new Error('Transcript reads must be cancellable')
      entered.resolve(signal)
      return new Promise<SessionHandle>((_resolve, reject) => {
        signal.addEventListener('abort', () => { cancelled.resolve(true); reject(new Error('Caller disconnected')) }, { once: true })
      })
    })
    const controller = new AbortController()
    const pending = raw(`runs/${run.id}/transcript`, { signal: controller.signal })
    const settled = pending.then(response => ({ response }), (error: unknown) => ({ error }))
    try {
      const signal = await Promise.race([entered.promise, settled.then(() => { throw new Error('Transcript completed before cancellation') })])
      controller.abort()
      expect(await settled).toMatchObject({ error: { name: 'AbortError' } })
      await cancelled.promise
      expect(signal.aborted).toBe(true)
    } finally { controller.abort(); await pending.catch(() => {}); open.mockRestore() }
  })

  it('downloads a visible Session attachment through the authenticated run route', async () => {
    const { ctx, raw, definition, client } = await gateway()
    const run = await client.request('triggerManual', { params: { definitionId: definition.id },
      body: { input: null }, idempotencyKey: 'session-file' })
    // A persisted file block as the durable reader returns it, before attachment ids are branded.
    const persisted: unknown = { seq: 1, time: 1, type: 'user/message', surfaceOp: 'append',
      data: { content: [{ type: 'file', attachment: { attachmentId: 'file-id', name: 'report.txt', bytes: 6 } }],
        source: { kind: 'user' } } }
    const event = persisted as SessionEvent
    const close = vi.fn(async () => {})
    const open = vi.spyOn(ctx.sessionPersistence, 'open').mockResolvedValue(stub<SessionHandle>({
      read: async () => ({ events: [event], eventState: 'owned' as const }),
      [Symbol.asyncDispose]: close,
    }))
    Object.assign(ctx.attachments, {
      readFileStream: async function* () { yield new TextEncoder().encode('report') },
    })
    try {
      const response = await raw(`runs/${run.id}/session-attachments/1/0`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('report')
      expect(response.headers.get('content-disposition')).toContain('report.txt')
      expect(close).toHaveBeenCalledOnce()
    } finally { open.mockRestore() }
  })

  it('lists available model choices while isolating a provider discovery failure', async () => {
    const { ctx, client } = await gateway()
    const providers = vi.spyOn(ctx.llm, 'listProviders').mockReturnValue([{ id: 'available', name: 'Available' }, { id: 'offline', name: 'Offline' }])
    const models = vi.spyOn(ctx.llm, 'listModels').mockImplementation(async (provider) => {
      if (provider === 'offline') throw new Error('discovery unavailable')
      return [{ id: 'model', name: 'Model', provider }]
    })
    try { expect(await client.request('getCatalog', {})).toMatchObject({ models: [{ provider: 'available', model: 'model', title: 'Model' }] }) }
    finally { providers.mockRestore(); models.mockRestore() }
  })

  it('aborts an outstanding business configuration check when its HTTP caller disconnects', async () => {
    const entered = Promise.withResolvers<AbortSignal>()
    const cancelled = Promise.withResolvers<boolean>()
    const { raw, definition } = await gateway({ checkConfig: async (_config, signal) => {
      entered.resolve(signal)
      return new Promise<readonly string[]>((_resolve, reject) => {
        signal.addEventListener('abort', () => { cancelled.resolve(true); reject(new Error('Client disconnected')) }, { once: true })
      })
    } })
    const controller = new AbortController()
    const request = raw(`definitions/${definition.id}/config/check`, { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'disconnect' }, body: JSON.stringify({ config: definition.config }) })
    const settled = request.then(response => ({ response }), (error: unknown) => ({ error }))
    try {
      const signal = await Promise.race([entered.promise, settled.then(() => { throw new Error('Configuration check completed before cancellation') })])
      controller.abort()
      expect(await settled).toMatchObject({ error: { name: 'AbortError' } })
      await cancelled.promise
      expect(signal.aborted).toBe(true)
    } finally { controller.abort(); await request.catch(() => {}) }
  })

  it('validates an explicit public origin and waits for application readiness', async () => {
    await expect(gateway({}, { publicOrigin: 'https://tasks.example/path' })).rejects.toThrow('publicOrigin')
    const { raw, fireReady } = await gateway({}, { publicOrigin: '__bound__' }, true)
    expect((await raw('ready')).status).toBe(503)
    fireReady()
    await expect.poll(async () => (await raw('ready')).status).toBe(200)
  })

  it('sets Secure on browser cookies for an HTTPS public origin behind a local listener', async () => {
    const { ctx, origin } = await gateway({}, { publicOrigin: 'https://tasks.example' })
    const body = JSON.stringify({ token: (await ctx.taskGateway.createLaunchToken()).token })
    const result = await new Promise<{ status: number; cookie: string | undefined; body: string }>((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port: new URL(origin).port, path: '/api/task/v1/auth/exchange',
        method: 'POST', headers: { Host: 'tasks.example', Origin: 'https://tasks.example',
          'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        response.once('error', reject)
        response.once('end', () => { resolve({ status: response.statusCode!, cookie: response.headers['set-cookie']?.[0],
          body: Buffer.concat(chunks).toString() }) })
      })
      request.once('error', reject)
      request.end(body)
    })
    expect(result.status, result.body).toBe(200)
    expect(result.cookie).toContain('; Secure')
  })

  it('rejects malformed routes, origins, commands and missing execution references over HTTP', async () => {
    const { raw, definition, client, origin, device } = await gateway()
    const run = await client.request('triggerManual', { params: { definitionId: definition.id }, body: { input: null }, idempotencyKey: 'wire-run' })
    await expect.poll(async () => (await client.request('getRun', { params: { runId: run.id } })).status).toBe('waiting_input')
    const cases: [string, RequestInit, number, string][] = [
      ['definitions?extra=1&extra=2', {}, 400, 'duplicate_query'],
      ['definitions', { headers: { Origin: 'https://unrelated.example' } }, 403, 'origin_rejected'],
      ['definitions', { headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403, 'origin_rejected'],
      ['definitions/%FF', {}, 400, 'invalid_path'],
      ['missing-route', {}, 404, 'route_not_found'],
      ['definitions', { method: 'DELETE' }, 405, 'route_not_found'],
      ['credentials/TASK_KEY', { method: 'DELETE' }, 405, 'method_not_allowed'],
      ['runs/missing/attachments', {}, 404, 'not_found'],
      [`runs/${run.id}/attachments`, { method: 'DELETE' }, 405, 'method_not_allowed'],
      [`runs/${run.id}/session-attachments/1/0`, { method: 'DELETE' }, 405, 'method_not_allowed'],
      ['runs/missing/session-attachments/1/0', {}, 404, 'not_found'],
      [`runs/${run.id}/session-attachments/1/0`, {}, 404, 'not_found'],
      ['auth/session', {}, 401, 'authentication_required'],
      ['auth/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 403, 'origin_rejected'],
      [`runs/${run.id}/cancellation`, { method: 'POST' }, 400, 'invalid_request'],
      ['events?cursor=00000000-0000-0000-0000-000000000001:0', { headers: { 'Last-Event-ID': '00000000-0000-0000-0000-000000000001:1' } }, 400, 'ambiguous_cursor'],
    ]
    for (const [path, init, status, code] of cases) {
      const response = await raw(path, init)
      expect(await response.json(), `${path}:${code}`).toMatchObject({ status, code })
      expect(response.status, path).toBe(status)
    }
    // Fetch owns Host and GET body handling; raw HTTP exercises those wire-level rejections.
    const exchange = async (path: string, headers: string[], body?: string) =>
      new Promise<{ status: number; value: unknown }>((resolve, reject) => {
        const request = httpRequest(`${origin}/api/task/v1/${path}`, { headers: [
          'Host', new URL(origin).host, 'Authorization', `Bearer ${device.token}`, ...headers,
        ] }, (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
          response.once('error', reject)
          response.once('end', () => { resolve({ status: response.statusCode!, value: JSON.parse(Buffer.concat(chunks).toString()) }) })
        })
        request.once('error', reject)
        request.end(body)
      })
    expect(await exchange('definitions', ['Host', 'unrelated.example'])).toMatchObject({ status: 400, value: { code: 'duplicate_header' } })
    const rawExchange = (path: string, host = 'unrelated.example') => new Promise<{ status: number; value: unknown }>((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port: new URL(origin).port, path, headers: { Host: host, Authorization: `Bearer ${device.token}` } }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        response.once('error', reject)
        response.once('end', () => { resolve({ status: response.statusCode!, value: JSON.parse(Buffer.concat(chunks).toString()) }) })
      })
      request.once('error', reject); request.end()
    })
    expect(await rawExchange('/api/task/v1/definitions')).toMatchObject({ status: 403, value: { code: 'host_rejected' } })
    for (const path of ['health', 'events', 'auth/session', 'openapi.json', 'definitions']) {
      expect(await exchange(path, ['Content-Type', 'application/json', 'Content-Length', '2'], '{}'))
        .toMatchObject({ status: 400, value: { code: 'unexpected_body' } })
    }
    expect((await (await raw('openapi.json')).json() as { openapi: string }).openapi).toBe('3.1.0')
    const config = { ...definition.config, model: { provider: 'unused', model: 'unused' } }
    const params = { definitionId: definition.id }
    await client.request('configureDefinition', { params, body: { revision: 1, configSchemaVersion: 1, config }, idempotencyKey: 'model-config' })
    await expect(client.request('configureDefinition', { params, body: { revision: 1, configSchemaVersion: 1, config }, idempotencyKey: 'stale-config' }))
      .rejects.toMatchObject({ problem: { status: 409, currentRevision: 2 } })
    expect(await client.request('checkConfig', { params, body: { config }, idempotencyKey: 'model-check' })).toEqual({ messages: ['valid'] })
  })

  it('bounds event connections and contains plugin errors without echoing their messages', async () => {
    const { raw, client, definition } = await gateway({ checkConfig: async () => { throw new Error('private-plugin-detail') } }, { eventConnectionLimit: 1 })
    await expect(client.request('checkConfig', { params: { definitionId: definition.id }, body: { config: definition.config }, idempotencyKey: 'private' }))
      .rejects.toMatchObject({ problem: { status: 500, code: 'internal_error', detail: 'Task request failed' } })
    const events = client.events({ signal: AbortSignal.timeout(5000) })
    try {
      expect((await events.next()).value).toMatchObject({ kind: 'ready' })
      const denied = await raw('events')
      expect(await denied.json()).toMatchObject({ status: 503, code: 'stream_capacity' })
    } finally { await events.return(undefined) }
  })

  it('rejects oversized complete responses without publishing a partial successful payload', async () => {
    const { raw } = await gateway({}, { responseLimitBytes: 1024 })
    const response = await raw('openapi.json')
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'response_too_large' })
  })
  it('keeps command receipts, configuration revisions and history pagination consistent', async () => {
    const { client, definition } = await gateway()
    const params = { definitionId: definition.id }
    await expect(client.request('getRetirement', { params })).rejects.toMatchObject({ problem: { status: 404 } })
    await expect(client.request('getDefinition', { params: { definitionId: 'missing' } })).rejects.toMatchObject({ problem: { status: 404 } })
    await expect(client.request('getRun', { params: { runId: 'missing' } })).rejects.toMatchObject({ problem: { status: 404 } })
    await expect(client.request('triggerManual', { params: { definitionId: 'missing' }, body: { input: null }, idempotencyKey: 'missing-definition' }))
      .rejects.toMatchObject({ problem: { status: 404 } })
    const original = await client.request('getDefinition', { params })
    const config = { ...original.config, concurrency: 2 }
    await expect(client.request('configureDefinition', { params,
      body: { revision: original.revision, configSchemaVersion: 99, config }, idempotencyKey: 'wrong-schema' }))
      .rejects.toMatchObject({ problem: { status: 409 } })
    const configured = await client.request('configureDefinition', { params,
      body: { revision: original.revision, configSchemaVersion: 1, config }, idempotencyKey: 'config' })
    const disabled = await client.request('enableDefinition', { params, body: { revision: configured.revision, enabled: false }, idempotencyKey: 'disable' })
    await expect(client.request('triggerManual', { params, body: { input: null }, idempotencyKey: 'disabled' }))
      .rejects.toMatchObject({ problem: { status: 409 } })
    const enabled = await client.request('enableDefinition', { params, body: { revision: disabled.revision, enabled: true }, idempotencyKey: 'enable' })
    const first = await client.request('triggerManual', { params, body: { input: null }, idempotencyKey: 'first' })
    const second = await client.request('triggerManual', { params, body: { input: null }, idempotencyKey: 'second' })
    await client.request('sendInput', { params: { runId: first.id }, body: { input: 'extra' }, idempotencyKey: 'input' })
    expect(await client.request('listInputs', { params: { runId: first.id } }))
      .toMatchObject({ items: [{ revision: 1, kind: 'input', value: 'extra', consumed: false }] })
    await expect(client.request('listInputs', { params: { runId: 'missing' } })).rejects.toMatchObject({ problem: { status: 404 } })
    const page = await client.request('listRuns', { query: { limit: '1', definitionId: definition.id, kind: 'manual',
      createdFrom: '2020-01-01T00:00:00.000Z', createdTo: '2099-01-01T00:00:00.000Z' } })
    expect(page.items[0]?.id).toBe(second.id)
    const next = await client.request('listRuns', { query: { limit: '1', definitionId: definition.id, kind: 'manual',
      createdFrom: '2020-01-01T00:00:00.000Z', createdTo: '2099-01-01T00:00:00.000Z', cursor: page.nextCursor! } })
    expect(next.items[0]?.id).toBe(first.id)
    expect(await client.request('listRuns', { query: { businessKey: 'absent', status: 'failed' } })).toMatchObject({ items: [], nextCursor: null })
    await expect(client.request('listRuns', { query: { cursor: page.nextCursor! } })).rejects.toMatchObject({ problem: { status: 400 } })
    await expect(client.request('listRuns', { query: { cursor: 'invalid-json' } })).rejects.toMatchObject({ problem: { status: 400 } })
    await expect(client.request('listRuns', { query: { createdFrom: '2027-01-01T00:00:00.000Z', createdTo: '2020-01-01T00:00:00.000Z' } }))
      .rejects.toMatchObject({ problem: { status: 400 } })
    await client.request('cancelRun', { params: { runId: first.id }, idempotencyKey: 'cancel' })
    await expect.poll(async () => (await client.request('getRun', { params: { runId: first.id } })).status).toBe('cancelled')
    expect(await client.request('listInteractions', { params: { runId: first.id } })).toEqual({ items: [] })
    const retirement = await client.request('retireDefinition', { params, body: { revision: enabled.revision }, idempotencyKey: 'retire' })
    expect(retirement.state).toBe('pending')
    await expect.poll(async () => (await client.request('getRetirement', { params })).state).toBe('complete')
    expect(await client.request('getDiagnostics', {})).toMatchObject({ activeRuns: 0, retirements: [] })
  })

  it('projects configuration, waits, event streams and immutable attachments over HTTP', async () => {
    const { ctx, client, raw, definition } = await gateway()
    await expect.poll(async () => (await raw('ready')).status).toBe(200)
    expect((await raw('health')).status).toBe(200)
    expect(await client.request('listDefinitions', {})).toMatchObject({ items: [{ configSchemaVersion: 1 }] })
    expect(await client.request('getCatalog', {})).toMatchObject({ presets: [{ id: 'minimal' }] })
    expect(await client.request('checkConfig', { params: { definitionId: definition.id }, body: { config: definition.config },
      idempotencyKey: 'check' })).toEqual({ messages: ['valid'] })
    expect(await client.request('getOptions', { params: { definitionId: definition.id }, body: { config: definition.config, field: 'choice' },
      idempotencyKey: 'options' })).toMatchObject({ items: [{ value: 'option' }] })
    const events = client.events({ signal: AbortSignal.timeout(5000) })
    try {
      expect((await events.next()).value).toMatchObject({ kind: 'ready' })
      const run = await client.request('triggerManual', { params: { definitionId: definition.id }, body: { input: null }, idempotencyKey: 'run' })
      expect((await events.next()).value).toMatchObject({ kind: 'task', runId: run.id })
      await expect.poll(async () => (await client.request('getRun', { params: { runId: run.id } })).status).toBe('waiting_input')
      const session = client.sessionEvents({ runId: run.id, signal: AbortSignal.timeout(5000) })
      try { expect((await session.next()).value).toMatchObject({ kind: 'session_ready' }) } finally { await session.return(undefined) }
      const uploads = [new File(['saved file'], 'note.txt', { type: 'text/plain' }), new File([], 'empty.txt')]
      const attachments = await client.upload(run.id, uploads, 'upload')
      expect(await client.upload(run.id, uploads, 'upload')).toEqual(attachments)
      expect(await client.attachments(run.id)).toEqual(attachments)
      expect(await (await client.download(run.id, attachments[0]!.id)).text()).toBe('saved file')
      expect((await client.download(run.id, attachments[1]!.id)).size).toBe(0)
      for (const [range, expected] of [['bytes=6-', 'file'], ['bytes=-4', 'file'], ['bytes=0-4', 'saved']]) {
        const response = await raw(`runs/${run.id}/attachments/${attachments[0]!.id}`, { headers: { Range: range! } })
        expect(response.status).toBe(206)
        expect(await response.text()).toBe(expected)
      }
      for (const range of ['bytes=-', 'bytes=999-', 'bytes=0-1,3-4']) {
        expect((await raw(`runs/${run.id}/attachments/${attachments[0]!.id}`, { headers: { Range: range } })).status).toBe(416)
      }
      const waiting = (await client.request('listInteractions', { params: { runId: run.id } })).items[0]!
      await client.request('respond', { params: { runId: run.id, waitId: waiting.id },
        body: { revision: waiting.revision, response: true }, idempotencyKey: 'response' })
      await expect.poll(async () => (await client.request('getRun', { params: { runId: run.id } })).status).toBe('succeeded')
      expect(await client.request('getTranscript', { params: { runId: run.id } })).toMatchObject({ sessionId: run.sessionId })
      await expect(client.upload(run.id, uploads, 'late')).rejects.toMatchObject({ problem: { status: 409 } })
      expect(await client.request('getDiagnostics', {})).toMatchObject({ activeRuns: 0, completedRuns: 1 })
      await ctx.tasks.shutdown()
      expect((await raw('ready')).status).toBe(503)
      expect((await raw('health')).status).toBe(200)
    } finally { await events.return(undefined) }
  })

  it('validates multipart fields, sanitizes metadata and enforces upload retry identity', async () => {
    const { client, raw, definition } = await gateway()
    const run = await client.request('triggerManual', {
      params: { definitionId: definition.id }, body: { input: null }, idempotencyKey: 'attachment-run',
    })
    await expect.poll(async () => (await client.request('getRun', { params: { runId: run.id } })).status).toBe('waiting_input')
    const path = `runs/${run.id}/attachments`
    const post = (body: BodyInit, id: string, contentType?: string) => raw(path, {
      method: 'POST', body, headers: {
        'Idempotency-Key': id,
        ...(contentType === undefined ? {} : { 'Content-Type': contentType }),
      },
    })
    expect((await post('broken', 'missing-content-type')).status).toBe(400)
    expect((await post('broken', 'malformed', 'multipart/form-data; boundary=missing')).status).toBe(400)
    expect((await post(new FormData(), 'empty')).status).toBe(400)
    const field = new FormData(); field.set('description', 'text')
    expect((await post(field, 'field')).status).toBe(400)
    const file = new File(['x'], '///', { type: '' })
    const first = await client.upload(run.id, [file], 'first-content')
    expect(first[0]).toMatchObject({ name: '___', mime: 'application/octet-stream' })
    expect(await client.upload(run.id, [file], 'second-content')).toMatchObject([{ digest: first[0]!.digest }])
    expect((await raw(`${path}/missing`)).status).toBe(404)
    await expect(client.upload(run.id, [new File(['y'], 'other.txt')], 'first-content'))
      .rejects.toMatchObject({ problem: { status: 409, code: 'idempotency_conflict' } })
  })

  it('enforces per-file and per-upload file-count limits', async () => {
    const { client, definition } = await gateway({}, { attachmentFileLimitBytes: 1, attachmentFileLimit: 1 })
    const run = await client.request('triggerManual', {
      params: { definitionId: definition.id }, body: { input: null }, idempotencyKey: 'limited-run',
    })
    await expect.poll(async () => (await client.request('getRun', { params: { runId: run.id } })).status).toBe('waiting_input')
    await expect(client.upload(run.id, [new File(['xx'], 'large.txt')], 'large'))
      .rejects.toMatchObject({ problem: { status: 413, code: 'file_too_large' } })
    await expect(client.upload(run.id, [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')], 'many'))
      .rejects.toMatchObject({ problem: { status: 400, code: 'invalid_upload_count' } })
  })

  it('exchanges browser credentials and enforces mutation origins, CSRF and logout', async () => {
    const { ctx, origin, raw, client, device } = await gateway()
    expect(await client.credential('TASK_INSTRUMENTED')).toEqual({ configured: false, writable: true })
    expect(await client.credential('TASK_INSTRUMENTED', 'private')).toEqual({ configured: true, writable: true })
    const exchange = await raw('auth/exchange', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: (await ctx.taskGateway.createLaunchToken()).token }) })
    const cookie = exchange.headers.get('set-cookie')!.split(';')[0]!
    const { csrf, expiresAt } = await exchange.json() as { csrf: string; expiresAt: string }
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000)
    const browserFetch: typeof fetch = (url, init) => {
      const headers = new Headers(init?.headers)
      headers.set('Cookie', cookie); headers.set('Origin', origin)
      return fetch(url, { ...init, headers })
    }
    const browser = new TaskApiClient({ baseUrl: `${origin}/api/task/v1/`, fetch: browserFetch, authentication: () => ({ csrf }) })
    expect(await browser.credential('TASK_INSTRUMENTED')).toEqual({ configured: true, writable: true })
    const deniedCredential = await browserFetch(`${origin}/api/task/v1/credentials/TASK_DENIED`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"value":"private"}',
    })
    expect(await deniedCredential.json()).toMatchObject({ status: 403, code: 'csrf_rejected' })
    await browser.credential('TASK_BROWSER', 'another')
    const run = await client.request('triggerManual', {
      params: { definitionId: 'instrumented' }, body: { input: null }, idempotencyKey: 'browser-csrf-run',
    })
    await expect.poll(async () => (await client.request('getRun', { params: { runId: run.id } })).status).toBe('waiting_input')
    const deniedCommand = await browserFetch(`${origin}/api/task/v1/runs/${run.id}/cancellation`, {
      method: 'POST', headers: { 'Idempotency-Key': 'denied-command' },
    })
    expect(await deniedCommand.json()).toMatchObject({ status: 403, code: 'csrf_rejected' })
    const deniedUpload = await browserFetch(`${origin}/api/task/v1/runs/${run.id}/attachments`, {
      method: 'POST', headers: { 'Idempotency-Key': 'denied-upload' }, body: new FormData(),
    })
    expect(await deniedUpload.json()).toMatchObject({ status: 403, code: 'csrf_rejected' })
    expect(await browser.upload(run.id, [new File(['browser'], 'browser.txt')], 'browser-upload'))
      .toMatchObject([{ name: 'browser.txt' }])
    expect(await browser.request('cancelRun', { params: { runId: run.id }, idempotencyKey: 'browser-cancel' }))
      .toMatchObject({ status: 'cancelling' })
    const status = await browserFetch(`${origin}/api/task/v1/auth/session`)
    expect(await status.json()).toEqual({ csrf, expiresAt })
    const deniedLogout = await browserFetch(`${origin}/api/task/v1/auth/logout`, {
      method: 'POST', headers: { 'X-CSRF-Token': 'wrong' },
    })
    expect(await deniedLogout.json()).toMatchObject({ status: 403, code: 'csrf_rejected' })
    const logout = await browserFetch(`${origin}/api/task/v1/auth/logout`, { method: 'POST', headers: { 'X-CSRF-Token': csrf } })
    expect(logout.status).toBe(200)
    await expect(browser.credential('TASK_BROWSER')).rejects.toMatchObject({ problem: { status: 401 } })
    await ctx.taskGateway.revokeDeviceToken(device.id)
    await expect(client.request('listDefinitions', {})).rejects.toMatchObject({ problem: { status: 401 } })
  })

  it('lists credential references named by installed definitions with value-free status', async () => {
    const { ctx, client, raw, definition } = await gateway()
    const credentialForms = { version: 1, input: {}, business: { type: 'object', properties: {
      token: { type: 'string', 'x-dsh-widget': 'credential' }, mirror: { type: 'string', 'x-dsh-widget': 'credential' } } } }
    const { forms: _forms, ...formless } = definition
    const register = (id: string, business: Record<string, string>, forms?: TaskDefinition['forms']) => ctx.plugin({ name: id, inject: ['tasks'],
      apply(owner: Context) {
        owner.tasks.register(owner, { ...formless, ...(forms === undefined ? {} : { forms }), id: brandString<TaskDefinitionId>(id),
          config: { ...definition.config, business } })
      } })
    await register('credentialed', { token: 'TASK_SHARED', mirror: 'TASK_ALPHA' }, credentialForms)
    await register('second', { token: 'TASK_SHARED' }, credentialForms)
    const removed = await register('removed', { token: 'TASK_REMOVED' }, credentialForms)
    await removed.dispose()
    await register('formless', { token: 'TASK_UNDECLARED' })
    await client.credential('TASK_SHARED', 'private-value')
    expect(await client.credentials()).toEqual([
      { reference: 'TASK_ALPHA', configured: false, writable: true, definitionIds: ['credentialed'] },
      { reference: 'TASK_SHARED', configured: true, writable: true, definitionIds: ['credentialed', 'second'] },
    ])
    expect((await raw('credentials', { method: 'POST' })).status).toBe(405)
  })

  it('publishes preset display names and descriptions in the catalog', async () => {
    const { ctx, client } = await gateway()
    vi.spyOn(ctx.agentPresets, 'list').mockResolvedValue([{ id: 'named', name: 'Named', description: 'Described' }, { id: 'plain' }])
    expect((await client.request('getCatalog', {})).presets).toEqual([
      { id: 'named', title: 'Named', description: 'Described' }, { id: 'plain', title: 'plain', description: null },
    ])
  })
})
