// @vitest-environment jsdom
/** Record inspector: the tabs and panels of messages, tool calls, model requests and inputs. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { idSchema } from '@deepseek-ai/dsh-task-api-protocol'
import { AppContext, type AppValue } from '../src/app/context.tsx'
import { RecordDetail } from '../src/components/RecordDetail.tsx'
import { ResultView, SourceView } from '../src/components/RecordPanels.tsx'
import { TaskConnection } from '../src/support/connection.ts'
import { TaskEventHub } from '../src/support/events.ts'
import { updatePreferences } from '../src/support/preferences.ts'
import type { DetailTab } from '../src/support/presentation.ts'
import { buildTrajectory, type ToolRecord, type Trajectory } from '../src/support/trajectory.ts'
import type { Run } from '../src/support/types.ts'
import { at, call, given, header, message, reasoning, sampleTrajectory, text, tool, usage } from './trajectory-fixtures.ts'

const runId = idSchema.parse('run-1')
const live: Pick<Run, 'id' | 'terminalAt'> = { id: runId, terminalAt: null }
const ended: Pick<Run, 'id' | 'terminalAt'> = { id: runId, terminalAt: at(50) }

beforeEach(() => { updatePreferences({ locale: 'zh-CN', time: 'utc' }) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); updatePreferences({ time: 'local' }) })

const services = (): AppValue => {
  const connection = new TaskConnection('http://127.0.0.1:3081/')
  return { connection, events: new TaskEventHub(connection), toast: () => {}, openSettings: () => {}, openTrigger: () => {} }
}
function detail(id: string, patch: { tab?: DetailTab; run?: Pick<Run, 'id' | 'terminalAt'>; trajectory?: Trajectory } = {}) {
  const onSelect = vi.fn()
  const onTab = vi.fn()
  const view = render(
    <AppContext.Provider value={services()}>
      <RecordDetail run={patch.run ?? live} trajectory={patch.trajectory ?? sampleTrajectory} id={id} tab={patch.tab ?? 'overview'}
        onSelect={onSelect} onTab={onTab} />
    </AppContext.Provider>,
  )
  return { onSelect, onTab, ...view }
}
/** Label and value of every field row. */
const fields = (): Record<string, string | null | undefined> => Object.fromEntries([...document.querySelectorAll('.tw-kv')]
  .map(row => [row.querySelector('.tw-kv-label')?.textContent ?? '', row.querySelector('.tw-kv-value')?.textContent]))
const tabs = () => screen.getAllByRole('tab').map(item => item.textContent)
const instant = (seconds: number) => new Date(Date.parse(at(seconds))).toISOString().slice(0, 23).replace('T', ' ')

describe('messages', () => {
  it('shows a task instruction with its location, tabs, overview rows and a preview', () => {
    const { onTab } = detail('m1')
    expect(within(document.querySelector<HTMLElement>('.tw-detail-name')!).getByText('用户')).toBeDefined()
    expect(screen.getByText('第 1 轮 · 消息')).toBeDefined()
    expect(tabs()).toEqual(['概述', '预览', '原始内容', '来源'])
    expect(screen.getByRole('tab', { name: '概述' }).getAttribute('aria-selected')).toBe('true')
    expect(fields()).toEqual({ 来源: '任务', 状态: '已完成' })
    expect(screen.getByText(/Check the deploy logs/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(onTab).toHaveBeenLastCalledWith('rendered')
    fireEvent.click(screen.getByRole('button', { name: '任务' }))
    expect(onTab).toHaveBeenLastCalledWith('source')
    fireEvent.click(screen.getByRole('tab', { name: '原始内容' }))
    expect(onTab).toHaveBeenLastCalledWith('raw')
  })

  it('shows a request message with its tokens, its request and the timing of that request', () => {
    const { onSelect } = detail('m2')
    expect(tabs()).toEqual(['概述', '预览', '原始内容'])
    expect(fields()).toEqual({
      来源: '请求 #1', 状态: '已完成', Token: '20 tok', 推理: '8 tok', 内容: '12 tok', 开始时间: instant(1), 总时长: '3.00 秒', '首 token 延迟': '1.00 秒',
      生成: '2.00 秒', 吞吐量: '10.0 tok/s',
    })
    fireEvent.click(screen.getByRole('button', { name: '请求 #1' }))
    expect(onSelect).toHaveBeenLastCalledWith('q1', 'overview')
    fireEvent.click(screen.getByRole('button', { name: '请求计时' }))
    expect(onSelect).toHaveBeenLastCalledWith('q1', 'timing')
  })

  it('marks a message without usage and one that wrote nothing', () => {
    const quiet = buildTrajectory([message(1, 'assistant', 3, [], { turn: 1, step: 1 })], [], [])
    detail('m1', { trajectory: quiet })
    expect(fields()['Token']).toBe('—')
    expect(screen.getAllByText('无内容').length).toBeGreaterThan(0)
  })

  it('previews the thinking behind a toggle, the text and the tool calls, and opens a call', () => {
    const { onSelect } = detail('m2', { tab: 'rendered' })
    expect(screen.queryByText('Maybe the cache is stale')).toBeNull()
    const toggle = screen.getByRole('button', { name: '思考' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByText('Maybe the cache is stale')).toBeDefined()
    expect(screen.getByRole('button', { name: '思考' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Looking now')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /read_file/ }))
    expect(onSelect).toHaveBeenCalledWith('m2:2')
  })

  it('shows every block as plain text with its own copy button', () => {
    detail('m2', { tab: 'raw' })
    expect([...document.querySelectorAll('.tw-detail-block-head > span')].map(item => item.textContent)).toEqual([
      '块 #1 reasoning', '块 #2 text', '块 #3 tool_call', '块 #4 tool_call',
    ])
    expect([...document.querySelectorAll('pre')].map(item => item.textContent)).toEqual([
      'Maybe the cache is stale', 'Looking now', 'read_file\n{\n  "path": "/var/log/deploy.log"\n}', 'bash\n{\n  "command": "ls"\n}',
    ])
    expect(screen.getAllByRole('button', { name: '复制' })).toHaveLength(4)
  })

  it('shows the blocks that carry no text and the note for a message without blocks', () => {
    const odd = buildTrajectory([
      message(1, 'user', 0, [{ kind: 'file', name: 'report.pdf', mediaType: 'application/pdf', bytes: 2048 }, { kind: 'unsupported', type: 'audio' }],
        { turn: 1, source: { kind: 'user' } }),
      message(2, 'assistant', 1, [], { turn: 1, step: 1 }),
    ], [], [])
    detail('m1', { tab: 'raw', trajectory: odd })
    expect([...document.querySelectorAll('pre')].map(item => item.textContent)).toEqual(['report.pdf · application/pdf · 2 KB', 'audio'])
    cleanup()
    detail('m2', { tab: 'raw', trajectory: odd })
    expect(screen.getByText('无内容')).toBeDefined()
  })

  it('lists the files of a message as download chips', () => {
    const files = buildTrajectory([message(1, 'user', 0, [text('see attached'), { kind: 'file', name: 'report.pdf', mediaType: 'application/pdf', bytes: 2048 }],
      { turn: 1 })], [], [])
    detail('m1', { tab: 'rendered', trajectory: files })
    expect(screen.getByRole('button', { name: /report\.pdf/ })).toBeDefined()
  })

  it('shows the stored source of a message as a JSON tree and notes a missing one', () => {
    detail('m1', { tab: 'source' })
    expect(screen.getByText('kind:')).toBeDefined()
    expect(screen.getByText('"task"')).toBeDefined()
    cleanup()
    render(<SourceView source={null} />)
    expect(screen.getByText('未记录来源')).toBeDefined()
  })

  it('opens on the overview when the record has no such tab, as for the source of context without one', () => {
    const context = buildTrajectory([message(1, 'user', 0, [text('injected')], { turn: 1 })], [], [])
    detail('m1', { tab: 'source', trajectory: context })
    expect(tabs()).toEqual(['概述', '预览', '原始内容'])
    expect(screen.getByRole('tab', { name: '概述' }).getAttribute('aria-selected')).toBe('true')
    expect(fields()).toEqual({ 状态: '已完成' })
  })
})

describe('tool calls', () => {
  it('shows a failed call with the assistant message that asked for it, its status and id, and a section for each tab', () => {
    const { onSelect, onTab } = detail('m2:2')
    expect(screen.getByText('第 1 轮 · 第 1 步')).toBeDefined()
    expect(tabs()).toEqual(['概述', '参数', '结果', 'Schema', '计时'])
    expect(fields()).toEqual({ 层级: '助手消息', 状态: '失败', '调用 ID': 'a', 开始时间: instant(4.5), 时长: '1.50 秒' })
    expect(screen.getByText('失败').className).toBe('tw-danger-text')
    expect(screen.getByText('ERROR connection refused').className).toContain('tw-detail-failed')
    fireEvent.click(screen.getByRole('button', { name: '助手消息' }))
    expect(onSelect).toHaveBeenCalledWith('m2', 'overview')
    for (const [label, tab] of [['参数', 'input'], ['结果', 'output'], ['Schema', 'schema'], ['计时', 'timing']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(onTab).toHaveBeenLastCalledWith(tab)
    }
  })

  it('shows the arguments as a JSON tree, or as text when they are not complete JSON', () => {
    detail('m2:2', { tab: 'input' })
    expect(screen.getByText('path:')).toBeDefined()
    expect(screen.getByText('"/var/log/deploy.log"')).toBeDefined()
    cleanup()
    const partial = buildTrajectory([message(1, 'assistant', 1, [call('a', 'bash', '{"cut":')], { turn: 1, step: 1 })], [], [])
    detail('m1:0', { tab: 'input', trajectory: partial })
    expect(document.querySelector('pre')?.textContent).toBe('{"cut":')
  })

  it('shows a result as a JSON tree when it is one JSON text, otherwise as text, and a result without text as no output', () => {
    detail('m2:3', { tab: 'output' })
    expect(screen.getByText('ok:')).toBeDefined()
    cleanup()
    detail('m2:2', { tab: 'output' })
    expect(document.querySelector('pre')?.textContent).toBe('ERROR connection refused')
    cleanup()
    const silent = buildTrajectory([
      message(1, 'assistant', 1, [call('a')], { turn: 1, step: 1 }), message(2, 'tool', 2, [], { turn: 1, step: 1, callId: 'a' }),
    ], [], [])
    detail('m1:0', { tab: 'output', trajectory: silent })
    expect(screen.getByText('无输出')).toBeDefined()
  })

  it('lists the files of a result as download chips', () => {
    const files = buildTrajectory([
      message(1, 'assistant', 1, [call('a')], { turn: 1, step: 1 }),
      message(2, 'tool', 2, [{ kind: 'file', name: 'out.csv', mediaType: 'text/csv', bytes: 10 }], { turn: 1, step: 1, callId: 'a' }),
    ], [], [])
    detail('m1:0', { tab: 'output', trajectory: files })
    expect(screen.getByRole('button', { name: /out\.csv/ })).toBeDefined()
    expect(screen.queryByText('无输出')).toBeNull()
  })

  it('shows the declaration the model saw, or says that the request header was not logged', () => {
    detail('m2:2', { tab: 'schema' })
    expect(screen.getByRole('heading', { name: 'read_file' })).toBeDefined()
    expect(screen.getByText('read_file tool')).toBeDefined()
    expect(screen.getByText('"object"')).toBeDefined()
    cleanup()
    const bare = buildTrajectory([message(1, 'assistant', 1, [call('a')], { turn: 1, step: 1 })], [], [])
    detail('m1:0', { tab: 'schema', trajectory: bare })
    expect(screen.getByText('Schema 不可用')).toBeDefined()
  })

  it('shows the start and length of a call and switches the start between a date and a Unix timestamp', () => {
    detail('m2:2', { tab: 'timing' })
    expect(fields()).toEqual({ 开始时间: instant(4.5), 时长: '1.50 秒', 计时来源: '会话时间戳' })
    fireEvent.click(screen.getByRole('button', { name: instant(4.5) }))
    expect(fields()['开始时间']).toBe((Date.parse(at(4.5)) / 1000).toFixed(3))
    fireEvent.click(screen.getByRole('button', { name: (Date.parse(at(4.5)) / 1000).toFixed(3) }))
    expect(fields()['开始时间']).toBe(instant(4.5))
  })

  it('shows a call without a result as running while the Run is live and without a length after it ended', () => {
    detail('m5:0')
    expect(tabs()).toEqual(['概述', '参数', 'Schema', '计时'])
    expect(fields()).toEqual({ 层级: '助手消息', 状态: '运行中', '调用 ID': 'c', 开始时间: instant(12), 时长: '运行中' })
    cleanup()
    detail('m5:0', { run: ended, tab: 'timing' })
    expect(fields()).toEqual({ 开始时间: instant(12), 时长: '不可用', 计时来源: '不可用' })
    cleanup()
    detail('m5:0', { run: ended })
    expect(fields()['状态']).toBe('未返回结果')
  })

  it('says what a missing result is: running in a live Run, not captured in an ended one', () => {
    const open = sampleTrajectory.records.find((record): record is ToolRecord => record.id === 'm5:0')!
    render(<ResultView run={live} record={open} live />)
    expect(screen.getByText('运行中')).toBeDefined()
    cleanup()
    render(<ResultView run={ended} record={open} live={false} />)
    expect(screen.getByText('未捕获结果')).toBeDefined()
  })

  it('shows a result whose call is not stored without arguments and without a hierarchy', () => {
    const orphan = buildTrajectory([message(1, 'tool', 0, [text('late')], { callId: 'ghost' })], [], [])
    detail('m1', { trajectory: orphan })
    expect(tabs()).toEqual(['概述', '结果', 'Schema', '计时'])
    expect(fields()).toEqual({ 状态: '已完成', 开始时间: instant(0), 时长: '0 毫秒' })
    expect(screen.queryByRole('button', { name: '参数' })).toBeNull()
  })
})

describe('model requests', () => {
  it('shows the request behind an assistant message with its model, calls, options, usage and timing', () => {
    const { onSelect, onTab } = detail('q1')
    expect(screen.getByText('请求 #1')).toBeDefined()
    expect(screen.getByText('第 1 轮 · 第 1 步')).toBeDefined()
    expect(tabs()).toEqual(['概述', '选项', '用量', '计时'])
    expect(fields()).toMatchObject({
      状态: '已完成', 提供方: 'deepseek', 模型: 'model-a', 工具调用: '2', 结果: '助手消息', 输入: '155 tok', 缓存读取: '50 tok', 缓存写入: '5 tok', 其他: '100 tok',
      输出: '20 tok', 推理: '8 tok', 内容: '12 tok', 总时长: '3.00 秒', 吞吐量: '10.0 tok/s',
    })
    fireEvent.click(screen.getByRole('button', { name: '助手消息' }))
    expect(onSelect).toHaveBeenCalledWith('m2', 'overview')
    for (const [label, tab] of [['选项', 'options'], ['用量', 'usage'], ['计时', 'timing']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(onTab).toHaveBeenLastCalledWith(tab)
    }
  })

  it('shows the options of the request as a JSON tree, or says that none were logged', () => {
    detail('q1', { tab: 'options' })
    expect(screen.getByText('provider:')).toBeDefined()
    expect(screen.getByText('"deepseek"')).toBeDefined()
    cleanup()
    const bare = buildTrajectory([message(1, 'assistant', 1, [text('hi')], { turn: 1, step: 1 })], [], [])
    detail('q1', { tab: 'options', trajectory: bare })
    expect(screen.getByText('未记录选项')).toBeDefined()
    cleanup()
    detail('q1', { trajectory: bare })
    expect(screen.queryByRole('button', { name: '选项' })).toBeNull()
    expect(screen.getByText('未报告用量')).toBeDefined()
  })

  it('shows the usage of the request next to the totals of the Run up to it', () => {
    detail('q2', { tab: 'usage' })
    expect(screen.getByText('本次请求')).toBeDefined()
    expect(screen.getByText('会话累计')).toBeDefined()
    const [request, total] = [...document.querySelectorAll<HTMLElement>('.tw-detail-usage-group')]
    expect(within(request!).getByText('输入').nextSibling?.textContent).toBe('10 tok')
    expect(within(total!).getByText('输入').nextSibling?.textContent).toBe('165 tok')
    expect(within(total!).getByText('缓存读取').nextSibling?.textContent).toBe('50 tok')
    expect(within(total!).getByText('输出').nextSibling?.textContent).toBe('25 tok')
  })

  it('shows the timing of the request', () => {
    detail('q3', { tab: 'timing' })
    expect(fields()).toEqual({ 开始时间: instant(41), 总时长: '4.00 秒', '首 token 延迟': '1.00 秒', 生成: '3.00 秒', 吞吐量: '1.0 tok/s' })
  })

  it('says why a timing cannot be shown when the log lacks the start or the first token', () => {
    const bare = buildTrajectory([message(1, 'assistant', 2, [text('hi')], { turn: 1, step: 1, usage: usage(5, 3) })], [], [header(0, [tool('bash')])])
    detail('q1', { tab: 'timing', trajectory: bare })
    expect(fields()).toEqual({ 开始时间: '不可用', 总时长: '未记录', '首 token 延迟': '未记录', 生成: '首 token 时间不可用', 吞吐量: '首 token 时间不可用' })
  })
})

describe('inputs', () => {
  it('shows a supplemental input with its start and the text the person gave', () => {
    const { onTab } = detail('i1')
    expect(screen.getByText('轮次之间')).toBeDefined()
    expect(tabs()).toEqual(['概述', '原始内容'])
    expect(fields()).toEqual({ 开始时间: instant(20) })
    expect(screen.getByText('please also check disk')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '原始内容' }))
    expect(onTab).toHaveBeenCalledWith('raw')
  })

  it('shows a reply as its labelled lines, a confirmation as its button and the raw value as a tree or text', () => {
    const inputs = [given(1, 1, { decision: 'approve', note: 'ship it' }, 'response'), given(2, 2, true, 'response'), given(3, 3, 'plain text')]
    const source = buildTrajectory([], inputs, [])
    detail('i1', { trajectory: source })
    expect(screen.getByText('decision')).toBeDefined()
    expect(screen.getByText(/ship it/)).toBeDefined()
    cleanup()
    detail('i1', { trajectory: source, tab: 'raw' })
    expect(screen.getByText('note:')).toBeDefined()
    cleanup()
    detail('i2', { trajectory: source })
    expect(screen.getByText('批准')).toBeDefined()
    cleanup()
    detail('i2', { trajectory: source, tab: 'raw' })
    expect(document.querySelector('pre')?.textContent).toBe('true')
    cleanup()
    detail('i3', { trajectory: source })
    expect(within(document.querySelector<HTMLElement>('.tw-detail-name')!).getByText('补充')).toBeDefined()
  })
})

describe('missing records', () => {
  it('says that a selected record is gone when a refresh removed it', () => {
    detail('m99')
    expect(screen.getByText('找不到这条记录')).toBeDefined()
    expect(screen.getByText('记录可能已被刷新，请在轨迹中重新选择。')).toBeDefined()
    cleanup()
    detail('q9')
    expect(screen.getByText('找不到这条记录')).toBeDefined()
  })
})

describe('reasoning without text', () => {
  it('previews a message that only thought', () => {
    const quiet = buildTrajectory([message(1, 'assistant', 1, [reasoning('hmm')], { turn: 1, step: 1 })], [], [])
    detail('m1', { tab: 'rendered', trajectory: quiet })
    fireEvent.click(screen.getByRole('button', { name: '思考' }))
    expect(screen.getByText('hmm')).toBeDefined()
  })
})
