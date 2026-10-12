// @vitest-environment jsdom
/** Session statistics footer: readings, exclusive detail panels, phone bottom sheets and the refresh hook. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { idSchema } from '@deepseek-ai/dsh-task-api-protocol'
import { PHONE_QUERY } from '../src/app/MobileBar.tsx'
import { AppContext, type AppValue } from '../src/app/context.tsx'
import { RunStatsBar } from '../src/components/RunStats.tsx'
import { TaskConnection } from '../src/support/connection.ts'
import { TaskEventHub } from '../src/support/events.ts'
import { updatePreferences } from '../src/support/preferences.ts'
import { useRunStats } from '../src/support/stats.ts'
import type { RunStats } from '../src/support/types.ts'

const stats = (overrides: Partial<RunStats> = {}): RunStats => ({
  runId: idSchema.parse('run-1'), sessionId: idSchema.parse('session-1'), asOfSeq: 40,
  session: { turns: 8, steps: 46, llmMs: 95_000, toolMs: 12_400, ttftMs: 46_000, ttftSteps: 46, decodeMs: 2000, decodeTokens: 608 },
  usage: { uncachedInputTokens: 16_000, cacheReadTokens: 984_000, cacheWriteTokens: 0, outputTokens: 900_000 },
  context: { pressureTokens: 10_000, projectedTokens: 10_400, contextWindow: 128_000 },
  composition: { systemTokens: 1200, toolsTokens: 3000, messageTokens: 6000 },
  ...overrides,
})

/** Stub `matchMedia` for a desktop or a phone viewport. */
function viewport(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query, matches: phone && query === PHONE_QUERY, addEventListener: () => {}, removeEventListener: () => {},
  }))
}

beforeEach(() => { updatePreferences({ locale: 'zh-CN' }); viewport(false) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Session statistics footer', () => {
  it('renders nothing before statistics arrive or while the Session has no step, tokens or known occupancy', () => {
    const { container, rerender } = render(<RunStatsBar stats={undefined} />)
    expect(container.innerHTML).toBe('')
    rerender(<RunStatsBar stats={stats({ session: { ...stats().session!, steps: 0 },
      usage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      context: { pressureTokens: null, projectedTokens: null, contextWindow: 128_000 } })} />)
    expect(container.innerHTML).toBe('')
    rerender(<RunStatsBar stats={stats({ session: null, usage: null, context: null, composition: null })} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows counts with speed, total tokens with cache hits and context occupancy, opening one detail panel at a time', () => {
    render(<RunStatsBar stats={stats()} />)
    const group = screen.getByRole('group', { name: '会话统计' })
    const session = within(group).getByRole('button', { name: '8 轮 46 步 · 304 tok/s' })
    const usage = within(group).getByRole('button', { name: '1.9M tok · 缓存命中 98%' })
    const context = within(group).getByRole('button', { name: '上下文已用 8%' })

    fireEvent.click(session)
    expect(session.getAttribute('aria-expanded')).toBe('true')
    const sessionPanel = screen.getByRole('dialog', { name: '会话统计' })
    for (const text of ['模型用时', '1m 35s', '工具调用用时', '12.4s', '首 token 平均（TTFT）', '1.0s', '输出速度（TPS）', '304 tok/s'])
      within(sessionPanel).getByText(text)

    fireEvent.click(usage)
    expect(screen.queryByRole('dialog', { name: '会话统计' })).toBeNull()
    const usagePanel = screen.getByRole('dialog', { name: 'Token 用量' })
    within(usagePanel).getByText(`${(1_900_000).toLocaleString()} tok`)
    within(usagePanel).getByText('98%')
    within(usagePanel).getByText(`${(984_000).toLocaleString()} tok`)
    expect(within(usagePanel).queryByText('缓存写入')).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(context)
    const contextPanel = screen.getByRole('dialog', { name: '上下文用量' })
    within(contextPanel).getByText('~10.4k / 128k')
    for (const text of ['系统提示词', '~1.2k', '工具定义', '~3k', '对话消息', '~6k']) within(contextPanel).getByText(text)
    expect(contextPanel.querySelectorAll('.tw-stat-segment')).toHaveLength(3)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(context)
    fireEvent.click(context)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps an untimed Session as a plain reading and shows cache writes and an unsplit bar when reported', () => {
    const untimed = { turns: 1, steps: 2, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }
    render(<RunStatsBar stats={stats({ session: untimed,
      usage: { uncachedInputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 4, outputTokens: 6 }, composition: null })} />)
    const group = screen.getByRole('group', { name: '会话统计' })
    within(group).getByText('1 轮 2 步')
    expect(within(group).queryByRole('button', { name: /轮/ })).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: '20 tok · 缓存命中 0%' }))
    within(screen.getByRole('dialog', { name: 'Token 用量' })).getByText('缓存写入')
    fireEvent.click(within(group).getByRole('button', { name: '上下文已用 8%' }))
    const panel = screen.getByRole('dialog', { name: '上下文用量' })
    expect(panel.querySelectorAll('.tw-stat-segment')).toHaveLength(1)
    expect(within(panel).queryByText('系统提示词')).toBeNull()
  })

  it('opens the details as a bottom sheet with a close button on a phone', () => {
    viewport(true)
    render(<RunStatsBar stats={stats()} />)
    // The row shows compact labels; the buttons keep the full readings as their names.
    expect(screen.getByRole('button', { name: '8 轮 46 步 · 304 tok/s' }).textContent).toBe('8 轮 46 步')
    expect(screen.getByRole('button', { name: '1.9M tok · 缓存命中 98%' }).textContent).toBe('1.9M tok·命中 98%')
    fireEvent.click(screen.getByRole('button', { name: '1.9M tok · 缓存命中 98%' }))
    const sheet = screen.getByRole('dialog', { name: 'Token 用量' })
    expect(sheet.className).toContain('tw-stat-sheet')
    within(sheet).getByText(`${(1_900_000).toLocaleString()} tok`)
    fireEvent.click(within(sheet).getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reads in English with the reading after the context figure', () => {
    updatePreferences({ locale: 'en' })
    render(<RunStatsBar stats={stats()} />)
    fireEvent.click(screen.getByRole('button', { name: '8% of context used' }))
    within(screen.getByRole('dialog', { name: 'Context usage' })).getByText('of context used')
    screen.getByRole('button', { name: '8 turns 46 steps · 304 tok/s' })
  })
})

function Probe({ runId, version, enabled }: { runId: string; version: string; enabled: boolean }) {
  const value = useRunStats(runId, version, enabled)
  return <output>{value === undefined ? 'none' : `${value.runId}:${value.asOfSeq}`}</output>
}

describe('useRunStats', () => {
  it('reads after a quiet period, again for each new version, and keeps the last figures when a read fails', async () => {
    const reads: string[] = []
    let failing = false
    vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
      const url = new URL(input)
      reads.push(url.pathname)
      if (failing) return Promise.resolve(new Response('{}', { status: 500 }))
      const runId = url.pathname.split('/').at(-2) ?? ''
      return Promise.resolve(new Response(JSON.stringify(stats({ runId: idSchema.parse(runId), asOfSeq: reads.length })),
        { status: 200, headers: { 'content-type': 'application/json' } }))
    }))
    const connection = new TaskConnection('http://127.0.0.1:3081/')
    const app: AppValue = { connection, events: new TaskEventHub(connection), toast: () => {}, openSettings: () => {},
      openTrigger: () => {} }
    const mount = (runId: string, version: string, enabled = true) => (
      <AppContext.Provider value={app}><Probe runId={runId} version={version} enabled={enabled} /></AppContext.Provider>
    )
    const { rerender } = render(mount('run-1', 'a', false))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)) })
    expect(reads).toEqual([])
    rerender(mount('run-1', 'a'))
    await waitFor(() => { screen.getByText('run-1:1') })
    rerender(mount('run-1', 'b'))
    rerender(mount('run-1', 'c'))
    await waitFor(() => { screen.getByText('run-1:2') })
    expect(reads).toEqual(['/api/task/v1/runs/run-1/stats', '/api/task/v1/runs/run-1/stats'])
    failing = true
    rerender(mount('run-1', 'd'))
    await waitFor(() => { expect(reads).toHaveLength(3) })
    screen.getByText('run-1:2')
    failing = false
    rerender(mount('run-2', 'd'))
    screen.getByText('none')
    await waitFor(() => { screen.getByText('run-2:4') })
  })
})
