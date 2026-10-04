/** The built Task Web client against the shipped Task Profile, its gateway and demonstration business plugins. */
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/demo-business.mjs', import.meta.url))
const dist = fileURLToPath(new URL('../dist/index.html', import.meta.url))

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

describe('Task Web client', () => {
  let directory: string
  let host: (Pick<ReturnType<typeof execa>, 'kill'> & PromiseLike<unknown>) | undefined
  let exited = false
  let browser: Browser
  let page: Page
  let origin: string
  let environment: NodeJS.ProcessEnv
  let output = ''

  beforeAll(async () => {
    if (!existsSync(dist)) throw new Error('Build the client first: pnpm run build:task-web')
    directory = await mkdtemp(join(tmpdir(), 'dsh-task-web-'))
    const port = await freePort()
    origin = `http://127.0.0.1:${port}`
    const rows = ['defects', 'review', 'cleanup'].map(definition => ({
      id: `demo-${definition}`, name: fixture, config: { definition, workspace: directory, pollMs: 3600000 },
    }))
    const patch = join(directory, 'web.patch.yml')
    await writeFile(patch, JSON.stringify([
      { id: 'task-local', config: { path: join(directory, 'tasks.sqlite'), resourceRoot: join(directory, 'resources'), concurrency: 4, tickMs: 50, catchupLimit: 100 } },
      { id: 'task-api-gateway', config: { attachmentRoot: join(directory, 'attachments'), eventPollMs: 50 } },
      { insert: rows },
    ]))
    environment = { DSH_HOME: join(directory, '.dsh'), DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'keyless-no-model-call' }
    const launch = profile(['--patch', patch, '--port', String(port)])
    const child = execa(launch.command, launch.args, { cwd: repository, env: { ...launch.env, ...environment }, killSignal: 'SIGKILL', reject: false })
    host = child
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
    void child.then(() => { exited = true })
    const deadline = Date.now() + 60000
    while (!output.includes('dsh task Web:')) {
      if (Date.now() > deadline || exited) throw new Error(`Task host did not start:\n${output}`)
      await new Promise(resolveDelay => setTimeout(resolveDelay, 200))
    }
    const executablePath = process.env['DSH_PLAYWRIGHT_EXECUTABLE_PATH']
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', colorScheme: 'light' })
  }, 90000)

  afterAll(async () => {
    await browser?.close()
    host?.kill('SIGTERM')
    await host
    await rm(directory, { recursive: true, force: true })
  })

  async function launchLink(): Promise<string> {
    const launch = profile(['--launch-link', '--port', new URL(origin).port])
    const result = await execa(launch.command, launch.args, { cwd: repository, env: { ...launch.env, ...environment } })
    const printed = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as { url?: string }
    if (printed.url === undefined) throw new Error(result.stdout)
    return printed.url
  }

  it('signs in with a launch link and removes the secret from the address', async () => {
    await page.goto(origin + '/')
    await expect.poll(() => page.getByText('尚未登录').count()).toBe(1)
    await page.goto(await launchLink())
    await page.getByRole('heading', { name: '概览' }).waitFor()
    expect(page.url()).toBe(origin + '/')
    await page.getByText('Defect polling').first().waitFor()
  }, 60000)

  it('answers a business confirmation from the inbox and shows the structured result', async () => {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /待处理/ }).click()
    const card = page.getByRole('region', { name: '业务确认' }).first()
    await card.waitFor({ timeout: 30000 })
    await card.getByRole('option', { name: /Approve and continue/ }).click()
    await card.getByRole('textbox', { name: '补充说明（可选）' }).fill('ship after tests')
    await card.getByRole('button', { name: '提交回复' }).click()
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '执行记录' }).click()
    await page.getByRole('button', { name: '已成功' }).click()
    await page.getByRole('row').filter({ hasText: 'BUG-' }).first().click()
    await page.getByText('Fixed BUG-').waitFor({ timeout: 30000 })
    await expect.poll(() => page.getByText('ship after tests').count()).toBeGreaterThan(0)
    await expect.poll(() => page.getByRole('cell', { name: '128 passed' }).count()).toBe(1)
  }, 60000)

  it('triggers a manual task with its input form and approves its boolean confirmation', async () => {
    await page.getByRole('button', { name: '手动触发' }).first().click()
    const dialog = page.getByRole('dialog', { name: '手动触发' })
    await dialog.getByRole('button', { name: '选择任务' }).click()
    await page.getByRole('menuitem', { name: 'Performance review' }).click()
    await dialog.getByRole('button', { name: '触发' }).click()
    await expect.poll(() => dialog.getByText('必填').count()).toBe(1)
    await dialog.getByRole('button', { name: 'Review period' }).click()
    await page.getByRole('menuitem', { name: '2026 Q3' }).click()
    await dialog.getByRole('textbox', { name: 'Focus' }).fill('Task Web client')
    await dialog.getByRole('button', { name: '触发' }).click()
    await page.waitForURL(/\/runs\//)
    await page.getByRole('region', { name: '业务确认' }).getByRole('button', { name: '批准' }).click({ timeout: 30000 })
    await page.locator('.tw-run-header').getByText('已成功').waitFor({ timeout: 30000 })
  }, 60000)

  it('retries a blocked cleanup and keeps the recorded outcome', async () => {
    await page.getByRole('button', { name: '手动触发' }).first().click()
    const dialog = page.getByRole('dialog', { name: '手动触发' })
    await dialog.getByRole('button', { name: '选择任务' }).click()
    await page.getByRole('menuitem', { name: 'Cleanup drill' }).click()
    await dialog.getByRole('button', { name: '触发' }).click()
    await page.getByText('插件清理或资源释放没有完成').waitFor({ timeout: 30000 })
    await page.getByRole('button', { name: '重试清理' }).last().click()
    await page.locator('.tw-run-header').getByText('已失败').waitFor({ timeout: 30000 })
  }, 60000)

  it('edits a definition, pauses it and stores a credential without echoing its value', async () => {
    await page.goto(origin + '/definitions/demo.defects')
    await page.getByRole('button', { name: 'Product' }).getByText('Mobile App').waitFor()
    await page.getByRole('button', { name: '3 Normal' }).click()
    await page.getByRole('region', { name: /有 1 项未保存的更改/ }).getByRole('button', { name: '保存' }).click()
    await page.getByText('已保存 · 配置修订 2').waitFor()
    await page.getByText('代码 v1.0.0').locator('..').getByText('配置修订 2', { exact: true }).waitFor()
    await page.getByRole('switch', { name: '启用未来触发' }).click()
    await page.getByText('已暂停').first().waitFor()
    await page.getByRole('main').getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.getByRole('textbox', { name: 'DEMO_TRACKER_TOKEN 新值' }).fill('private-demo-value')
    await settings.getByRole('button', { name: '保存' }).click()
    await settings.getByText('已配置', { exact: true }).waitFor()
    expect(await page.content()).not.toContain('private-demo-value')
    await settings.getByRole('button', { name: '关闭设置' }).click()
  }, 60000)

  it('signs out', async () => {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '设置' }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.getByRole('button', { name: '连接' }).click()
    await settings.getByRole('button', { name: '退出登录' }).click()
    await page.getByText('尚未登录').waitFor()
  }, 30000)
})
