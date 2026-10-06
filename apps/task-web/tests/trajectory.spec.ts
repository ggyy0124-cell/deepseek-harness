/** Trajectory projection: turns, steps, timing, tool-call pairing, request headers, totals and search text. */
import { describe, expect, it } from 'vitest'
import {
  buildTrajectory, durationOf, firstLine, matchesRecord, promptTokens, recordText, type InputRecord, type ToolRecord, type Trajectory,
  type TrajectoryTurn,
} from '../src/support/trajectory.ts'
import { at, call, given, header, message, reasoning, text, tool, usage } from './trajectory-fixtures.ts'

const turns = (items: Trajectory['items']) => items.filter((item): item is TrajectoryTurn => item.kind === 'turn')
const tools = (records: Trajectory['records']) => records.filter((record): record is ToolRecord => record.kind === 'tool')
const ms = (seconds: number) => Date.parse(at(seconds))

describe('turns and steps', () => {
  const logged = [
    message(1, 'user', 0, [text('stage one')], { turn: 1, source: { kind: 'task' } }),
    message(2, 'assistant', 2, [call('a')], { turn: 1, step: 1 }), message(3, 'tool', 3, [text('files')], { turn: 1, step: 1, callId: 'a' }),
    message(4, 'assistant', 5, [text('done one')], { turn: 1, step: 2 }),
    message(5, 'user', 20, [text('stage two')], { turn: 2, source: { kind: 'task' } }), message(6, 'assistant', 22, [text('done two')], { turn: 2, step: 1 }),
  ]

  it('groups the records of a turn by the logged step and lists them with consecutive numbers', () => {
    const { items, records, steps, toolCalls } = buildTrajectory(logged, [], [])
    expect(turns(items).map(turn => [turn.turn, turn.key, turn.steps, turn.toolCalls, turn.groups.map(group => group.id)]))
      .toEqual([[1, 'm1', 2, 1, ['1:messages', '1:1', '1:2']], [2, 'm5', 1, 0, ['2:messages', '2:1']]])
    expect(records.map(record => [record.index, record.id])).toEqual([[1, 'm1'], [2, 'm2'], [3, 'm2:0'], [4, 'm4'], [5, 'm5'], [6, 'm6']])
    expect([steps, toolCalls]).toEqual([3, 1])
  })

  it('measures the time a step took from its first request or tool start to its last end', () => {
    const [first] = turns(buildTrajectory([
      message(1, 'user', 0, [text('stage')], { turn: 1 }),
      message(2, 'assistant', 4, [call('a'), call('b')], { turn: 1, step: 1, startedAt: at(1) }),
      message(3, 'tool', 5, [text('one')], { turn: 1, step: 1, callId: 'a', startedAt: at(4) }),
      message(4, 'tool', 9, [text('two')], { turn: 1, step: 1, callId: 'b', startedAt: at(4) }),
    ], [], []).items)
    expect(first?.groups.map(group => group.spanMs)).toEqual([null, 8000])
  })

  it('attaches a message stored before its turn started to the turn after it, and one after the last turn to a turn of its own', () => {
    const { items } = buildTrajectory([
      message(1, 'user', 0, [text('early')]),
      message(2, 'assistant', 1, [text('first')], { turn: 1, step: 1 }),
      message(3, 'user', 2, [text('late')]),
    ], [], [])
    expect(turns(items).map(turn => [turn.turn, turn.records.map(record => record.id)])).toEqual([[1, ['m1', 'm2']], [2, ['m3']]])
  })

  it('opens a new turn when a turn number comes back after another turn', () => {
    const { items } = buildTrajectory([
      message(1, 'assistant', 0, [text('a')], { turn: 1, step: 1 }), message(2, 'assistant', 1, [text('b')], { turn: 2, step: 1 }),
      message(3, 'assistant', 2, [text('c')], { turn: 1, step: 2 }),
    ], [], [])
    expect(turns(items).map(turn => [turn.turn, turn.key])).toEqual([[1, 'm1'], [2, 'm2'], [1, 'm3']])
  })

  it('numbers the steps itself when the log carries none, and tells instructions from context by the source', () => {
    const { records } = buildTrajectory([
      message(1, 'user', 0, [text('stage')], { source: { kind: 'user' } }), message(2, 'user', 1, [text('goal')], { source: { kind: 'goal' } }),
      message(3, 'user', 2, [text('no source')]), message(4, 'assistant', 3, [text('one')]), message(5, 'assistant', 4, [text('two')]),
    ], [], [])
    expect(records.map(record => [record.kind, record.kind === 'input' ? null : record.step])).toEqual([
      ['user', null], ['context', null], ['context', null], ['assistant', 1], ['assistant', 2],
    ])
  })
})

describe('timing', () => {
  it('takes a request from its stored start to its message and a tool call from its stored start to its result', () => {
    const { records } = buildTrajectory([
      message(1, 'user', 0, [text('stage')]),
      message(2, 'assistant', 4, [call('a')], { turn: 1, step: 1, startedAt: at(1), firstTokenAt: at(2) }),
      message(3, 'tool', 7, [text('files')], { turn: 1, step: 1, callId: 'a', startedAt: at(5) }),
    ], [], [])
    const [, request, run] = records
    expect(request).toMatchObject({ kind: 'assistant', startedAt: ms(1), firstTokenAt: ms(2), endedAt: ms(4) })
    expect(run).toMatchObject({ kind: 'tool', startedAt: ms(5), endedAt: ms(7) })
    expect([request, run].map(record => durationOf(record!))).toEqual([3000, 2000])
  })

  it('starts a call at its request when the result stored no start, and leaves a request without a stored start open', () => {
    const { records } = buildTrajectory([
      message(1, 'assistant', 4, [call('a')], { turn: 1, step: 1 }), message(2, 'tool', 6, [text('files')], { turn: 1, step: 1, callId: 'a' }),
    ], [], [])
    expect(records).toMatchObject([{ kind: 'assistant', startedAt: null, firstTokenAt: null }, { kind: 'tool', startedAt: ms(4), endedAt: ms(6) }])
    expect(durationOf(records[0]!)).toBeNull()
    expect(durationOf(records[1]!)).toBe(2000)
  })

  it('has no end for a call without a result, and no length for a negative span', () => {
    const { records } = buildTrajectory([message(1, 'assistant', 4, [call('a')], { turn: 1, step: 1 })], [], [])
    expect(records[1]).toMatchObject({ kind: 'tool', startedAt: ms(4), endedAt: null })
    expect(durationOf(records[1]!)).toBeNull()
    expect(durationOf({ startedAt: 5, endedAt: 3 })).toBe(0)
  })

  it('spans the Run from its first stored time to its last', () => {
    const { spanMs } = buildTrajectory([message(1, 'user', 0, [text('stage')]), message(2, 'assistant', 45, [text('done')])], [], [])
    expect(spanMs).toBe(45000)
  })
})

describe('tool calls', () => {
  it('pairs a result with the call of the request it follows when call ids repeat across steps', () => {
    const { records } = buildTrajectory([
      message(1, 'assistant', 1, [call('x')], { turn: 1, step: 1 }), message(2, 'tool', 2, [text('first')], { turn: 1, step: 1, callId: 'x' }),
      message(3, 'assistant', 3, [call('x')], { turn: 1, step: 2 }), message(4, 'tool', 5, [text('second')], { turn: 1, step: 2, callId: 'x' }),
    ], [], [])
    expect(tools(records).map(record => [record.id, record.result?.sequence, record.parent])).toEqual([['m1:0', 2, 'm1'], ['m3:0', 4, 'm3']])
  })

  it('keeps a call without a result open and a result without a call as its own row', () => {
    const { records, failed } = buildTrajectory([
      message(1, 'tool', 0, [text('early')], { callId: 'early' }),
      message(2, 'assistant', 1, [call('a')]), message(3, 'tool', 4, [text('ghost')], { callId: 'ghost', isError: true, step: 1 }),
    ], [], [])
    expect(tools(records)).toMatchObject([
      { id: 'm1', step: null, call: undefined, parent: undefined, request: undefined, failed: false },
      { id: 'm2:0', step: 1, endedAt: null, result: undefined, parent: 'm2', failed: false },
      { id: 'm3', step: 1, call: undefined, failed: true },
    ])
    expect(failed).toBe(1)
  })

  it('marks calls whose result is an error as failed and counts them per turn and per Run', () => {
    const trajectory = buildTrajectory([
      message(1, 'user', 0, [text('stage one')], { turn: 1 }),
      message(2, 'assistant', 1, [call('a'), call('b')], { turn: 1, step: 1 }), message(3, 'tool', 2, [text('boom')], { turn: 1, step: 1, callId: 'a', isError: true }),
      message(4, 'tool', 3, [text('ok')], { turn: 1, step: 1, callId: 'b' }),
      message(5, 'user', 10, [text('stage two')], { turn: 2 }), message(6, 'assistant', 11, [call('c')], { turn: 2, step: 1 }),
      message(7, 'tool', 12, [text('fine')], { turn: 2, step: 1, callId: 'c' }),
    ], [], [])
    expect(turns(trajectory.items).map(turn => [turn.steps, turn.toolCalls, turn.failed])).toEqual([[1, 2, 1], [1, 1, 0]])
    expect([trajectory.steps, trajectory.toolCalls, trajectory.failed]).toEqual([2, 3, 1])
    expect(tools(trajectory.records).map(record => record.failed)).toEqual([true, false, false])
  })
})

describe('request headers', () => {
  const declared = [header(1, [tool('bash')]), header(10, [tool('bash'), tool('read_file')], { provider: 'deepseek', model: 'model-b' })]
  const logged = [
    message(2, 'user', 0, [text('stage')], { turn: 1 }),
    message(3, 'assistant', 2, [call('a', 'bash')], { turn: 1, step: 1 }), message(4, 'tool', 3, [text('ok')], { turn: 1, step: 1, callId: 'a' }),
    message(12, 'assistant', 8, [call('b', 'read_file'), call('c', 'mystery')], { turn: 1, step: 2 }),
  ]

  it('gives each request the latest header logged before it and each call the declaration of its tool in that header', () => {
    const { requests: sent, records } = buildTrajectory(logged, [], declared)
    expect(sent.map(request => [request.request, request.header?.sequence, request.header?.config['model']])).toEqual([[1, 1, 'model-a'], [2, 10, 'model-b']])
    expect(tools(records).map(record => [record.id, record.request, record.schema?.name])).toEqual([
      ['m3:0', 1, 'bash'], ['m12:0', 2, 'read_file'], ['m12:1', 2, undefined],
    ])
  })

  it('leaves the header empty when the log has none', () => {
    const { requests: sent, records } = buildTrajectory(logged, [], [])
    expect(sent.map(request => request.header)).toEqual([undefined, undefined])
    expect(tools(records).map(record => record.schema)).toEqual([undefined, undefined, undefined])
  })

  it('sums the counters each request reported and leaves a counter absent until one reports it', () => {
    const { requests: sent } = buildTrajectory([
      message(1, 'assistant', 1, [text('a')], { turn: 1, step: 1, usage: usage(100, 20, 50, null, 8) }),
      message(2, 'assistant', 2, [text('b')], { turn: 1, step: 2 }),
      message(3, 'assistant', 3, [text('c')], { turn: 1, step: 3, usage: usage(10, 5, null, 2) }),
    ], [], [])
    expect(sent.map(request => request.usage)).toEqual([
      { input: 100, output: 20, cacheRead: 50, reasoning: 8 }, undefined, { input: 10, output: 5, cacheWrite: 2 },
    ])
    expect(sent.map(request => request.cumulative)).toEqual([
      { input: 100, output: 20, cacheRead: 50, reasoning: 8 }, { input: 100, output: 20, cacheRead: 50, reasoning: 8 },
      { input: 110, output: 25, cacheRead: 50, cacheWrite: 2, reasoning: 8 },
    ])
  })
})

describe('inputs', () => {
  const entries = [
    message(1, 'user', 0, [text('stage one')], { turn: 1 }), message(2, 'assistant', 10, [text('done one')], { turn: 1, step: 1 }),
    message(3, 'user', 40, [text('stage two')], { turn: 2 }), message(4, 'assistant', 45, [text('done two')], { turn: 2, step: 1 }),
  ]

  it('places an input between the turns it arrived between and lists it among the records', () => {
    const { items, records } = buildTrajectory(entries, [given(3, 25, 'please also check logs'), given(4, 60, true, 'response')], [])
    expect(items.map(item => item.kind)).toEqual(['turn', 'input', 'turn', 'input'])
    expect(records.map(record => record.id)).toEqual(['m1', 'm2', 'i3', 'm3', 'm4', 'i4'])
    const input = records.find((record): record is InputRecord => record.id === 'i3')
    expect(input).toMatchObject({ kind: 'input', startedAt: ms(25), endedAt: null, input: { revision: 3 } })
  })

  it('puts an input that arrived with a turn before that turn, and orders inputs by revision', () => {
    const { records } = buildTrajectory(entries, [given(2, 40, 'same moment'), given(1, 5, 'during turn one'), given(0, 0, 'at the start')], [])
    expect(records.map(record => record.id)).toEqual(['i0', 'm1', 'm2', 'i1', 'i2', 'm3', 'm4'])
  })

  it('reads a Run without messages as empty and still lists its inputs', () => {
    expect(buildTrajectory([], [], [])).toMatchObject({
      items: [], records: [], requests: [], steps: 0, toolCalls: 0, failed: 0, spanMs: 0, promptTokens: 0, outputTokens: 0,
    })
    expect(buildTrajectory([], [given(1, 0, 'only input')], []).items.map(item => item.kind)).toEqual(['input'])
  })
})

describe('tokens', () => {
  it('counts cached input as part of the prompt and sums per turn and per Run', () => {
    const trajectory = buildTrajectory([
      message(1, 'user', 0, [text('stage one')], { turn: 1 }),
      message(2, 'assistant', 1, [call('a')], { turn: 1, step: 1, usage: usage(100, 20, 50, 5) }), message(3, 'tool', 2, [text('ok')], { turn: 1, step: 1, callId: 'a' }),
      message(4, 'assistant', 3, [text('done')], { turn: 1, step: 2, usage: usage(10, 5) }),
      message(5, 'user', 10, [text('stage two')], { turn: 2 }), message(6, 'assistant', 11, [text('no usage reported')], { turn: 2, step: 1 }),
    ], [], [])
    expect(turns(trajectory.items).map(turn => [turn.promptTokens, turn.outputTokens])).toEqual([[165, 25], [0, 0]])
    expect([trajectory.promptTokens, trajectory.outputTokens]).toEqual([165, 25])
  })

  it('adds only the counters a provider reported', () => {
    expect(promptTokens({ input: 7, output: 1 })).toBe(7)
    expect(promptTokens({ input: 7, cacheRead: 3 })).toBe(10)
    expect(promptTokens({ input: 7, cacheWrite: 2 })).toBe(9)
    expect(promptTokens({ output: 4 })).toBe(0)
  })
})

describe('search', () => {
  const trajectory = buildTrajectory([
    message(1, 'user', 0, [text('Check the Deploy logs')], { turn: 1, source: { kind: 'task' } }),
    message(2, 'assistant', 1, [reasoning('Maybe the cache is stale'), text('Looking now'), call('a', 'read_file', '{"path":"/var/log/Deploy.log"}')],
      { turn: 1, step: 1 }),
    message(3, 'tool', 2, [text('ERROR connection refused')], { turn: 1, step: 1, callId: 'a' }),
  ], [given(1, 5, { decision: 'approve', note: 'ship it' })], [])
  const [user, request, run, input] = trajectory.records

  it('collects the text a reader can see or expand in each kind of record', () => {
    expect(recordText(user!)).toBe('Check the Deploy logs')
    expect(recordText(request!)).toContain('Maybe the cache is stale')
    expect(recordText(request!)).toContain('read_file {"path":"/var/log/Deploy.log"}')
    expect(recordText(run!)).toContain('ERROR connection refused')
    expect(recordText(input!)).toContain('decision approve')
    expect(recordText(buildTrajectory([], [given(2, 0, false)], []).records[0]!)).toBe('false')
  })

  it('matches without regard to case and treats an empty search as matching everything', () => {
    expect(trajectory.records.filter(record => matchesRecord(record, 'deploy')).map(record => record.kind)).toEqual(['user', 'assistant', 'tool'])
    expect(trajectory.records.filter(record => matchesRecord(record, 'connection refused')).map(record => record.kind)).toEqual(['tool'])
    expect(trajectory.records.every(record => matchesRecord(record, ''))).toBe(true)
    expect(trajectory.records.some(record => matchesRecord(record, 'nothing like this'))).toBe(false)
  })

  it('cuts a cell text to its first non-empty line of at most 240 characters', () => {
    expect(firstLine('\n  first line  \nsecond')).toBe('first line')
    expect(firstLine('   \n ')).toBe('')
    expect(firstLine('x'.repeat(300))).toHaveLength(240)
  })
})
