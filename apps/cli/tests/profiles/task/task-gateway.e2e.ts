/** REST requests cross the shipped profile, real HTTP server, credentials, and Task database. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { taskProfileLaunch } from './launch.ts'
import { describe, expect, it } from 'vitest'
import { TaskApiClient } from '@deepseek-ai/dsh-task-api-client'

const repository = fileURLToPath(new URL('../../../../../', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/gateway.mjs', import.meta.url))
describe('Task REST gateway', () => {
  it.each(['src', 'lib'] as const)('%s: authenticates, replays writes, enforces revisions, and drains cancelled work', async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-task-http-'))
    const output = join(directory, 'private-auth.json')
    const patch = join(directory, 'gateway.patch.yml')
    let diagnostics = ''
    await writeFile(patch, JSON.stringify([
      { id: 'task-local', config: { path: join(directory, 'tasks.sqlite'), resourceRoot: join(directory, 'resources'), concurrency: 2, tickMs: 20, catchupLimit: 100 } },
      { id: 'task-api-gateway', config: { attachmentRoot: join(directory, 'attachments'), bodyLimitBytes: 4096, bodyTimeoutMs: 2000, eventPollMs: 20, eventHeartbeatMs: 100, eventBatchSize: 2 } },
      { insert: [{ id: 'gateway-smoke', name: fixture, config: { workspace: directory, output } }] },
    ]))
    const launch = taskProfileLaunch(['--patch', patch, '--host', '127.0.0.1', '--port', '0'], mode)
    const child = execa(launch.command, launch.args, {
      cwd: repository, env: { ...launch.env, DSH_HOME: join(directory, '.dsh'), DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'keyless-no-model-call' },
      timeout: 45000, killSignal: 'SIGKILL', reject: false,
    })
    child.stdout.on('data', (chunk: Buffer) => { diagnostics += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { diagnostics += chunk.toString() })
    try {
      let auth: { port: number; device: { token: string }; revoked: { token: string }; launch: string } | undefined
      await expect.poll(async () => {
        try { auth = JSON.parse(await readFile(output, 'utf8')) as typeof auth; return true }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
      }, { timeout: 30000 }).toBe(true).catch((error: unknown) => { throw new Error(diagnostics, { cause: error }) })
      if (auth === undefined) throw new Error('missing test credentials')
      const origin = `http://127.0.0.1:${auth.port}`
      expect((await fetch(origin + '/')).status).toBe(404)
      expect((await fetch(origin + '/index.html')).status).toBe(404)
      expect(diagnostics).not.toContain('#launch=')
      const baseUrl = `${origin}/api/task/v1/`
      const bearer = auth.device.token
      const client = new TaskApiClient({ baseUrl, fetch, authentication: () => ({ bearer }) })
      const raw = (path: string, init: RequestInit = {}) => fetch(baseUrl + path, { ...init, redirect: 'error' })
      const unauthenticated = await raw('runs')
      expect(unauthenticated.status).toBe(401)
      expect(await unauthenticated.json()).toMatchObject({ code: 'authentication_required' })
      expect((await raw('runs', { headers: { Authorization: `Bearer ${auth.revoked.token}` } })).status).toBe(401)
      expect((await raw('runs', { headers: { Authorization: `Bearer ${bearer}`, Origin: 'https://untrusted.example' } })).status).toBe(403)
      await expect.poll(async () => {
        const response = await raw('ready', { headers: { Authorization: `Bearer ${bearer}` } })
        const body: unknown = await response.json()
        return { status: response.status, body }
      }, { timeout: 10000 }).toMatchObject({ status: 200, body: { ready: true } })
      expect(await client.credential('TASK_SMOKE_CREDENTIAL')).toMatchObject({ configured: false })
      expect(await client.credential('TASK_SMOKE_CREDENTIAL', 'private-test-credential')).toEqual({ configured: true, writable: true })
      expect(await client.credential('TASK_SMOKE_CREDENTIAL')).toEqual({ configured: true, writable: true })
      const catalog = await client.request('getCatalog', {})
      expect(catalog.presets.some(item => item.id === 'standard')).toBe(true)
      const definitions = await client.request('listDefinitions', {})
      expect(definitions.items).toEqual([expect.objectContaining({ id: 'gateway-smoke', configSchemaVersion: 0 })])
      const trigger = { params: { definitionId: 'gateway-smoke' }, body: { input: { private: 'business-input' } }, idempotencyKey: 'create-one' }
      const stream = client.events({ signal: AbortSignal.timeout(10000) })
      const ready = await stream.next()
      expect(ready.value).toMatchObject({ kind: 'ready' })
      const initial = await client.request('triggerManual', trigger)
      const delivered = await stream.next()
      expect(delivered.value).toMatchObject({ kind: 'task', event: 'run.reserved', runId: initial.id })
      if (delivered.done) throw new Error('event stream ended')
      const resumeCursor = delivered.value.cursor
      await stream.return(undefined)

      expect(initial.status).toBe('provisioning')
      await expect.poll(async () => { const run = await client.request('getRun', { params: { runId: initial.id } }); if (run.status === 'blocked') throw new Error(await readFile(output + '.error', 'utf8')); return run.status }, { timeout: 10000 }).toBe('waiting_input')
      expect(await client.request('triggerManual', trigger)).toEqual(initial)
      await expect(client.request('triggerManual', { ...trigger, body: { input: 'changed' } })).rejects.toMatchObject({ problem: { status: 409, code: 'idempotency_conflict' } })
      const runs = await client.request('listRuns', {})
      expect(runs.items).toHaveLength(1)
      expect(await client.request('getDiagnostics', {})).toMatchObject({ totalRuns: 1, activeRuns: 1, completedRuns: 0, pendingInputs: 1 })
      expect(runs.items[0]).not.toHaveProperty('checkpoint')
      expect(runs.items[0]).not.toHaveProperty('input')
      const uploads = [new File(['task attachment'], 'note.txt', { type: 'text/plain' })]
      const uploaded = await client.upload(initial.id, uploads, 'upload-one')
      expect(uploaded).toHaveLength(1)
      expect(await client.upload(initial.id, uploads, 'upload-one')).toEqual(uploaded)
      expect(await client.attachments(initial.id)).toEqual(uploaded)
      expect(await (await client.download(initial.id, uploaded[0]!.id)).text()).toBe('task attachment')
      await expect(client.upload(initial.id, [new File(['different'], 'note.txt')], 'upload-one')).rejects.toMatchObject({ problem: { status: 409 } })
      const ranged = await raw(`runs/${initial.id}/attachments/${uploaded[0]!.id}`, { headers: { Authorization: `Bearer ${bearer}`, Range: 'bytes=5-14' } })
      expect(ranged.status).toBe(206); expect(await ranged.text()).toBe('attachment')
      const sessionStream = client.sessionEvents({ runId: initial.id, signal: AbortSignal.timeout(10000) })
      expect((await sessionStream.next()).value).toMatchObject({ kind: 'session_ready' })
      await sessionStream.return(undefined)
      const interactions = await client.request('listInteractions', { params: { runId: initial.id } })
      const wait = interactions.items[0]
      if (wait === undefined) throw new Error('missing business interaction')
      await client.request('respond', { params: { runId: initial.id, waitId: wait.id }, body: { revision: wait.revision, response: true }, idempotencyKey: 'reply-one' })
      await expect(client.request('respond', { params: { runId: initial.id, waitId: wait.id }, body: { revision: wait.revision, response: false }, idempotencyKey: 'reply-stale' }))
        .rejects.toMatchObject({ problem: { status: 409, code: 'stale_interaction' } })
      const enabled = await client.request('enableDefinition', { params: { definitionId: 'gateway-smoke' }, body: { revision: 1, enabled: false }, idempotencyKey: 'pause' })
      expect(enabled.revision).toBe(2)
      await expect(client.request('triggerManual', { ...trigger, idempotencyKey: 'disabled-trigger' }))
        .rejects.toMatchObject({ problem: { status: 409, code: 'invalid_state' } })
      await expect(client.request('enableDefinition', { params: { definitionId: 'gateway-smoke' }, body: { revision: 1, enabled: true }, idempotencyKey: 'stale' }))
        .rejects.toMatchObject({ problem: { status: 409, currentRevision: 2 } })
      const cancellation = await client.request('cancelRun', { params: { runId: initial.id }, idempotencyKey: 'cancel' })
      expect(cancellation).toEqual({ runId: initial.id, status: 'cancelling' })
      await expect.poll(async () => (await client.request('getRun', { params: { runId: initial.id } })).status, { timeout: 10000 }).toBe('cancelled')
      expect(await client.request('cancelRun', { params: { runId: initial.id }, idempotencyKey: 'cancel' })).toEqual(cancellation)
      await expect(client.upload(initial.id, uploads, 'upload-after-end')).rejects.toMatchObject({ problem: { status: 409, code: 'run_readonly' } })
      expect(await client.upload(initial.id, uploads, 'upload-one')).toEqual(uploaded)
      const transcript = await client.request('getTranscript', { params: { runId: initial.id }, query: { limit: '1' } })
      expect(transcript).toMatchObject({ runId: initial.id, sessionId: initial.sessionId })
      const continued = await client.request('getTranscript', { params: { runId: initial.id }, query: { cursor: transcript.nextCursor } })
      expect(continued.sessionId).toBe(initial.sessionId)
      expect((await client.request('getRun', { params: { runId: initial.id } })).status).toBe('cancelled')
      await expect(client.request('getTranscript', { params: { runId: 'unknown-task' } })).rejects.toMatchObject({ problem: { status: 404 } })

      const replay = client.events({ signal: AbortSignal.timeout(10000), cursor: resumeCursor })
      expect((await replay.next()).value).toEqual({ kind: 'ready', cursor: resumeCursor })
      let replayedCompletion = false
      try {
        for (let count = 0; count < 100; count++) {
          const next = await replay.next()
          if (next.done) break
          if (next.value.kind === 'task' && next.value.event === 'run.ended' && next.value.runId === initial.id) {
            replayedCompletion = true; break
          }
        }
      } finally { await replay.return(undefined) }
      expect(replayedCompletion).toBe(true)
      const wrongStore = client.events({ signal: AbortSignal.timeout(10000), cursor: '00000000-0000-0000-0000-000000000000:0' })
      await expect(wrongStore.next()).rejects.toMatchObject({ problem: { status: 409, code: 'cursor_stale' } })
      const exchange = await raw('auth/exchange', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: auth.launch }) })
      expect(exchange.status).toBe(200)
      const cookieHeader = exchange.headers.get('set-cookie') ?? ''
      expect(cookieHeader).toContain('HttpOnly; SameSite=Strict')
      const cookie = cookieHeader.split(';')[0] ?? ''
      const session = await exchange.json() as { csrf: string }
      expect((await raw('auth/exchange', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: auth.launch }) })).status).toBe(401)
      expect(await (await raw('auth/session', { headers: { Cookie: cookie } })).json()).toEqual(session)
      const browserWrite = { method: 'PUT', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': 'browser-enable' }, body: JSON.stringify({ revision: 2, enabled: true }) }
      expect((await raw('definitions/gateway-smoke/enabled', browserWrite)).status).toBe(403)
      expect((await raw('definitions/gateway-smoke/enabled', { ...browserWrite, headers: { ...browserWrite.headers, 'X-CSRF-Token': session.csrf } })).status).toBe(200)
      expect((await raw('runs?limit=1&limit=2', { headers: { Authorization: `Bearer ${bearer}` } })).status).toBe(400)
      expect((await raw('runs/unknown', { headers: { Authorization: `Bearer ${bearer}` } })).status).toBe(404)
      expect((await raw('definitions/gateway-smoke/runs', { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'x'.repeat(5000) }) })).status).toBe(413)
      const second = await client.request('triggerManual', { ...trigger, idempotencyKey: 'create-two' })
      const third = await client.request('triggerManual', { ...trigger, idempotencyKey: 'create-three' })
      const page = await client.request('listRuns', { query: { limit: '1' } })
      expect(page.items[0]?.id).toBe(third.id)
      if (page.nextCursor === null) throw new Error('missing page cursor')
      await client.request('triggerManual', { ...trigger, idempotencyKey: 'create-after-page' })
      const next = await client.request('listRuns', { query: { limit: '1', cursor: page.nextCursor } })
      expect(next.items[0]?.id).toBe(second.id)
      await expect(client.request('listRuns', { query: { cursor: page.nextCursor, status: 'cancelled' } }))
        .rejects.toMatchObject({ problem: { status: 400, code: 'invalid_cursor' } })
      const current = await client.request('getDefinition', { params: { definitionId: 'gateway-smoke' } })
      const configured = await client.request('configureDefinition', { params: { definitionId: current.id },
        body: { revision: current.revision, configSchemaVersion: 0, config: { ...current.config, concurrency: 2 } }, idempotencyKey: 'configure' })
      expect(configured.config.concurrency).toBe(2)
      expect((await client.request('getRun', { params: { runId: second.id } })).configRevision).toBe(current.revision)
      await client.request('sendInput', { params: { runId: second.id }, body: { input: 'supplement' }, idempotencyKey: 'input' })
      const api = await (await raw('openapi.json', { headers: { Authorization: `Bearer ${bearer}` } })).json() as { openapi: string }
      expect(api.openapi).toBe('3.1.0')
      const retireRequest = { params: { definitionId: current.id }, body: { revision: configured.revision }, idempotencyKey: 'retire-plugin' }
      const retirement = await client.request('retireDefinition', retireRequest)
      expect(retirement).toMatchObject({ definitionId: current.id, codeVersion: '1' })
      await expect.poll(async () => (await client.request('getRetirement', { params: { definitionId: current.id } })).state,
        { timeout: 10000 }).toBe('complete')
      expect(await client.request('retireDefinition', retireRequest)).toEqual(retirement)
      expect(await client.request('getDiagnostics', {})).toMatchObject({ activeRuns: 0, cleanupFailures: 0 })
      await expect(client.request('triggerManual', { ...trigger, idempotencyKey: 'after-retirement' }))
        .rejects.toMatchObject({ problem: { status: 409 } })
      await writeFile(join(directory, '.dsh', 'profiles', 'task', 'cordis.patch.yml'),
        JSON.stringify([{ id: 'task-api-gateway', disabled: true }]))
      await expect.poll(async () => {
        const response = await raw('runs', { headers: { Authorization: `Bearer ${bearer}` } })
        await response.text()
        return { status: response.status, contentType: response.headers.get('content-type'), requestId: response.headers.get('x-request-id') }
      }, { timeout: 10000 }).toEqual({ status: 404, contentType: null, requestId: null })
      child.kill('SIGTERM')
      expect((await child).exitCode, diagnostics).toBe(0)
      diagnostics += await readFile(output + '.log', 'utf8')
      expect(diagnostics).not.toContain(bearer)
      expect(diagnostics).not.toContain(auth.launch)
      expect(diagnostics).not.toContain('private-test-credential')
      expect(diagnostics).not.toContain('business-input')
      expect(diagnostics).toContain('task.api.request')
    } finally {
      child.kill('SIGKILL'); await child
      await rm(directory, { recursive: true, force: true })
    }
  }, 60000)
})
