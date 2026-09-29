/** Recorded model calls cross Task admission, business confirmation and one persistent Session. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { TaskApiClient } from '@deepseek-ai/dsh-task-api-client'
import { fixtureContext, formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts,
  normalizedToolSchemas, normalizeSessionSnapshots, redactSessionSnapshotIds, scrubSessionSnapshot,
  sessionFixtureFiles, sessionFixtureName, sessionHeaderVersion, tokenizeSessionFixtureCwd } from '@deepseek-ai/dsh-session-snapshot'
import { taskProfileLaunch } from '../../apps/cli/tests/profiles/task/launch.ts'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const scenario = fileURLToPath(new URL('./model-wait/', import.meta.url))
const records = (text: string): unknown[] => text.trim().split('\n').map(line => JSON.parse(line))

it.skipIf(process.env['DSH_SNAPSHOT'] === 'record')('replays two model stages with a business confirmation through dsh --profile task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-session-snapshot-'))
  const home = join(root, 'home')
  const output = join(root, 'auth.json')
  const patch = join(root, 'patch.json')
  const file = sessionFixtureFiles(await readdir(scenario))[0]!
  const fixture = join(scenario, file.name)
  let expected = await readFile(fixture, 'utf8')
  await writeFile(patch, JSON.stringify([
    { id: 'llm-deepseek', disabled: true },
    { id: 'task-session-persistence-jsonl', config: { root: join(home, 'tasks', 'sessions'), compression: 'none' } },
    { insert: [
      { id: 'llm-replay', name: process.env['DSH_EXAMPLE_MODE'] === 'lib'
        ? join(repository, 'packages/test-support/llm-replay/lib/index.js')
        : '@deepseek-ai/dsh-llm-replay', config: { file: fixture, providers: [{ id: 'task-snapshot', models: [{ id: 'task-model' }] }] } },
      { id: 'gateway-smoke', name: join(repository, 'apps/cli/tests/profiles/task/fixtures/gateway.mjs'), config: { workspace: root, output } },
      { id: 'model-wait', name: join(scenario, 'model-business.mjs'), config: { workspace: root, fixture } },
    ] },
  ]))
  const launch = taskProfileLaunch(['--patch', patch, '--port', '0'])
  const child = execa(launch.command, launch.args, { cwd: repository, env: { ...launch.env,
    HOME: home, USERPROFILE: home, DSH_HOME: home, DSH_AGENTS_HOME: join(home, '.agents'),
    DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'keyless-replay' }, timeout: 90000, reject: false })
  let diagnostic = ''
  child.stdout.on('data', (chunk: Buffer) => { diagnostic += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { diagnostic += chunk.toString() })
  try {
    let auth: { port: number; device: { token: string } } | undefined
    await expect.poll(async () => {
      try { auth = JSON.parse(await readFile(output, 'utf8')) as typeof auth; return true }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
    }, { timeout: 30000 }).toBe(true).catch((error: unknown) => { throw new Error(diagnostic, { cause: error }) })
    if (auth === undefined) throw new Error('Missing Task readiness')
    const bearer = auth.device.token
    const client = new TaskApiClient({ baseUrl: `http://127.0.0.1:${auth.port}/api/task/v1/`, fetch, authentication: () => ({ bearer }) })
    const run = await client.request('triggerManual', { params: { definitionId: 'model-wait' }, body: { input: null }, idempotencyKey: 'snapshot' })
    const runParams = { runId: run.id }
    await expect.poll(async () => client.request('getRun', { params: runParams }), { timeout: 15000 })
      .toMatchObject({ status: 'waiting_input' })
    const wait = (await client.request('listInteractions', { params: runParams })).items[0]!
    await client.request('respond', { params: { ...runParams, waitId: wait.id }, body: { revision: wait.revision, response: true }, idempotencyKey: 'confirm' })
    await expect.poll(async () => client.request('getRun', { params: runParams }), { timeout: 15000 })
      .toMatchObject({ status: 'succeeded', sessionId: run.sessionId })
    child.kill('SIGTERM')
    const result = await child
    expect(result.timedOut).toBe(false)
    expect(result.exitCode, diagnostic).toBe(0)
    const files = await readdir(join(home, 'tasks', 'sessions'), { recursive: true })
    const logs = files.filter(path => path.endsWith('.jsonl'))
    expect(logs).toHaveLength(1)
    const actual = await readFile(join(home, 'tasks', 'sessions', logs[0]!), 'utf8')
    const context = { sessionIds: [run.sessionId], cwd: root }
    const prompts = normalizedSystemPrompts(actual, context)
    const prompt = formatSystemPromptSnapshot(prompts[0] ?? '', prompts.slice(1))
    const schemas = normalizedToolSchemas(actual, context)
    const tools = formatToolSchemasSnapshot(schemas[0] ?? [], schemas.slice(1))
    if (process.env['DSH_SNAPSHOT'] === 'refresh') {
      expected = redactSessionSnapshotIds([scrubSessionSnapshot(tokenizeSessionFixtureCwd(actual))])[0]!
      await writeFile(join(scenario, sessionFixtureName(0, sessionHeaderVersion(actual, 'Task Session'))), expected)
      await writeFile(join(scenario, 'system-prompt.expected.md'), prompt)
      await writeFile(join(scenario, 'tool-schemas.expected.json'), tools)
    }
    expect(normalizeSessionSnapshots([actual], context).map(records))
      .toEqual(normalizeSessionSnapshots([expected], fixtureContext(expected)).map(records))
    expect(prompt).toBe(await readFile(join(scenario, 'system-prompt.expected.md'), 'utf8'))
    expect(tools).toBe(await readFile(join(scenario, 'tool-schemas.expected.json'), 'utf8'))
  } finally { child.kill('SIGKILL'); await child; await rm(root, { recursive: true, force: true }) }
})
