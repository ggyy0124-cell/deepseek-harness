/** The built Task Web client shows the Session statistics of a Run whose model calls replay the recorded Task Session fixture. */
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

describe('Task Web Session statistics', () => {
  let directory: string
  let host: (Pick<ReturnType<typeof execa>, 'kill'> & PromiseLike<unknown>) | undefined
  let browser: Browser | undefined
  let origin: string
  let runId: string
  let environment: NodeJS.ProcessEnv
  let output = ''

  const run = async (args: readonly string[], input?: string) => {
    const launch = profile(args)
    return execa(launch.command, launch.args, { cwd: repository, env: { ...launch.env, ...environment },
      ...(input === undefined ? {} : { input }) })
  }
  const signIn = async () => JSON.parse((await run(['--launch-link', '--port', new URL(origin).port])).stdout.trim().split('\n').at(-1) ?? '{}') as
    { url: string }

  beforeAll(async () => {
    if (!existsSync(dist)) throw new Error('Build the client first: pnpm run build:task-web')
    directory = await mkdtemp(join(tmpdir(), 'dsh-task-web-stats-'))
    const port = await freePort()
    origin = `http://127.0.0.1:${port}`
    // The newest generation of the recorded Session, as the Task snapshot replays it.
    const fixture = join(scenario, sessionFixtureFiles(await readdir(scenario))[0]!.name)
    const patch = join(directory, 'stats.patch.json')
    await writeFile(patch, JSON.stringify([
      { id: 'llm-deepseek', disabled: true },
      { id: 'task-api-gateway', config: { attachmentRoot: join(directory, 'attachments'), eventPollMs: 50 } },
      { id: 'task-session-persistence-jsonl', config: { root: join(directory, 'sessions'), compression: 'none' } },
      { insert: [
        // Recorded model answers; the route advertises a context window so the occupancy reading appears.
        { id: 'llm-replay', name: '@deepseek-ai/dsh-llm-replay',
          config: { file: fixture, providers: [{ id: 'task-snapshot', models: [{ id: 'task-model', contextWindow: 1000 }] }] } },
        { id: 'model-wait', name: join(scenario, 'model-business.mjs'), config: { workspace: directory, fixture } },
      ] },
    ]))
    const home = join(directory, 'home')
    environment = { HOME: home, USERPROFILE: home, DSH_HOME: join(home, '.dsh'), DSH_AGENTS_HOME: join(home, '.agents'),
      DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'keyless-replay' }
    const launch = profile(['--patch', patch, '--port', String(port)])
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
    const client = new TaskApiClient({ baseUrl: `${origin}/api/task/v1/`, fetch, authentication: () => ({ bearer: device.token }) })
    const created = await client.request('triggerManual', { params: { definitionId: 'model-wait' }, body: { input: null }, idempotencyKey: 'stats' })
    runId = created.id
    const status = async () => {
      const current = await client.request('getRun', { params: { runId } })
      return current.status === 'blocked' ? `blocked: ${current.reason ?? ''}` : current.status
    }
    await reach(status, 'waiting_input').catch((error: unknown) => { throw new Error(output.slice(-4000), { cause: error }) })
    const wait = (await client.request('listInteractions', { params: { runId } })).items[0]!
    await client.request('respond', { params: { runId, waitId: wait.id }, body: { revision: wait.revision, response: true }, idempotencyKey: 'confirm' })
    await reach(status, 'succeeded')
    const executablePath = process.env['DSH_PLAYWRIGHT_EXECUTABLE_PATH']
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
  }, 120000)

  afterAll(async () => {
    await browser?.close()
    host?.kill('SIGTERM')
    await host
    await rm(directory, { recursive: true, force: true })
  })

  it('shows counts, tokens and context occupancy under the Session and opens their details', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', colorScheme: 'light' })
    await page.goto((await signIn()).url)
    await page.getByRole('heading', { name: '概览' }).waitFor()
    await page.goto(`${origin}/runs/${runId}`)
    await page.getByRole('tab', { name: '会话' }).click()
    const stats = page.getByRole('group', { name: '会话统计' })
    await stats.getByText('2 轮 2 步').waitFor()
    const usage = stats.getByRole('button', { name: '28 tok · 缓存命中 0%' })
    await usage.click()
    const usagePanel = page.getByRole('dialog', { name: 'Token 用量' })
    for (const text of ['未缓存输入', '20 tok', '输出', '8 tok']) await usagePanel.getByText(text, { exact: true }).waitFor()
    const context = stats.getByRole('button', { name: /^上下文已用 \d+%$/ })
    await context.click()
    await usagePanel.waitFor({ state: 'detached' })
    const contextPanel = page.getByRole('dialog', { name: '上下文用量' })
    for (const text of ['系统提示词', '工具定义', '对话消息']) await contextPanel.getByText(text).waitFor()
    await contextPanel.getByText(/^~\d+ \/ 1k$/).waitFor()
    const panel = await contextPanel.boundingBox()
    const trigger = await context.boundingBox()
    expect(panel !== null && trigger !== null && panel.y + panel.height <= trigger.y).toBe(true)
    await page.keyboard.press('Escape')
    await contextPanel.waitFor({ state: 'detached' })
    await page.getByRole('tab', { name: '轨迹' }).click()
    await stats.getByText('2 轮 2 步').waitFor()
    await page.close()
  }, 60000)

  it('opens the details as a bottom sheet on a phone and keeps the readings on one line', async () => {
    const context = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'zh-CN' })
    const page = await context.newPage()
    await page.goto((await signIn()).url)
    await page.getByRole('heading', { name: '概览' }).waitFor()
    await page.goto(`${origin}/runs/${runId}`)
    await page.getByRole('tab', { name: '会话' }).tap()
    const stats = page.getByRole('group', { name: '会话统计' })
    const usage = stats.getByRole('button', { name: '28 tok · 缓存命中 0%' })
    await usage.waitFor()
    expect((await usage.boundingBox())?.height).toBeGreaterThanOrEqual(36)
    const row = await stats.boundingBox()
    expect(row !== null && row.height < 48).toBe(true)
    // All three readings fit the phone width without scrolling or cutting their text.
    expect(await stats.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await usage.textContent()).toBe('28 tok·命中 0%')
    await usage.tap()
    const sheet = page.getByRole('dialog', { name: 'Token 用量' })
    await sheet.getByText('未缓存输入').waitFor()
    await expect.poll(async () => {
      const box = await sheet.boundingBox()
      return box === null ? null : { left: Math.round(box.x), width: Math.round(box.width), bottom: Math.round(box.y + box.height) }
    }).toEqual({ left: 0, width: 390, bottom: 844 })
    await sheet.getByRole('button', { name: '关闭' }).tap()
    await sheet.waitFor({ state: 'detached' })
    await context.close()
  }, 60000)
})
