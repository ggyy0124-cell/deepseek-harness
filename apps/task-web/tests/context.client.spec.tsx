// @vitest-environment jsdom
/** Context view: the cards of a Session folded by dsh-context, the states that replace them, and the refresh hook. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppContext, type AppValue } from '../src/app/context.tsx'
import { ContextView, INSTALL_COMMAND } from '../src/components/ContextView.tsx'
import { TaskConnection } from '../src/support/connection.ts'
import { parseContext, useRunContext, type ContextInsight, type ContextState } from '../src/support/context.ts'
import { TaskEventHub } from '../src/support/events.ts'
import { updatePreferences } from '../src/support/preferences.ts'
import type { RunContext } from '../src/support/types.ts'
import { recordedContext } from './context-fixtures.ts'

const response: RunContext = recordedContext
const insight = parseContext(response) as ContextInsight
const ready = (value: ContextInsight = insight): ContextState => ({ status: 'ready', insight: value })

beforeEach(() => { updatePreferences({ locale: 'zh-CN' }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Context view', () => {
  it('shows the overview, current context, trend, files and tools of a folded Session', () => {
    render(<ContextView state={ready()} />)
    const overview = screen.getByRole('region', { name: '概览' })
    within(overview).getByText('deepseek-chat')
    within(overview).getByText('3.3k / 128k · 3%')
    within(overview).getByText('3 轮 12 次请求')
    within(overview).getByText('69%')
    const current = screen.getByRole('region', { name: '当前上下文' })
    within(current).getByRole('img', { name: '当前上下文共 3.3k token' })
    within(current).getByText('上下文窗口 128k')
    expect(within(current).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['系统提示词38411%', '工具定义56617%', '用户消息2558%', '模型回复2708%', '工具结果1.9k56%'])
    const trend = screen.getByRole('region', { name: '上下文趋势' })
    const bars = within(trend).getAllByRole('button')
    expect(bars).toHaveLength(12)
    fireEvent.click(bars[0]!)
    expect(bars[0]!.getAttribute('aria-pressed')).toBe('true')
    within(trend).getByText('提示 2.9k · 缓存 2k · 输出 90')
    fireEvent.click(bars[0]!)
    expect(bars[0]!.getAttribute('aria-pressed')).toBe('false')
    const files = screen.getByRole('region', { name: '文件活动' })
    within(files).getByText('src/app.ts')
    within(files).getByText('+6 −0')
    const tools = screen.getByRole('region', { name: '工具' })
    expect(within(tools).getAllByRole('row').slice(1).map(row => row.firstElementChild?.textContent)).toEqual(['write', 'read', 'bash'])
    within(tools).getAllByText('@deepseek-ai/dsh-tool-fs')
    expect(screen.queryByRole('region', { name: '上下文事件' })).toBeNull()
  })

  it('lists context events newest first with known kinds named and new kinds kept', () => {
    const events = [
      { seq: 20, time: Date.UTC(2026, 9, 21, 2, 0, 5), kind: 'compaction', form: 'summary', tokens: 1200 },
      { seq: 30, time: Date.UTC(2026, 9, 21, 2, 0, 9), kind: 'model', from: 'a', to: 'b' },
      { seq: 40, time: Date.UTC(2026, 9, 21, 2, 0, 9), kind: 'future-kind' },
    ]
    render(<ContextView state={ready({ ...insight, timeline: { ...insight.timeline, events } })} />)
    const card = screen.getByRole('region', { name: '上下文事件' })
    expect(within(card).getAllByRole('row').slice(1).map(row => [...row.children].slice(1).map(cell => cell.textContent)))
      .toEqual([['future-kind', '—', '—'], ['切换模型', 'a → b', '—'], ['压缩', 'summary', '1.2k']])
    within(screen.getByRole('region', { name: '概览' })).getByText('1')
    expect(screen.getByRole('region', { name: '上下文趋势' }).querySelectorAll('.tw-ctx-marker')).toHaveLength(1)
  })

  it('folds long tables and marks failed and trimmed file operations', () => {
    const fileOps = Array.from({ length: 14 }, (_, seq) => ({ seq, path: `f${seq}.ts`, kind: 'read' as const, tool: 'read', err: seq === 0,
      added: 0, removed: 0 }))
    render(<ContextView state={ready({ ...insight, timeline: { ...insight.timeline, fileOps, fileOpsFloor: 3 } })} />)
    const files = screen.getByRole('region', { name: '文件活动' })
    expect(within(files).getAllByRole('row')).toHaveLength(13)
    fireEvent.click(within(files).getByRole('button', { name: '查看全部' }))
    expect(within(files).getAllByRole('row')).toHaveLength(15)
    within(files).getByText('1 次失败', { exact: false })
    within(files).getByText('较早的文件操作已不在统计范围内。')
    fireEvent.click(within(files).getByRole('button', { name: '收起' }))
    expect(within(files).getAllByRole('row')).toHaveLength(13)
  })

  it('leaves out figures and cards the plugin did not report', () => {
    const request = { seq: 3, time: Date.UTC(2026, 9, 21, 2, 0, 1), system: 10, tools: 0, user: 5, inject: 0, skill: 0, assistant: 0,
      tool: 0, total: 15 }
    const sparse: ContextInsight = {
      asOfSeq: 4,
      timeline: { current: { system: 10, tools: 0, user: 5, inject: 0, skill: 0, assistant: 0, tool: 0, total: 15 }, requests: [request],
        events: [] },
      tools: [{ name: 'bash', tokens: 40, plugin: '<unknown-plugin>' }, { name: 'read', tokens: 30 }],
    }
    render(<ContextView state={ready(sparse)} />)
    const overview = screen.getByRole('region', { name: '概览' })
    expect(within(overview).getAllByText('0')).toHaveLength(3)
    within(overview).getByText('15')
    within(overview).getByText('0 轮 1 次请求')
    expect(within(overview).queryByText('缓存命中率')).toBeNull()
    expect(within(overview).queryByText('运行时长')).toBeNull()
    expect(within(screen.getByRole('region', { name: '当前上下文' })).queryByText(/上下文窗口/)).toBeNull()
    const trend = screen.getByRole('region', { name: '上下文趋势' })
    fireEvent.click(within(trend).getByRole('button', { name: '#1：15 token' }))
    expect(within(trend).getByText('#1', { exact: false }).textContent).toMatch(/^#1 · \d\d:\d\d:01\.000$/)
    expect(screen.queryByRole('region', { name: '文件活动' })).toBeNull()
    const tools = screen.getByRole('region', { name: '工具' })
    expect(within(tools).getAllByRole('row').slice(1).map(row => [...row.children].map(cell => cell.textContent)))
      .toEqual([['bash', '—', '40', '—', '—'], ['read', '—', '30', '—', '—']])
  })

  it('labels requests by turn and step, and leaves out the trend, files and tools when the plugin reports none', () => {
    const request = { seq: 3, time: 0, turn: 2, system: 10, tools: 0, user: 5, inject: 0, skill: 0, assistant: 0, tool: 0, total: 15 }
    const fileOps = [{ seq: 1, path: 'src/*.ts', kind: 'search' as const, tool: 'grep', err: false, added: 0, removed: 0, pattern: true as const },
      { seq: 2, path: 'out.md', kind: 'write' as const, tool: 'write', err: false, added: 4, removed: 0 }]
    const withFiles = { ...insight, timeline: { ...insight.timeline, requests: [request], fileOps } }
    const { rerender } = render(<ContextView state={ready(withFiles)} />)
    screen.getByRole('button', { name: 'T2·S1：15 token' })
    expect(within(screen.getByRole('region', { name: '文件活动' })).getAllByRole('row').slice(1)
      .map(row => [...row.children].map(cell => cell.textContent)))
      .toEqual([['out.md', '—', '1', '—', '+4 −0'], ['搜索：src/*.ts', '—', '—', '1', '—']])
    const bare = { ...insight, tools: [], timeline: { ...insight.timeline, requests: [], fileOps: [], timing: undefined } }
    rerender(<ContextView state={ready(bare)} />)
    screen.getByRole('region', { name: '当前上下文' })
    for (const name of ['上下文趋势', '文件活动', '工具']) expect(screen.queryByRole('region', { name })).toBeNull()
  })

  it('folds a long tool table and lists called tools missing from the header', () => {
    const tools = Array.from({ length: 13 }, (_, index) => ({ name: `tool-${index}`, tokens: 100 - index, plugin: 'mcp:demo' }))
    const timing = { ...insight.timeline.timing!, tools: { 'tool-0': { calls: 2, ms: 1500 }, extra: { calls: 1, ms: 10 } } }
    render(<ContextView state={ready({ ...insight, tools, timeline: { ...insight.timeline, timing } })} />)
    const card = screen.getByRole('region', { name: '工具' })
    expect(within(card).getAllByRole('row')).toHaveLength(13)
    fireEvent.click(within(card).getByRole('button', { name: '查看全部' }))
    const rows = within(card).getAllByRole('row').slice(1).map(row => [...row.children].map(cell => cell.textContent))
    expect(rows[0]).toEqual(['tool-0', 'mcp:demo', '100', '2', '1.5s'])
    expect(rows.at(-1)).toEqual(['extra', '—', '—', '1', expect.stringMatching(/ms$/)])
  })

  it('explains each state that keeps the cards from showing', () => {
    const { rerender } = render(<ContextView state={{ status: 'loading' }} />)
    screen.getByText('正在读取上下文…')
    rerender(<ContextView state={{ status: 'unavailable' }} />)
    screen.getByText('未安装 dsh-context 插件')
    screen.getByText(INSTALL_COMMAND)
    rerender(<ContextView state={{ status: 'pending' }} />)
    screen.getByText('会话尚未创建')
    rerender(<ContextView state={{ status: 'incompatible' }} />)
    screen.getByText('无法识别上下文数据')
    rerender(<ContextView state={{ status: 'failed', failure: { kind: 'transport', detail: 'offline' } }} />)
    screen.getByText('读取上下文失败')
    rerender(<ContextView state={ready({ ...insight, timeline: { ...insight.timeline, unsupported: { current: '0.1.0', minimum: '0.1.7' } } })} />)
    screen.getByText('当前版本 0.1.0，插件要求至少 0.1.7。')
    rerender(<ContextView state={ready({ ...insight, timeline: { ...insight.timeline, requests: [],
      current: { ...insight.timeline.current, system: 0, tools: 0, user: 0, assistant: 0, tool: 0, total: 0 } } })} />)
    screen.getByText('还没有上下文数据')
  })
})

function Probe({ runId, version, enabled }: { runId: string; version: string; enabled: boolean }) {
  const state = useRunContext(runId, version, enabled)
  return <output>{state.status === 'ready' ? `ready:${state.insight.asOfSeq}` : state.status}</output>
}

describe('useRunContext', () => {
  it('reads after a quiet period, maps problems to states and keeps the last insight when a refresh fails', async () => {
    const reads: string[] = []
    let answer: () => Response = () => Response.json(response)
    vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
      reads.push(new URL(input).pathname)
      return Promise.resolve(answer())
    }))
    const problem = (status: number, code: string) => () => new Response(JSON.stringify({ type: 'about:blank', status, title: 'rejected',
      detail: code, instance: '/api/task/v1/requests/request-1', code, requestId: 'request-1' }),
    { status, headers: { 'content-type': 'application/problem+json' } })
    const connection = new TaskConnection('http://127.0.0.1:3081/')
    const app: AppValue = { connection, events: new TaskEventHub(connection), toast: () => {}, openSettings: () => {},
      openTrigger: () => {} }
    const mount = (runId: string, version: string, enabled = true) => (
      <AppContext.Provider value={app}><Probe runId={runId} version={version} enabled={enabled} /></AppContext.Provider>
    )
    const { rerender } = render(mount('run-1', 'a', false))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)) })
    expect(reads).toEqual([])
    screen.getByText('loading')
    rerender(mount('run-1', 'a'))
    await waitFor(() => { screen.getByText(`ready:${response.asOfSeq}`) })
    expect(reads).toEqual(['/api/task/v1/runs/run-1/context'])
    answer = () => new Response('{}', { status: 500 })
    rerender(mount('run-1', 'b'))
    await waitFor(() => { expect(reads).toHaveLength(2) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    screen.getByText(`ready:${response.asOfSeq}`)
    for (const [code, status, shown] of [['context_unavailable', 404, 'unavailable'], ['session_unavailable', 409, 'pending']] as const) {
      answer = problem(status, code)
      rerender(mount('run-2', code))
      await waitFor(() => { screen.getByText(shown) })
    }
    answer = () => new Response('{}', { status: 500 })
    rerender(mount('run-3', 'x'))
    await waitFor(() => { screen.getByText('failed') })
    answer = () => Response.json({ ...response, timeline: { current: 1 } })
    rerender(mount('run-3', 'y'))
    await waitFor(() => { screen.getByText('incompatible') })
  })

  it('drops a read the view abandoned', async () => {
    let pending: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', vi.fn((_input: string | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      pending = resolve
      init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    })))
    const connection = new TaskConnection('http://127.0.0.1:3081/')
    const app: AppValue = { connection, events: new TaskEventHub(connection), toast: () => {}, openSettings: () => {},
      openTrigger: () => {} }
    const mount = (version: string, enabled = true) => (
      <AppContext.Provider value={app}><Probe runId="run-1" version={version} enabled={enabled} /></AppContext.Provider>
    )
    const { rerender } = render(mount('a'))
    await waitFor(() => { expect(pending).toBeDefined() })
    pending = undefined
    rerender(mount('a', false))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    screen.getByText('loading')
    rerender(mount('b'))
    await waitFor(() => { expect(pending).toBeDefined() })
    pending!(Response.json(response))
    await waitFor(() => { screen.getByText(`ready:${response.asOfSeq}`) })
  })

})
