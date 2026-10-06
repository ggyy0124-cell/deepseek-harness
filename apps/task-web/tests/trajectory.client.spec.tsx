// @vitest-environment jsdom
/** Trajectory view: toolbar, timeline lanes and drag focus, and the ledger of turns, steps, requests and tool calls. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TrajectoryView } from '../src/components/Trajectory.tsx'
import { setRecordedDuration } from '../src/support/axis.ts'
import { updatePreferences } from '../src/support/preferences.ts'
import { buildTrajectory, type Trajectory } from '../src/support/trajectory.ts'
import type { Run } from '../src/support/types.ts'
import { at, call, given, message, sampleTrajectory, text, usage } from './trajectory-fixtures.ts'

/** jsdom has no PointerEvent constructor that carries coordinates and a pointer id. */
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, { bubbles: true, cancelable: true, ...init })
    this.pointerId = init.pointerId ?? 1
  }
}

const live: Pick<Run, 'createdAt' | 'terminalAt'> = { createdAt: new Date().toISOString(), terminalAt: null }
const ended: Pick<Run, 'createdAt' | 'terminalAt'> = { createdAt: at(0), terminalAt: at(50) }
const scrolled = vi.fn()
const AXIS_PX = 900

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-10-06T12:00:00Z'), toFake: ['Date'] })
  updatePreferences({ locale: 'zh-CN', time: 'utc' })
  setRecordedDuration(false)
  scrolled.mockClear()
  Element.prototype.scrollIntoView = scrolled
  HTMLElement.prototype.setPointerCapture = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: AXIS_PX, bottom: 40, width: AXIS_PX, height: 40, x: 0, y: 0, toJSON: () => ({}),
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  setRecordedDuration(false)
  updatePreferences({ time: 'local' })
})

function view(patch: { run?: Pick<Run, 'createdAt' | 'terminalAt'>; trajectory?: Trajectory; working?: boolean; selectedId?: string | null } = {}) {
  const onSelect = vi.fn()
  render(<TrajectoryView run={patch.run ?? live} trajectory={patch.trajectory ?? sampleTrajectory} working={patch.working ?? false}
    selectedId={patch.selectedId ?? null} onSelect={onSelect} />)
  return { onSelect }
}
const rowOf = (needle: string) => {
  const row = [...document.querySelectorAll<HTMLElement>('[data-traj-row]')].find(candidate => candidate.textContent.includes(needle))
  if (row === undefined) throw new Error(`no row contains ${needle}`)
  return row
}
const byId = (id: string) => {
  const row = document.querySelector<HTMLElement>(`[data-record-id="${id}"]`)
  if (row === null) throw new Error(`no row ${id}`)
  return row
}
const rowIds = () => [...document.querySelectorAll<HTMLElement>('[data-traj-row]')].map(row => row.dataset['recordId'])
const block = (id: string) => {
  const found = document.querySelector<HTMLElement>(`[data-timeline-id="${id}"]`)
  if (found === null) throw new Error(`no timeline block ${id}`)
  return found
}
const track = () => document.querySelector<HTMLElement>('.tw-tl-track')!
const pointer = (target: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number) => {
  act(() => { target.dispatchEvent(new TestPointerEvent(type, { clientX, button: 0, pointerId: 1 })) })
}
/** Press at `from` and release at `to`; between them the pointer moves to `to`. */
const drag = (target: Element, from: number, to: number = from) => {
  pointer(target, 'pointerdown', from)
  pointer(target, 'pointermove', to)
  pointer(target, 'pointerup', to)
}

describe('toolbar', () => {
  it('offers the duration, turns and calls toggles and a search field', () => {
    view()
    const toolbar = screen.getByRole('toolbar', { name: '轨迹工具栏' })
    expect(within(toolbar).getAllByRole('button').map(button => [button.textContent, button.getAttribute('aria-pressed')])).toEqual([
      ['时长', 'false'], ['轮次', 'false'], ['调用', 'false'],
    ])
    expect(within(toolbar).getByRole('searchbox', { name: '搜索轨迹' })).toBeDefined()
  })

  it('sizes the timeline blocks by recorded duration instead of equal widths, and remembers the choice', () => {
    view()
    expect(block('m1').style.getPropertyValue('--tw-tl-size')).toBe(`${100 / 9}%`)
    fireEvent.click(screen.getByRole('button', { name: '使用实际时长' }))
    expect(screen.getByRole('button', { name: '使用实际时长' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '使用实际时长' }).getAttribute('title')).toBe('使用等宽操作')
    expect(block('m1').style.getPropertyValue('--tw-tl-size')).toBe('0%')
    expect(block('m2').style.getPropertyValue('--tw-tl-size')).toBe(`${3000 / 14000 * 100}%`)
    expect(localStorage.getItem('dsh-task-web.trajectory-duration')).toBe('true')
  })

  it('folds and unfolds every turn, keeping the first record of a folded turn and the inputs between turns', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: '收起所有轮次' }))
    expect(screen.getByRole('button', { name: '展开所有轮次' }).getAttribute('aria-pressed')).toBe('true')
    expect(rowIds()).toEqual(['m1', 'i1', 'm6'])
    expect(screen.getAllByRole('button', { name: /个步骤/ }).map(button => button.textContent)).toEqual(['…2 个步骤 · 3 个工具调用', '…1 个步骤'])
    fireEvent.click(screen.getByRole('button', { name: '展开所有轮次' }))
    expect(rowIds()).toEqual(['m1', 'm2', 'm2:2', 'm2:3', 'm5', 'm5:0', 'i1', 'm6', 'm7'])
  })

  it('folds and unfolds the tool calls under every request, and a summary unfolds only its own request', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: '收起所有调用' }))
    expect(rowIds()).toEqual(['m1', 'm2', 'm5', 'i1', 'm6', 'm7'])
    expect(screen.getAllByRole('button', { name: /个工具调用/ }).map(button => button.textContent)).toEqual(['…2 个工具调用 · read_file, bash', '…1 个工具调用 · bash'])
    fireEvent.click(screen.getByRole('button', { name: '1 个工具调用 · bash' }))
    expect(rowIds()).toEqual(['m1', 'm2', 'm5', 'm5:0', 'i1', 'm6', 'm7'])
    expect(screen.getByRole('button', { name: '收起所有调用' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '收起所有调用' }))
    expect(rowIds()).toEqual(['m1', 'm2', 'm5', 'i1', 'm6', 'm7'])
    fireEvent.click(screen.getByRole('button', { name: '展开所有调用' }))
    expect(rowIds()).toEqual(['m1', 'm2', 'm2:2', 'm2:3', 'm5', 'm5:0', 'i1', 'm6', 'm7'])
  })

  it('has nothing to fold in a Run without turns', () => {
    view({ trajectory: buildTrajectory([], [given(1, 0, 'only input')], []) })
    expect(rowIds()).toEqual(['i1'])
    fireEvent.click(screen.getByRole('button', { name: '收起所有轮次' }))
    expect(rowIds()).toEqual(['i1'])
  })

  it('keeps the records that match the search with their headers, opens folded turns and dims the other blocks', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: '收起所有轮次' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索轨迹' }), { target: { value: 'CONNECTION refused' } })
    expect(rowIds()).toEqual(['m2:2'])
    expect(screen.getByText('第 1 轮')).toBeDefined()
    expect(screen.queryByText('第 2 轮')).toBeNull()
    expect([block('m2:2'), block('m2')].map(item => item.dataset['match'])).toEqual(['true', 'false'])
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索轨迹' }), { target: { value: 'disk' } })
    expect(rowIds()).toEqual(['i1'])
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索轨迹' }), { target: { value: 'no such text' } })
    expect(screen.getByText('没有匹配的记录')).toBeDefined()
  })
})

describe('timeline', () => {
  it('draws the input, model and tools lanes and puts each record on the lane of its kind', () => {
    view()
    expect(document.querySelector('.tw-tl-labels')?.textContent).toBe('输入模型工具')
    expect(['m1', 'i1', 'm2', 'm7', 'm2:2', 'm5:0'].map(id => [id, block(id).style.getPropertyValue('--tw-tl-lane')])).toEqual([
      ['m1', '0'], ['i1', '0'], ['m2', '1'], ['m7', '1'], ['m2:2', '2'], ['m5:0', '2'],
    ])
    expect(document.querySelectorAll('.tw-tl-boundary')).toHaveLength(1)
  })

  it('marks a failed call, splits a request at its first token and marks the record shown in the sidebar', () => {
    view({ selectedId: 'm2:2' })
    expect(block('m2:2').dataset['failed']).toBe('true')
    expect(block('m2:3').dataset['failed']).toBeUndefined()
    expect(block('m2').dataset['split']).toBe('true')
    expect(block('m2').style.getPropertyValue('--tw-tl-ttft')).toBe(`${1 / 3 * 100}%`)
    expect(block('m2:3').dataset['split']).toBeUndefined()
    expect(block('m2:2').dataset['current']).toBe('true')
    expect(document.querySelectorAll('[data-current]')).toHaveLength(1)
  })

  it('marks the model request of a selected request view', () => {
    view({ selectedId: 'q2' })
    expect(block('m5').dataset['current']).toBe('true')
  })

  it('selects a record by clicking its block and scrolls its row into view after unfolding the turn', () => {
    const { onSelect } = view()
    fireEvent.click(screen.getByRole('button', { name: '收起所有轮次' }))
    drag(block('m2:2'), 250)
    expect(onSelect).toHaveBeenCalledWith('m2:2')
    expect(rowIds()).toContain('m2:2')
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('focuses the records under a dragged interval, dims the others, and clears with Escape or a double click', () => {
    view()
    drag(track(), 250, 450)
    expect([...document.querySelectorAll<HTMLElement>('.tw-tl-span')].filter(item => item.dataset['inside'] === 'true').map(item => item.dataset['timelineId']))
      .toEqual(['m2:2', 'm2:3', 'm5'])
    expect(rowIds().filter(id => byId(id!).hasAttribute('data-dim'))).toEqual(['m1', 'm2', 'm5:0', 'i1', 'm6', 'm7'])
    expect(document.querySelector('.tw-tl-selection')).not.toBeNull()
    fireEvent.keyDown(track(), { key: 'Escape' })
    expect(document.querySelector('.tw-tl-selection')).toBeNull()
    expect(document.querySelectorAll('[data-dim]')).toHaveLength(0)
    drag(track(), 250, 450)
    fireEvent.doubleClick(track())
    expect(document.querySelector('.tw-tl-selection')).toBeNull()
    fireEvent.keyDown(track(), { key: 'Escape' })
    expect(document.querySelector('.tw-tl-selection')).toBeNull()
  })

  it('focuses a block-sized interval and reveals the nearest record when the axis is clicked between blocks', () => {
    view()
    drag(track(), 450)
    expect(document.querySelector('.tw-tl-selection')).not.toBeNull()
    expect(scrolled).toHaveBeenCalledTimes(1)
  })

  it('drops the focus when the axis changes, because the interval belongs to the other axis', () => {
    view()
    drag(track(), 250, 450)
    fireEvent.click(screen.getByRole('button', { name: '使用实际时长' }))
    expect(document.querySelector('.tw-tl-selection')).toBeNull()
    expect(document.querySelectorAll('[data-dim]')).toHaveLength(0)
  })

  it('shows a guide line under the pointer and ignores other mouse buttons', () => {
    view()
    pointer(track(), 'pointermove', 300)
    expect(document.querySelector('.tw-tl-hover')).not.toBeNull()
    act(() => { track().dispatchEvent(new TestPointerEvent('pointerdown', { clientX: 300, button: 2 })) })
    expect(document.querySelector('.tw-tl-selection')).toBeNull()
    fireEvent.pointerLeave(track())
    expect(document.querySelector('.tw-tl-hover')).toBeNull()
  })

  it('says so when no record has a stored time on the recorded-duration axis', () => {
    setRecordedDuration(true)
    view({ trajectory: buildTrajectory([message(1, 'assistant', 3, [text('hello')], { turn: 1, step: 1 })], [], []) })
    expect(screen.getByText('无计时数据')).toBeDefined()
  })
})

describe('ledger', () => {
  it('lists each turn with its steps, and each request and tool call with its tokens and time', () => {
    view()
    expect(screen.getAllByRole('columnheader').filter(cell => ['输入', '输出', '思考', '时间'].includes(cell.textContent)).map(cell => cell.textContent))
      .toEqual(['输入', '输出', '思考', '时间', '输入', '输出', '思考', '时间'])
    expect(screen.getByText('第 1 轮').closest('[role=row]')?.textContent).toContain('2 个步骤 · 3 个工具调用 · 1 失败')
    expect(screen.getByText('第 2 轮').closest('[role=row]')?.textContent).toContain('1 个步骤')
    const request = within(rowOf('Looking now'))
    expect([request.getByText('助手'), request.getByText('155'), request.getByText('20'), request.getByText('8'), request.getByText('3.0s')].length).toBe(5)
    expect(within(rowOf('stage two')).getByText('用户')).toBeDefined()
    expect(within(rowOf('please also check disk')).getByText('补充')).toBeDefined()
    expect(screen.getAllByText(/^第 \d+ 步$/).map(item => item.textContent)).toEqual(['第 1 步', '第 2 步', '第 1 步'])
    expect(screen.getAllByRole('button', { name: /^请求 #/ }).map(button => button.textContent)).toEqual(['请求 #1', '请求 #2', '请求 #3'])
  })

  it('shows what a request wrote: its text, or that it only called tools or only thought', () => {
    const only = buildTrajectory([
      message(1, 'assistant', 1, [call('a')], { turn: 1, step: 1 }), message(2, 'assistant', 2, [{ kind: 'reasoning', text: 'hmm' }], { turn: 1, step: 2 }),
      message(3, 'assistant', 3, [], { turn: 1, step: 3 }),
    ], [], [])
    view({ trajectory: only })
    expect(rowOf('（仅工具调用）')).toBeDefined()
    expect(rowOf('（仅思考）')).toBeDefined()
    expect(rowOf('无内容')).toBeDefined()
  })

  it('shows the tool name with its argument summary and the first line of its result', () => {
    view()
    const failed = within(rowOf('read_file'))
    expect(failed.getByText('ERROR connection refused')).toBeDefined()
    expect(rowOf('read_file').getAttribute('data-failed')).toBe('true')
    expect(within(rowOf('read_file')).getByText('1.5s')).toBeDefined()
    const empty = buildTrajectory([
      message(1, 'assistant', 1, [call('a')], { turn: 1, step: 1 }), message(2, 'tool', 2, [], { turn: 1, step: 1, callId: 'a' }),
      message(3, 'tool', 3, [text('stray')], { turn: 1, step: 1, callId: 'stray' }),
    ], [], [])
    cleanup()
    view({ trajectory: empty })
    expect(within(rowOf('bash')).getByText('无输出')).toBeDefined()
    expect(within(rowOf('stray')).getByText('—')).toBeDefined()
  })

  it('shows an unanswered call as running while the Run is live and as without result after it ended', () => {
    view()
    expect(within(byId('m2:3')).queryByText('运行中')).toBeNull()
    expect(within(byId('m5:0')).getByText('运行中')).toBeDefined()
    cleanup()
    view({ run: ended })
    const row = byId('m5:0')
    expect(within(row).queryByText('运行中')).toBeNull()
    expect(within(row).getByText('未返回结果')).toBeDefined()
  })

  it('shows the token counts of a request in a tooltip, with the cache counters the provider reported', () => {
    view()
    const cell = within(rowOf('Looking now')).getByText('155')
    expect(cell.getAttribute('title')).toBe('输入 155 tok · 缓存读取 50 tok · 缓存写入 5 tok · 输出 20 tok · 推理 8 tok')
  })

  it('folds one turn from its header and one request’s calls from its chevron or a double click', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: /第 1 轮/ }))
    expect(rowIds()).toEqual(['m1', 'i1', 'm6', 'm7'])
    fireEvent.click(screen.getByRole('button', { name: /第 1 轮/ }))
    fireEvent.click(screen.getAllByRole('button', { name: '收起此请求的工具调用' })[0]!)
    expect(rowIds()).toEqual(['m1', 'm2', 'm5', 'm5:0', 'i1', 'm6', 'm7'])
    fireEvent.doubleClick(rowOf('Looking now'))
    expect(rowIds()).toContain('m2:2')
    fireEvent.doubleClick(rowOf('stage two'))
    expect(rowIds()).toContain('m6')
  })

  it('ends with the activity line while the Agent works, and shows an empty state when nothing was recorded', () => {
    view({ working: true })
    expect(screen.getByText(/Agent 正在工作/)).toBeDefined()
    cleanup()
    view({ trajectory: buildTrajectory([], [], []) })
    expect(screen.getByText('还没有轨迹记录')).toBeDefined()
    cleanup()
    view({ trajectory: buildTrajectory([], [], []), working: true })
    expect(screen.queryByText('还没有轨迹记录')).toBeNull()
    expect(screen.getByText(/Agent 正在工作/)).toBeDefined()
  })
})

describe('selection', () => {
  it('selects a row by click, Enter and Space, and ignores keys pressed inside a cell', () => {
    const { onSelect } = view()
    const row = rowOf('Looking now')
    fireEvent.click(row)
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(onSelect.mock.calls).toEqual([['m2'], ['m2'], ['m2']])
    fireEvent.keyDown(within(row).getByText('助手'), { key: 'Enter' })
    fireEvent.keyDown(row, { key: 'x' })
    expect(onSelect).toHaveBeenCalledTimes(3)
  })

  it('selects the model request of a step from its header', () => {
    const { onSelect } = view()
    fireEvent.click(screen.getByRole('button', { name: '请求 #2' }))
    expect(onSelect).toHaveBeenCalledWith('q2')
    cleanup()
    view({ selectedId: 'q2' })
    expect(screen.getByRole('button', { name: '请求 #2' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '请求 #1' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('marks the selected row and keeps only it in the tab order', () => {
    view({ selectedId: 'm2' })
    expect(rowOf('Looking now').getAttribute('aria-selected')).toBe('true')
    expect(rowOf('Looking now').tabIndex).toBe(0)
    expect(rowOf('stage two').getAttribute('aria-selected')).toBe('false')
    expect(rowOf('stage two').tabIndex).toBe(-1)
  })

  it('makes the first row the tab stop when nothing, or a hidden record, is selected', () => {
    view()
    expect(rowOf('Check the deploy logs').tabIndex).toBe(0)
    cleanup()
    view({ selectedId: 'm99' })
    expect(rowOf('Check the deploy logs').tabIndex).toBe(0)
  })

  it('moves between rows with the arrow, Home and End keys', () => {
    view()
    const rows = [...document.querySelectorAll<HTMLElement>('[data-traj-row]')]
    expect(rows).toHaveLength(9)
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0]!, { key: 'End' })
    expect(document.activeElement).toBe(rows[8])
    fireEvent.keyDown(rows[8]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[8])
    fireEvent.keyDown(rows[8]!, { key: 'Home' })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[0])
  })

  it('shows cache-free and reasoning-free requests with only the counts the provider reported', () => {
    const plain = buildTrajectory([message(1, 'assistant', 1, [text('plain')], { turn: 1, step: 1, usage: usage(10, 5) })], [], [])
    view({ trajectory: plain })
    const row = within(rowOf('plain'))
    expect(row.getByText('10').getAttribute('title')).toBe('输入 10 tok · 输出 5 tok')
    expect(row.getByText('5')).toBeDefined()
  })
})
