// @vitest-environment jsdom
/** Session log view and loader: states, folding, filtering, detail JSON, batches and following the end of the log. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppContext, type AppValue } from '../src/app/context.tsx'
import { SessionLogView } from '../src/components/SessionLog.tsx'
import { TaskConnection } from '../src/support/connection.ts'
import { TaskEventHub } from '../src/support/events.ts'
import { updatePreferences } from '../src/support/preferences.ts'
import { SESSION_LOG_BATCH, useSessionLog, type SessionLogFeed } from '../src/support/session-log.ts'
import type { SessionLogEntry } from '../src/support/types.ts'

function entry(sequence: number, type: string, data: Record<string, unknown> = {}): SessionLogEntry {
  // The protocol brands nothing in an entry; the event is the stored JSON object.
  return { sequence, at: new Date(sequence).toISOString(), type, event: { seq: sequence, time: sequence, type, data } as SessionLogEntry['event'] }
}
const entries = [
  entry(0, 'turn/start', { turn: 1 }),
  entry(1, 'assistant/message', { turn: 1, stream: [{ type: 'text-chunks', time0: 2, index: 0, dt: [], texts: ['hello'] }] }),
  entry(2, 'turn/end', { turn: 1 }),
]
const feed = (overrides: Partial<SessionLogFeed> = {}): SessionLogFeed => ({
  entries, status: 'ready', failure: undefined, hasMore: false, busy: false, loadMore: vi.fn(), reload: vi.fn(), ...overrides,
})
const rowTypes = () => screen.queryAllByRole('treeitem').map(item => item.querySelector('.tw-log-type')?.textContent)

beforeEach(() => { updatePreferences({ locale: 'zh-CN' }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Session log view', () => {
  it('explains a disabled host, a Session not created yet, loading and a failed read', () => {
    const { rerender } = render(<SessionLogView feed={feed({ status: 'disabled' })} />)
    screen.getByText('未开启原始事件')
    expect(screen.getByRole('status').textContent).toContain('--session-log')
    rerender(<SessionLogView feed={feed({ status: 'pending' })} />)
    screen.getByText('会话尚未创建')
    rerender(<SessionLogView feed={feed({ status: 'loading' })} />)
    screen.getByText('正在读取会话事件…')
    const reload = vi.fn()
    rerender(<SessionLogView feed={feed({ status: 'failed', reload, failure: { kind: 'transport', detail: 'offline' } })} />)
    screen.getByText('读取会话事件失败')
    fireEvent.click(screen.getByRole('button', { name: '立即重试' }))
    expect(reload).toHaveBeenCalledOnce()
  })
  it('folds the stream, toggles rows, shows the stored JSON of a selected row and filters by type', () => {
    render(<SessionLogView feed={feed()} />)
    screen.getByText('3 条事件')
    expect(rowTypes()).toEqual(['turn/start', 'assistant/message', 'turn/end'])
    fireEvent.click(screen.getByRole('button', { name: '展开' }))
    expect(rowTypes()).toEqual(['turn/start', 'assistant/message', 'text-delta', 'turn/end'])
    fireEvent.click(screen.getByRole('button', { name: '全部收起' }))
    expect(rowTypes()).toEqual(['turn/start'])
    fireEvent.click(screen.getByRole('button', { name: '全部展开' }))
    expect(rowTypes()).toEqual(['turn/start', 'assistant/message', 'text-delta', 'turn/end'])
    const turnEnd = screen.getAllByRole('treeitem')[3]!
    fireEvent.click(turnEnd.querySelector('.tw-log-row')!)
    expect(turnEnd.querySelector('pre')?.textContent).toBe(JSON.stringify(entries[2]!.event, null, 2))
    within(turnEnd).getByRole('button', { name: '复制 JSON' })
    fireEvent.click(turnEnd.querySelector('.tw-log-row')!)
    expect(turnEnd.querySelector('pre')).toBeNull()
    fireEvent.change(screen.getByRole('searchbox', { name: '按类型筛选' }), { target: { value: 'delta' } })
    screen.getByText('1 行匹配')
    expect(rowTypes()).toEqual(['turn/start', 'assistant/message', 'text-delta'])
    fireEvent.change(screen.getByRole('searchbox', { name: '按类型筛选' }), { target: { value: 'missing' } })
    screen.getByText('没有匹配的事件类型')
  })
  it('offers the next batch while more events are stored and reloads on request', () => {
    const loadMore = vi.fn()
    const reload = vi.fn()
    const { rerender } = render(<SessionLogView feed={feed({ entries: [], hasMore: true, loadMore, reload })} />)
    screen.getByText('还没有会话事件')
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    expect(loadMore).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '从头重新读取' }))
    expect(reload).toHaveBeenCalledOnce()
    rerender(<SessionLogView feed={feed({ hasMore: true, busy: true })} />)
    expect(screen.getByRole('button', { name: '加载更多' }).hasAttribute('disabled')).toBe(true)
  })
})

function Probe({ runId, active, change }: { runId: string; active: boolean; change: string }) {
  const value = useSessionLog(runId, active, change)
  return (
    <>
      <output>{`${value.status}:${value.entries.map(item => item.sequence).join(',')}:${value.hasMore}`}</output>
      <button type="button" onClick={value.loadMore}>more</button>
      <button type="button" onClick={value.reload}>reload</button>
    </>
  )
}

const problem = (status: number, code: string) => new Response(JSON.stringify({ type: 'about:blank', status, title: 'Task API request rejected',
  detail: code, instance: '/api/task/v1/requests/r', code, requestId: 'r' }), { status, headers: { 'content-type': 'application/problem+json' } })

describe('useSessionLog', () => {
  let stored: number
  let failure: (() => Response) | undefined
  let stale: boolean
  let reads: { cursor: string | null; limit: string | null }[]
  beforeEach(() => {
    stored = 3
    failure = undefined
    stale = false
    reads = []
    vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
      const url = new URL(input)
      const cursor = url.searchParams.get('cursor')
      reads.push({ cursor, limit: url.searchParams.get('limit') })
      if (failure !== undefined) return Promise.resolve(failure())
      if (stale && cursor !== null) return Promise.resolve(problem(409, 'cursor_stale'))
      const offset = cursor === null ? 0 : Number(cursor)
      const limit = Number(url.searchParams.get('limit'))
      const end = Math.min(stored, offset + limit)
      const items = Array.from({ length: end - offset }, (_, index) => entry(offset + index, 'custom'))
      return Promise.resolve(new Response(JSON.stringify({ runId: 'run-1', sessionId: 'session-1', items, nextCursor: String(end), hasMore: end < stored }),
        { status: 200, headers: { 'content-type': 'application/json' } }))
    }))
  })
  const app = (): AppValue => {
    const connection = new TaskConnection('http://127.0.0.1:3081/')
    return { connection, events: new TaskEventHub(connection), toast: () => {}, openSettings: () => {}, openTrigger: () => {} }
  }
  const mount = (value: AppValue, runId: string, active: boolean, change: string) => (
    <AppContext.Provider value={value}><Probe runId={runId} active={active} change={change} /></AppContext.Provider>
  )
  it('reads nothing while hidden, then follows appends at the end of the log', async () => {
    const value = app()
    const { rerender } = render(mount(value, 'run-1', false, 'a'))
    await act(async () => { await Promise.resolve() })
    expect(reads).toEqual([])
    rerender(mount(value, 'run-1', true, 'a'))
    await waitFor(() => { screen.getByText('ready:0,1,2:false') })
    expect(reads[0]).toEqual({ cursor: null, limit: '200' })
    stored = 5
    rerender(mount(value, 'run-1', true, 'b'))
    await waitFor(() => { screen.getByText('ready:0,1,2,3,4:false') })
    expect(reads.at(-1)).toEqual({ cursor: '3', limit: '200' })
    fireEvent.click(screen.getByRole('button', { name: 'reload' }))
    await waitFor(() => { screen.getByText('ready:0,1,2,3,4:false') })
    expect(reads.at(-1)?.cursor).toBeNull()
  })
  it('stops after one batch until more is requested', async () => {
    stored = SESSION_LOG_BATCH + 10
    render(mount(app(), 'run-1', true, 'a'))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toMatch(/:true$/) })
    expect(reads).toHaveLength(SESSION_LOG_BATCH / 200)
    const before = reads.length
    // A Session change does not page on while more stored events wait.
    fireEvent.click(screen.getByRole('button', { name: 'more' }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toMatch(/:false$/) })
    expect(reads).toHaveLength(before + 1)
  })
  it('reports a disabled host and a Session not created yet, and restarts after a stale cursor', async () => {
    failure = () => problem(404, 'session_log_disabled')
    const value = app()
    const { rerender } = render(mount(value, 'run-1', true, 'a'))
    await waitFor(() => { screen.getByText('disabled::false') })
    failure = () => problem(409, 'session_unavailable')
    rerender(mount(value, 'run-2', true, 'a'))
    await waitFor(() => { screen.getByText('pending::false') })
    failure = () => problem(500, 'internal_error')
    rerender(mount(value, 'run-3', true, 'a'))
    await waitFor(() => { screen.getByText('failed::false') })
    failure = undefined
    rerender(mount(value, 'run-4', true, 'a'))
    await waitFor(() => { screen.getByText('ready:0,1,2:false') })
    stale = true
    stored = 4
    rerender(mount(value, 'run-4', true, 'b'))
    await waitFor(() => { screen.getByText('ready:0,1,2,3:false') })
    expect(reads.slice(-2).map(read => read.cursor)).toEqual(['3', null])
  })
})
