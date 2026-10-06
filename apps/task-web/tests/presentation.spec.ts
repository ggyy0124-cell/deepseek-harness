/** Trajectory presentation: selection ids, inspector tabs, labels, status and the timing and token facts the inspector shows. */
import { describe, expect, it } from 'vitest'
import { zhCN as t } from '../src/i18n/zh-CN.ts'
import {
  assistantTimings, findSubject, inputText, kindLabel, locationOf, parseContainer, requestId, sourceLabel, statusOf, tabsOf, tokenTimings,
  usageTitle, type Subject,
} from '../src/support/presentation.ts'
import { buildTrajectory, type AssistantRecord, type ToolRecord, type TrajectoryRecord } from '../src/support/trajectory.ts'
import { at, call, given, message, sampleTrajectory, text, usage } from './trajectory-fixtures.ts'

const record = (id: string): TrajectoryRecord => {
  const found = sampleTrajectory.records.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`no record ${id}`)
  return found
}
const request = (id: string) => record(id) as AssistantRecord
const subject = (id: string): Subject => ({ kind: 'record', record: record(id) })

describe('selection', () => {
  it('selects a model request by the number of the request and a record by its id', () => {
    expect(requestId(3)).toBe('q3')
    expect(findSubject(sampleTrajectory, 'q2')).toEqual({ kind: 'request', record: request('m5') })
    expect(findSubject(sampleTrajectory, 'm2:2')).toEqual({ kind: 'record', record: record('m2:2') })
  })

  it('finds nothing for an id a refresh removed', () => {
    expect(findSubject(sampleTrajectory, 'q9')).toBeUndefined()
    expect(findSubject(sampleTrajectory, 'm99')).toBeUndefined()
  })
})

describe('inspector tabs', () => {
  it('offers messages an overview, a rendering and the raw blocks, and the source when one is stored', () => {
    expect(tabsOf(subject('m1'))).toEqual(['overview', 'rendered', 'raw', 'source'])
    const context = buildTrajectory([message(1, 'user', 0, [text('injected')], { turn: 1 })], [], []).records[0]!
    expect(tabsOf({ kind: 'record', record: context })).toEqual(['overview', 'rendered', 'raw'])
    expect(tabsOf(subject('m2'))).toEqual(['overview', 'rendered', 'raw'])
  })

  it('offers a tool call its arguments, result, schema and timing, leaving out what the log lacks', () => {
    expect(tabsOf(subject('m2:2'))).toEqual(['overview', 'input', 'output', 'schema', 'timing'])
    expect(tabsOf(subject('m5:0'))).toEqual(['overview', 'input', 'schema', 'timing'])
    const orphan = buildTrajectory([message(1, 'tool', 0, [text('late')], { callId: 'ghost' })], [], []).records[0]!
    expect(tabsOf({ kind: 'record', record: orphan })).toEqual(['overview', 'output', 'schema', 'timing'])
  })

  it('offers an input its overview and raw value, and a model request its options, usage and timing', () => {
    expect(tabsOf(subject('i1'))).toEqual(['overview', 'raw'])
    expect(tabsOf({ kind: 'request', record: request('m2') })).toEqual(['overview', 'options', 'usage', 'timing'])
  })
})

describe('labels', () => {
  it('names the kind of each record, telling a reply from a supplement', () => {
    expect(sampleTrajectory.records.map(item => kindLabel(item, t))).toEqual(['用户', '助手', '工具', '工具', '助手', '工具', '补充', '用户', '助手'])
    const [reply] = buildTrajectory([], [given(1, 0, true, 'response')], []).records
    expect(kindLabel(reply!, t)).toBe('回复')
    const context = buildTrajectory([message(1, 'user', 0, [text('injected')], { turn: 1 })], [], []).records[0]!
    expect(kindLabel(context, t)).toBe('上下文')
  })

  it('names the turn and step that hold a record, or that it sits between turns', () => {
    expect(['m1', 'm2', 'm5:0', 'i1', 'm6'].map(id => locationOf(record(id), t))).toEqual([
      '第 1 轮 · 消息', '第 1 轮 · 第 1 步', '第 1 轮 · 第 2 步', '轮次之间', '第 2 轮 · 消息',
    ])
  })

  it('names the origin of a message', () => {
    const named = [{ kind: 'user' }, { kind: 'task' }, { kind: 'goal' }, { kind: 'goal', round: 3 }, { kind: 'goal', round: 0 }, { kind: 'schedule' }]
    expect(named.map(source => sourceLabel(source, t))).toEqual(['用户', '任务', '目标', '目标 · Round 3', '目标', 'Schedule'])
    expect([null, { kind: '' }, { kind: 7 }, {}].map(source => sourceLabel(source, t))).toEqual(['未知', '未知', '未知', '未知'])
  })

  it('writes an input as one line, reading a confirmation as the label of its button', () => {
    const inputs = buildTrajectory([], [given(1, 0, 'plain'), given(2, 1, { decision: 'approve', note: 'ship it' }, 'response'), given(3, 2, false, 'response')], [])
    expect(inputs.records.flatMap(item => (item.kind === 'input' ? [inputText(item, t)] : []))).toEqual(['plain', 'decision approve · note ship it', '拒绝'])
  })
})

describe('status', () => {
  const live = true
  const ended = false

  it('reads a failed call as failed, an unanswered call as running while the Run is live and as without result after it ended', () => {
    expect(statusOf(record('m2:2'), live)).toBe('failed')
    expect(statusOf(record('m2:3'), ended)).toBe('completed')
    expect(statusOf(record('m5:0'), live)).toBe('pending')
    expect(statusOf(record('m5:0'), ended)).toBe('interrupted')
    expect(statusOf(record('m2'), ended)).toBe('completed')
  })
})

describe('tokens', () => {
  it('writes the counters a request reported as hover text', () => {
    expect(usageTitle(request('m2').usage!, t)).toBe('输入 155 tok · 缓存读取 50 tok · 缓存写入 5 tok · 输出 20 tok · 推理 8 tok')
    expect(usageTitle(request('m5').usage!, t)).toBe('输入 10 tok · 输出 5 tok')
    expect(usageTitle({}, t)).toBe('输入 0 tok')
  })
})

describe('JSON text', () => {
  it('parses objects and arrays and leaves every other text as text', () => {
    expect(parseContainer('{"a":1}')).toEqual({ a: 1 })
    expect(parseContainer('[1,2]')).toEqual([1, 2])
    expect(['5', 'null', '"text"', 'plain prose', '{"cut":'].map(parseContainer)).toEqual([undefined, undefined, undefined, undefined, undefined])
  })
})

describe('request timing', () => {
  it('splits a request into the delay to the first token and the generation after it, and gives the output rate', () => {
    expect(tokenTimings(request('m2'))).toEqual({ ttftMs: 1000, decodingMs: 2000 })
    expect(tokenTimings(request('m5'))).toEqual({ ttftMs: 500, decodingMs: 2000 })
    expect(assistantTimings(request('m2'), t)).toEqual({ total: '3.00 秒', ttft: '1.00 秒', generation: '2.00 秒', throughput: '10.0 tok/s' })
    expect(assistantTimings(request('m5'), t)).toEqual({ total: '2.50 秒', ttft: '500 毫秒', generation: '2.00 秒', throughput: '2.5 tok/s' })
  })

  it('has no split unless the start, the first token and the end are stored in that order', () => {
    const base = request('m2')
    expect(tokenTimings({ ...base, startedAt: null })).toBeUndefined()
    expect(tokenTimings({ ...base, firstTokenAt: null })).toBeUndefined()
    expect(tokenTimings({ ...base, endedAt: null })).toBeUndefined()
    expect(tokenTimings({ ...base, firstTokenAt: base.startedAt! - 1 })).toBeUndefined()
    expect(tokenTimings({ ...base, endedAt: base.firstTokenAt! - 1 })).toBeUndefined()
  })

  it('names what the log lacks instead of a number', () => {
    const base = request('m2')
    const none = { ...base, startedAt: null, firstTokenAt: null }
    expect(assistantTimings(none, t)).toEqual({ total: '未记录', ttft: '未记录', generation: '首 token 时间不可用', throughput: '首 token 时间不可用' })
    expect(assistantTimings({ ...none, usage: undefined }, t).throughput).toBe('用量不可用')
    expect(assistantTimings({ ...base, startedAt: null }, t)).toEqual({
      total: '步骤开始时间不可用', ttft: '步骤开始时间不可用', generation: '2.00 秒', throughput: '10.0 tok/s',
    })
    expect(assistantTimings({ ...base, firstTokenAt: null }, t)).toEqual({
      total: '3.00 秒', ttft: '首 token 时间不可用', generation: '首 token 时间不可用', throughput: '首 token 时间不可用',
    })
    expect(assistantTimings({ ...base, usage: { input: 1 } }, t).throughput).toBe('输出 token 数不可用')
  })

  it('reads a request that has not ended as running, and a generation without length as too short', () => {
    const base = request('m2')
    expect(assistantTimings({ ...base, endedAt: null }, t)).toEqual({ total: '运行中', ttft: '1.00 秒', generation: '运行中', throughput: '运行中' })
    const instant = buildTrajectory([
      message(1, 'assistant', 4, [call('a')], { turn: 1, step: 1, usage: usage(1, 2), startedAt: at(1), firstTokenAt: at(4) }),
    ], [], []).requests[0]!
    expect(assistantTimings(instant, t).throughput).toBe('时长过短')
  })
})

describe('tool record', () => {
  it('links a call to the request that asked for it and to the schema that request declared', () => {
    const failed = record('m2:2') as ToolRecord
    expect([failed.parent, failed.request, failed.schema?.name]).toEqual(['m2', 1, 'read_file'])
  })
})
