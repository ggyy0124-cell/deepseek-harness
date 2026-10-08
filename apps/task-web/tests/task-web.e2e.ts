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

  async function widthOf(selector: string): Promise<number> {
    const box = await page.locator(selector).boundingBox()
    if (box === null) throw new Error(`${selector} must be visible`)
    return box.width
  }

  /** Width of an element once two reads 100 ms apart agree; the right sidebar animates its width. */
  async function settledWidth(selector: string): Promise<number> {
    let previous = Number.NaN
    await expect.poll(async () => {
      const width = await widthOf(selector)
      const settled = width === previous
      previous = width
      return settled
    }, { interval: 100 }).toBe(true)
    return previous
  }

  it('signs in with a launch link and removes the secret from the address', async () => {
    await page.goto(origin + '/')
    await expect.poll(() => page.getByText('尚未登录').count()).toBe(1)
    await page.goto(await launchLink())
    await page.getByRole('heading', { name: '概览' }).waitFor()
    expect(page.url()).toBe(origin + '/')
    await page.getByText('Defect polling').first().waitFor()
  }, 60000)

  it('answers a business confirmation from the inbox with Enter in its note box and shows the structured result', async () => {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /待处理/ }).click()
    const card = page.getByRole('region', { name: '业务确认' }).first()
    await card.waitFor({ timeout: 30000 })
    await card.getByRole('option', { name: /Approve and continue/ }).click()
    const note = card.getByRole('textbox', { name: '补充说明（可选）' })
    await note.fill('ship after tests')
    await note.press('Enter')
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '执行记录' }).click()
    await page.getByRole('button', { name: '已成功' }).click()
    await page.getByRole('row').filter({ hasText: 'BUG-' }).first().click()
    await page.getByText('Fixed BUG-').waitFor({ timeout: 30000 })
    await expect.poll(() => page.getByText('ship after tests').count()).toBeGreaterThan(0)
    await expect.poll(() => page.getByRole('cell', { name: '128 passed' }).count()).toBe(1)
  }, 60000)

  it('triggers a manual task with its input form and approves its boolean confirmation from the Interactions tab', async () => {
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
    // The Session says the Run waits and counts the confirmation on the Interactions tab, but holds no card.
    const interactions = page.getByRole('tab', { name: /交互\s*1/ })
    await interactions.waitFor({ timeout: 30000 })
    const card = page.getByRole('region', { name: '业务确认' })
    expect(await card.count()).toBe(0)
    const composer = page.getByRole('textbox', { name: '补充信息' })
    await composer.fill('first line')
    await composer.press('Shift+Enter')
    await composer.pressSequentially('second line')
    expect(await composer.inputValue()).toBe('first line\nsecond line')
    await composer.press('Enter')
    await page.locator('.tw-user-message').filter({ hasText: 'second line' }).waitFor({ timeout: 30000 })
    expect(await composer.inputValue()).toBe('')
    expect(await card.count()).toBe(0)
    await interactions.click()
    await card.getByRole('button', { name: '批准' }).click({ timeout: 30000 })
    await page.locator('.tw-run-header').getByText('已成功').waitFor({ timeout: 30000 })
    await page.getByRole('tab', { name: '会话' }).click()
    await page.locator('.tw-user-message').filter({ hasText: '确认回复' }).filter({ hasText: '批准' }).waitFor({ timeout: 30000 })
  }, 60000)

  it('keeps the manual trigger dialog inside a short window, scrolls its form and shows a rejected submit', async () => {
    const height = 300
    await page.setViewportSize({ width: 1440, height })
    try {
      await page.getByRole('button', { name: '手动触发' }).first().click()
      const dialog = page.getByRole('dialog', { name: '手动触发' })
      await dialog.getByRole('button', { name: '选择任务' }).click()
      await page.getByRole('menuitem', { name: 'Performance review' }).click()
      // The dialog keeps the 24px margin of its layer at the top and bottom, and the form scrolls instead of growing the dialog.
      const [box, scroller] = [await dialog.boundingBox(), dialog.locator('.tw-dialog-scroll')]
      if (box === null) throw new Error('The trigger dialog must be visible')
      expect(box.y).toBeGreaterThanOrEqual(24)
      expect(box.y + box.height).toBeLessThanOrEqual(height - 24)
      expect(await scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
      for (const name of ['取消', '触发']) {
        const button = await dialog.getByRole('button', { name }).boundingBox()
        if (button === null) throw new Error(`${name} must be visible`)
        expect(button.y + button.height).toBeLessThanOrEqual(height)
      }
      // The empty period sits below the visible part of the form; the rejected submit scrolls its error into the visible part.
      await dialog.getByRole('button', { name: '触发' }).click()
      const required = dialog.getByText('必填')
      await expect.poll(async () => {
        const [scrollerBox, requiredBox] = [await scroller.boundingBox(), await required.boundingBox()]
        if (scrollerBox === null || requiredBox === null) return false
        return requiredBox.y >= scrollerBox.y && requiredBox.y + requiredBox.height <= scrollerBox.y + scrollerBox.height
      }).toBe(true)
    } finally {
      await page.keyboard.press('Escape')
      await page.setViewportSize({ width: 1440, height: 900 })
    }
  }, 60000)

  it('shows the Run facts in a resizable sidebar and the Session as a trajectory with a timeline, search and a record inspector', async () => {
    const sidebar = page.getByRole('complementary', { name: '右侧边栏' })
    await sidebar.getByRole('tab', { name: '状态' }).waitFor()
    await sidebar.getByText('Performance review').waitFor()
    const handle = sidebar.getByRole('separator', { name: '调整侧边栏宽度' })
    const width = Number(await handle.getAttribute('aria-valuenow'))
    await handle.focus()
    await handle.press('ArrowLeft')
    await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBe(width + 16)

    await sidebar.getByRole('button', { name: '收起右侧边栏' }).click()
    await expect.poll(() => sidebar.isVisible()).toBe(false)
    await page.reload()
    await page.getByRole('button', { name: '打开右侧边栏' }).waitFor()
    expect(await sidebar.isVisible()).toBe(false)
    await page.getByRole('button', { name: '打开右侧边栏' }).click()
    await sidebar.getByRole('tab', { name: '状态' }).waitFor()
    expect(Number(await handle.getAttribute('aria-valuenow'))).toBe(width + 16)

    await page.getByRole('tab', { name: '会话' }).click()
    await page.getByRole('tab', { name: '轨迹' }).click()
    const toolbar = page.getByRole('toolbar', { name: '轨迹工具栏' })
    for (const name of ['使用实际时长', '收起所有轮次', '收起所有调用']) await toolbar.getByRole('button', { name }).waitFor()
    const timeline = page.getByRole('region', { name: '轨迹时间线' })
    await expect.poll(() => timeline.locator('.tw-tl-labels span').allInnerTexts()).toEqual(['输入', '模型', '工具'])
    await expect.poll(() => timeline.locator('.tw-tl-span[data-kind="input"]').count()).toBeGreaterThan(0)

    const search = toolbar.getByRole('searchbox', { name: '搜索轨迹' })
    await search.fill('no such record')
    await page.getByText('没有匹配的记录').waitFor()
    await search.fill('')
    const rows = page.getByRole('grid', { name: '轨迹' }).getByRole('row')
    await rows.filter({ hasText: 'first line' }).click()
    await sidebar.getByRole('tab', { name: '事件详情' }).waitFor()
    await expect.poll(() => sidebar.getByRole('tab', { name: '概述' }).getAttribute('aria-selected')).toBe('true')
    await sidebar.getByText('second line').first().waitFor()
    await sidebar.getByRole('tab', { name: '原始内容' }).click()
    await sidebar.locator('pre').filter({ hasText: 'second line' }).waitFor()
    await sidebar.getByRole('button', { name: '关闭事件详情' }).click()
    await sidebar.getByRole('tab', { name: '事件详情' }).waitFor({ state: 'detached' })
    await page.getByRole('tab', { name: '对话' }).click()
    await page.locator('.tw-user-message').filter({ hasText: 'second line' }).waitFor()
  }, 60000)

  it('keeps the trajectory toolbar flush with the top of the scroll area and leaves room above the composer', async () => {
    await page.getByRole('tab', { name: '轨迹' }).click()
    await page.setViewportSize({ width: 1440, height: 300 })
    try {
      const scroller = page.locator('.tw-run-scroll')
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(40)
      await scroller.evaluate((element) => { element.scrollTop = 40 })
      const [scrollerBox, headBox] = [await scroller.boundingBox(), await page.locator('.tw-traj-head').boundingBox()]
      if (scrollerBox === null || headBox === null) throw new Error('The scroll area and the trajectory toolbar must both be visible')
      expect(headBox.y).toBeCloseTo(scrollerBox.y, 0)

      await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight })
      const [cardBox, footerBox] = [await page.locator('.tw-traj').boundingBox(), await page.locator('.tw-composer-wrap').boundingBox()]
      if (cardBox === null || footerBox === null) throw new Error('The trajectory and the composer area must both be visible')
      expect(footerBox.y - (cardBox.y + cardBox.height)).toBeGreaterThanOrEqual(16)
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.getByRole('tab', { name: '对话' }).click()
    }
  }, 60000)

  it('fills the space the navigation and the sidebar leave with one column for both views and the composer', async () => {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /待处理/ }).click()
    await page.getByRole('link', { name: '打开执行' }).first().click()
    const sidebar = page.getByRole('complementary', { name: '右侧边栏' })
    await sidebar.getByRole('tab', { name: '状态' }).waitFor()
    // The column keeps a 24px gutter on each side of the area beside the sidebars and stops growing at 1120px (`--tw-run-column-max`).
    const columns = async () => {
      const expected = Math.min(1120, await settledWidth('.tw-run-center') - 48)
      for (const view of ['对话', '轨迹']) {
        await page.getByRole('tab', { name: view }).click()
        expect(await widthOf('.tw-run-content')).toBeCloseTo(expected, 0)
        expect(await widthOf('.tw-composer')).toBeCloseTo(expected, 0)
      }
      return expected
    }
    const beside = await columns()
    expect(beside).toBeLessThan(1120)

    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '收起侧栏' }).click()
    try {
      expect(await columns()).toBeGreaterThan(beside)
    } finally {
      await page.getByRole('button', { name: '展开侧栏' }).click()
    }
    expect(await columns()).toBe(beside)

    await sidebar.getByRole('button', { name: '收起右侧边栏' }).click()
    try {
      expect(await columns()).toBeGreaterThan(beside)
    } finally {
      await page.getByRole('button', { name: '打开右侧边栏' }).click()
    }
    expect(await columns()).toBe(beside)
  }, 60000)

  it('keeps a live Run at the end of its trajectory while input arrives and starts the other view from its end', async () => {
    await page.setViewportSize({ width: 1440, height: 440 })
    try {
      await page.getByRole('tab', { name: '轨迹' }).click()
      const scroller = page.locator('.tw-run-scroll')
      const composer = page.getByRole('textbox', { name: '补充信息' })
      const distanceToEnd = () => scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)
      for (let index = 1; index <= 6; index++) {
        await composer.fill(`note ${index}`)
        await composer.press('Enter')
        await page.getByRole('grid', { name: '轨迹' }).getByRole('row').filter({ hasText: `note ${index}` }).waitFor({ timeout: 30000 })
        await expect.poll(distanceToEnd).toBeLessThanOrEqual(1)
      }
      expect(await scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(150)

      await scroller.evaluate((element) => { element.scrollTop = 0 })
      await page.getByRole('tab', { name: '对话' }).click()
      await expect.poll(distanceToEnd).toBeLessThanOrEqual(1)
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 })
    }
  }, 90000)

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

  it('restarts a failed ordinary run from its result and links the new run to it', async () => {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /待处理/ }).click()
    const card = page.getByRole('region', { name: '业务确认' }).first()
    await card.waitFor({ timeout: 30000 })
    await card.getByRole('option', { name: /Reject/ }).click()
    await card.getByRole('button', { name: '提交回复' }).click()
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '执行记录' }).click()
    await page.getByRole('button', { name: '已失败' }).click()
    await page.getByRole('row').filter({ hasText: 'BUG-' }).first().click()
    await page.getByText('Plan rejected by reviewer').first().waitFor({ timeout: 30000 })
    const stopped = page.url()
    await page.getByRole('button', { name: '重来' }).click()
    await page.waitForURL(url => url.href !== stopped)
    // The new Run waits for the same confirmation again and names the Run it restarted.
    const sidebar = page.getByRole('complementary', { name: '右侧边栏' })
    await sidebar.getByText('重来自').waitFor({ timeout: 30000 })
    await page.getByRole('tab', { name: /交互\s*1/ }).waitFor({ timeout: 30000 })
    await sidebar.getByText('重来自').locator('..').getByRole('link').click()
    await page.waitForURL(stopped)
    await page.getByText('该业务对象已有更新的执行').waitFor({ timeout: 30000 })
    expect(await page.getByRole('button', { name: '重来' }).count()).toBe(0)
  }, 90000)

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
