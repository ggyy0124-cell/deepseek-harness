/** The built Task Web client signs in with the fixed account through a trusted host of a Task Profile listening on all interfaces. */
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

describe('Task Web password sign-in', () => {
  let directory: string
  let host: (Pick<ReturnType<typeof execa>, 'kill'> & PromiseLike<unknown>) | undefined
  let browser: Browser | undefined
  let page: Page
  let origin: string

  beforeAll(async () => {
    if (!existsSync(dist)) throw new Error('Build the client first: pnpm run build:task-web')
    directory = await mkdtemp(join(tmpdir(), 'dsh-task-web-password-'))
    const port = await freePort()
    origin = `http://localhost:${port}`
    const patch = join(directory, 'password.patch.yml')
    await writeFile(patch, [
      '- id: task-local',
      '  config:',
      `    path: ${JSON.stringify(join(directory, 'tasks.sqlite'))}`,
      `    resourceRoot: ${JSON.stringify(join(directory, 'resources'))}`,
      '- id: task-api-gateway',
      '  config:',
      `    attachmentRoot: ${JSON.stringify(join(directory, 'attachments'))}`,
      '    trustedHosts: !!js ctx.taskStartup.trustedHosts',
      '    passwordLogin:',
      '      enabled: true',
      '      username: operator',
      '',
    ].join('\n'))
    const environment = { DSH_HOME: join(directory, '.dsh'), DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'keyless-no-model-call' }
    const store = profile(['--password-set'])
    await execa(store.command, store.args, { cwd: repository, env: { ...store.env, ...environment }, input: 'secret-pass\n' })
    const launch = profile(['--patch', patch, '--host', '0.0.0.0', '--trusted-host', 'localhost', '--port', String(port)])
    const child = execa(launch.command, launch.args, { cwd: repository, env: { ...launch.env, ...environment }, killSignal: 'SIGKILL', reject: false })
    host = child
    let output = ''
    let exited = false
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
    void child.then(() => { exited = true })
    const deadline = Date.now() + 60000
    while (!output.includes(`dsh task Web: ${origin}/`)) {
      if (Date.now() > deadline || exited) throw new Error(`Task host did not start:\n${output}`)
      await new Promise(resolveDelay => setTimeout(resolveDelay, 200))
    }
    const executablePath = process.env['DSH_PLAYWRIGHT_EXECUTABLE_PATH']
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN', colorScheme: 'light' })
  }, 90000)

  afterAll(async () => {
    await browser?.close()
    host?.kill('SIGTERM')
    await host
    await rm(directory, { recursive: true, force: true })
  })

  it('rejects a wrong password, keeps the launch link as the administrator entry and signs in', async () => {
    await page.goto(origin + '/')
    await page.getByRole('heading', { name: '登录 DSH 任务' }).waitFor()
    await page.getByText('管理员本机登录（启动链接）').click()
    await page.getByText('dsh --profile task --launch-link').waitFor()
    await page.getByLabel('用户名').fill('operator')
    await page.getByLabel('密码').fill('wrong-pass')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByText('用户名或密码不正确').waitFor()
    expect(await page.getByLabel('密码').inputValue()).toBe('')
    await page.getByLabel('密码').fill('secret-pass')
    await page.getByLabel('密码').press('Enter')
    await page.getByRole('heading', { name: '概览' }).waitFor()
    expect(page.url()).toBe(origin + '/')
  }, 60000)
})
