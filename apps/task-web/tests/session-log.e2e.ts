/** The built Task Web client shows the raw Session events of a Run on a host started with `--session-log`. */
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { TaskApiClient } from '@deepseek-ai/dsh-task-api-client'
import { sessionFixtureFiles } from '@deepseek-ai/dsh-session-snapshot'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const dist = fileURLToPath(new URL('../dist/index.html', import.meta.url))
const scenario = join(repository, 'snapshots/task/model-wait')

function profile(args: readonly string[]) {
  return resolveExampleLaunch({
    srcBin: join(repository, 'apps/cli/src/bin.ts'), tsconfigPath: join(repository, 'tsconfig.json'),
    sourceImport: 'tsx/esm', configArgs: ['--profile', 'task', ...args], mode: 'src',
  })
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => { if (address !== null && typeof address === 'object') resolvePort(address.port); else reject(new Error('no port')) })
    })
  })
}

/** Wait for a Run to reach a status; `expect.poll` is unavailable outside a test. */
async function reach(read: () => Promise<string>, status: string): Promise<void> {
  const deadline = Date.now() + 30000
  for (let current = await read(); current !== status; current = await read()) {
    if (Date.now() > deadline) throw new Error(`Run stayed ${current}, expected ${status}`)
    await new Promise(resolveDelay => setTimeout(resolveDelay, 200))
  }
}

describe('Task Web raw Session events', () => {
  let directory: string
  let host: (Pick<ReturnType<typeof execa>, 'kill'> & PromiseLike<unknown>) | undefined
  let browser: Browser | undefined
  let client: TaskApiClient
  let origin: string
  let runId: string
  let environment: NodeJS.ProcessEnv
  let output = ''

  const run = async (args: readonly string[]) => {
    const launch = profile(args)
    return execa(launch.command, launch.args, { cwd: repository, env: { ...launch.env, ...environment } })
  }

  beforeAll(async () => {
    if (!existsSync(dist)) throw new Error('Build the client first: pnpm run build:task-web')
    directory = await mkdtemp(join(tmpdir(), 'dsh-task-web-log-'))
    const port = await freePort()
    origin = `http://127.0.0.1:${port}`
    const fixture = join(scenario, sessionFixtureFiles(await readdir(scenario))[0]!.name)
    const patch = join(directory, 'log.patch.yml')
    // The gateway row repeats the shipped `--session-log` wiring because a patch row replaces the whole configuration.
    await writeFile(patch, [
      '- id: llm-deepseek',
      '  disabled: true',
      '- id: task-api-gateway',
      '  config:',
      `    attachmentRoot: ${JSON.stringify(join(directory, 'attachments'))}`,
      '    eventPollMs: 50',
      '    sessionLog: !!js ctx.taskStartup.sessionLog',
      `- ${JSON.stringify({ id: 'task-session-persistence-jsonl', config: { root: join(directory, 'sessions'), compression: 'none' } })}`,
      `- ${JSON.stringify({ insert: [
        { id: 'llm-replay', name: '@deepseek-ai/dsh-llm-replay', config: { file: fixture, providers: [{ id: 'task-snapshot', models: [{ id: 'task-model' }] }] } },
        { id: 'model-wait', name: join(scenario, 'model-business.mjs'), config: { workspace: directory, fixture } },
      ] })}`,
      '',
    ].join('\n'))
    const home = join(directory, 'home')
    environment = { HOME: home, USERPROFILE: home, DSH_HOME: join(home, '.dsh'), DSH_AGENTS_HOME: join(home, '.agents'),
      DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'keyless-replay' }
    const launch = profile(['--patch', patch, '--port', String(port), '--session-log'])
    const child = execa(launch.command, launch.args, { cwd: repository, env: { ...launch.env, ...environment }, killSignal: 'SIGKILL', reject: false })
    host = child
    let exited = false
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
    void child.then(() => { exited = true })
    const deadline = Date.now() + 60000
    while (!output.includes('dsh task Web:')) {
      if (Date.now() > deadline || exited) throw new Error(`Task host did not start:\n${output}`)
      await new Promise(resolveDelay => setTimeout(resolveDelay, 200))
    }
    const device = JSON.parse((await run(['--token-create'])).stdout.split('\n').find(line => line.startsWith('{"id":')) ?? '{}') as { token: string }
    client = new TaskApiClient({ baseUrl: `${origin}/api/task/v1/`, fetch, authentication: () => ({ bearer: device.token }) })
    const created = await client.request('triggerManual', { params: { definitionId: 'model-wait' }, body: { input: null }, idempotencyKey: 'log' })
    runId = created.id
    const status = async () => {
      const current = await client.request('getRun', { params: { runId } })
      return current.status === 'blocked' ? `blocked: ${current.reason ?? ''}` : current.status
    }
    await reach(status, 'waiting_input').catch((error: unknown) => { throw new Error(output.slice(-4000), { cause: error }) })
    const executablePath = process.env['DSH_PLAYWRIGHT_EXECUTABLE_PATH']
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
  }, 120000)

  afterAll(async () => {
    await browser?.close()
    host?.kill('SIGTERM')
    await host
    await rm(directory, { recursive: true, force: true })
  })

  it('starts at the bottom, follows new raw events as the Run advances, expands a stream, filters by type and shows the stored JSON', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 360 }, locale: 'zh-CN', colorScheme: 'light' })
    const link = JSON.parse((await run(['--launch-link', '--port', new URL(origin).port])).stdout.trim().split('\n').at(-1) ?? '{}') as { url: string }
    await page.goto(link.url)
    await page.getByRole('heading', { name: '概览' }).waitFor()
    await page.goto(`${origin}/runs/${runId}`)
    await page.getByRole('tab', { name: '会话' }).click()
    await page.getByRole('tab', { name: '原始事件' }).click()
    const tree = page.getByRole('tree', { name: '原始会话事件' })
    await tree.waitFor()
    await page.getByText(/^\d+ 条事件$/).waitFor()
    const types = async () => tree.locator('.tw-log-type').allTextContents()
    expect((await types()).filter(type => type === 'turn/start')).toHaveLength(1)
    const scroller = page.locator('.tw-run-scroll')
    const scrollState = () => scroller.evaluate(el => ({ top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight }))
    await expect.poll(async () => (await scrollState()).top).toBeGreaterThan(0)
    expect((await scrollState()).gap).toBeLessThanOrEqual(32)
    const topBefore = (await scrollState()).top

    const wait = (await client.request('listInteractions', { params: { runId } })).items[0]!
    await client.request('respond', { params: { runId, waitId: wait.id }, body: { revision: wait.revision, response: true }, idempotencyKey: 'confirm' })
    await expect.poll(async () => (await types()).filter(type => type === 'turn/start').length).toBe(2)
    await expect.poll(async () => (await scrollState()).top).toBeGreaterThan(topBefore)
    expect((await scrollState()).gap).toBeLessThanOrEqual(32)

    await page.setViewportSize({ width: 1440, height: 900 })
    const listed = await types()
    expect(listed.filter(type => type === 'turn/start')).toHaveLength(2)
    expect(listed).toContain('step/start')
    expect(listed).toContain('assistant/message')
    expect(listed).not.toContain('text-delta')
    const message = tree.getByRole('treeitem').filter({ has: page.locator('.tw-log-type', { hasText: /^assistant\/message$/ }) }).first()
    await message.getByRole('button', { name: '展开' }).first().click()
    expect(await types()).toContain('block-start')
    await page.getByRole('searchbox', { name: '按类型筛选' }).fill('delta')
    await page.getByText(/^\d+ 行匹配$/).waitFor()
    expect((await types()).filter(type => type.endsWith('-delta')).length).toBeGreaterThan(0)
    await page.getByRole('searchbox', { name: '按类型筛选' }).fill('')
    const turnEnd = tree.getByRole('treeitem').filter({ has: page.locator('.tw-log-type', { hasText: /^turn\/end$/ }) }).first()
    await turnEnd.locator('.tw-log-row').click()
    const detail = JSON.parse(await turnEnd.locator('pre').textContent() ?? '{}') as { type?: string; seq?: number; data?: unknown }
    expect(detail).toMatchObject({ type: 'turn/end', data: { turn: 1 } })
    await page.close()
  }, 60000)
})
