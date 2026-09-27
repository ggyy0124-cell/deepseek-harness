/** Live Loader replacement and recovery of a removed entry through the shipped Task Profile. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { TaskApiClient } from '@deepseek-ai/dsh-task-api-client'
import { taskProfileLaunch } from './launch.ts'

const repository = fileURLToPath(new URL('../../../../../', import.meta.url))
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url))

it.each(['src', 'lib'] as const)('%s: replaces a live business plugin and retires its orphaned execution after a crash', async (mode) => {
  const root = await mkdtemp(join(tmpdir(), 'task-hot-plug-'))
  const home = join(root, 'home')
  const output = join(root, 'auth.json')
  const patch = join(root, 'patch.json')
  const localPatch = join(home, 'profiles', 'task', 'cordis.patch.yml')
  const cleanupBlock = join(root, 'cleanup-block')
  const disposed = join(root, 'disposed')
  const spawn = (launch: ReturnType<typeof taskProfileLaunch>) => execa(launch.command, launch.args, {
    cwd: repository, env: { ...launch.env, DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'keyless-no-model-call' }, timeout: 90000, reject: false })
  let child: ReturnType<typeof spawn> | undefined
  let diagnostic = ''
  const business = { id: 'hot-business', name: fixture('hot-business'), config: { workspace: root, title: 'Initial title', cleanupBlock, disposed } }
  await writeFile(patch, JSON.stringify([{ insert: [
    { id: 'gateway-smoke', name: fixture('gateway'), config: { workspace: root, output } },
  ] }]))
  const boot = async () => {
    await rm(output, { force: true })
    const launch = taskProfileLaunch(['--patch', patch, '--port', '0'], mode)
    child = spawn(launch)
    child.stdout.on('data', (chunk: Buffer) => { diagnostic += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { diagnostic += chunk.toString() })
    let auth: { port: number; device: { token: string } } | undefined
    await expect.poll(async () => {
      try { auth = JSON.parse(await readFile(output, 'utf8')) as typeof auth; return true }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
    }, { timeout: 30000 }).toBe(true).catch((error: unknown) => { throw new Error(diagnostic, { cause: error }) })
    if (auth === undefined) throw new Error('Task fixture did not publish readiness')
    const bearer = auth.device.token
    return new TaskApiClient({ baseUrl: `http://127.0.0.1:${auth.port}/api/task/v1/`, fetch, authentication: () => ({ bearer }) })
  }
  try {
    let client = await boot()
    const params = { definitionId: 'hot-business' }
    await writeFile(localPatch, JSON.stringify([{ insert: [business] }]))
    await expect.poll(async () => (await client.request('listDefinitions', {})).items.some(item => item.id === params.definitionId),
      { timeout: 10000 }).toBe(true)
    const first = await client.request('triggerManual', { params, body: { input: null }, idempotencyKey: 'first' })
    await expect.poll(async () => (await client.request('getRun', { params: { runId: first.id } })).status,
      { timeout: 10000 }).toBe('waiting_input')
    await writeFile(localPatch, JSON.stringify([{ insert: [{ ...business, config: { ...business.config, title: 'Updated title' } }] }]))
    await expect.poll(async () => (await client.request('getDefinition', { params })).title,
      { timeout: 10000 }).toBe('Updated title').catch((error: unknown) => { throw new Error(diagnostic, { cause: error }) })
    expect((await client.request('getRun', { params: { runId: first.id } })).status).toBe('cancelled')
    const reinstalled = await client.request('getDefinition', { params })
    await client.request('enableDefinition', { params, body: { revision: reinstalled.revision, enabled: true }, idempotencyKey: 'enable-replacement' })
    const second = await client.request('triggerManual', { params, body: { input: null }, idempotencyKey: 'second' })
    await expect.poll(async () => (await client.request('getRun', { params: { runId: second.id } })).status,
      { timeout: 10000 }).toBe('waiting_input')
    child!.kill('SIGKILL'); await child
    await rm(disposed, { force: true })
    await writeFile(cleanupBlock, 'blocked')
    await writeFile(localPatch, '[]')
    client = await boot()
    await expect.poll(async () => (await client.request('getRetirement', { params })).state,
      { timeout: 15000 }).toBe('blocked')
    await expect(readFile(disposed, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(cleanupBlock)
    const retiring = await client.request('getDefinition', { params })
    await client.request('retireDefinition', { params, body: { revision: retiring.revision }, idempotencyKey: 'retry-cleanup' })
    await expect.poll(async () => (await client.request('getRun', { params: { runId: second.id } })).status,
      { timeout: 15000 }).toBe('cancelled').catch((error: unknown) => { throw new Error(diagnostic, { cause: error }) })
    await expect.poll(async () => (await client.request('getRetirement', { params })).state,
      { timeout: 10000 }).toBe('complete')
    await expect.poll(async () => {
      try { return await readFile(disposed, 'utf8') }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error }
    }, { timeout: 10000 }).toBe('disposed')
    expect(await client.request('getDefinition', { params })).toMatchObject({ installed: false, enabled: false })
    expect(await client.request('getDiagnostics', {})).toMatchObject({ activeRuns: 0, resources: [] })
    const original = await client.request('getRun', { params: { runId: second.id } })
    expect(original.sessionId).toBe(second.sessionId)
    child!.kill('SIGTERM')
    const result = await child!
    expect(result.timedOut).toBe(false)
    expect(result.exitCode, diagnostic).toBe(0)
  } finally { child?.kill('SIGKILL'); await child; await rm(root, { recursive: true, force: true }) }
})
