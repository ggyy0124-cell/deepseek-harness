/** Conversation timeline: input placement among stored messages and the process and answer split of each turn. */
import { describe, expect, it } from 'vitest'
import { zhCN } from '../src/i18n/zh-CN.ts'
import { blockText, buildTimeline, inputDisplayLines, inputLines, prettyArguments, type Turn } from '../src/support/timeline.ts'
import type { RunInput, TranscriptBlock, TranscriptEntry } from '../src/support/types.ts'

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 6, 10, 0, seconds)).toISOString()
const text = (value: string): TranscriptBlock => ({ kind: 'text', text: value })
const reasoning = (value: string): TranscriptBlock => ({ kind: 'reasoning', text: value })
const call = (callId: string): TranscriptBlock => ({ kind: 'tool_call', callId, name: 'bash', arguments: '{"command":"ls"}' })

function message(sequence: number, role: TranscriptEntry['role'], seconds: number, blocks: TranscriptBlock[], callId: string | null = null): TranscriptEntry {
  return {
    sequence, at: at(seconds), role, blocks, callId, isError: false, model: null, usage: null, turn: null, step: null, source: null,
    startedAt: null, firstTokenAt: null,
  }
}
function given(revision: number, seconds: number, value: RunInput['value'], kind: RunInput['kind'] = 'input'): RunInput {
  return { revision, kind, at: at(seconds), consumed: true, value }
}
const turns = (items: ReturnType<typeof buildTimeline>) => items.filter((item): item is Turn => item.kind === 'turn')

describe('turns', () => {
  it('opens a turn at each stage instruction', () => {
    const items = turns(buildTimeline([
      message(1, 'user', 0, [text('stage one')]), message(2, 'assistant', 5, [text('done one')]),
      message(3, 'user', 10, [text('stage two')]), message(4, 'assistant', 12, [text('done two')]),
    ], []))
    expect(items.map(turn => [turn.key, turn.instruction?.sequence, turn.answer.length, turn.process.length]))
      .toEqual([[1, 1, 1, 0], [3, 3, 1, 0]])
    expect(items.map(turn => turn.spanMs)).toEqual([5000, 2000])
  })

  it('folds reasoning, tool calls and narration into the process and keeps what follows as the answer', () => {
    const [turn] = turns(buildTimeline([
      message(1, 'user', 0, [text('stage')]),
      message(2, 'assistant', 2, [reasoning('think'), text('Let me look.'), call('a')]), message(3, 'tool', 3, [text('files')], 'a'),
      message(4, 'assistant', 4, [reasoning('think more'), call('b')]), message(5, 'tool', 9, [text('more files')], 'b'),
      message(6, 'assistant', 10, [text('All done.')]),
    ], []))
    expect(turn?.process.map(step => step.block.kind)).toEqual(['reasoning', 'text', 'tool_call', 'reasoning', 'tool_call'])
    expect(turn?.answer.map(step => step.block.kind)).toEqual(['text'])
    expect(turn?.toolCalls).toBe(2)
    expect(turn?.spanMs).toBe(10000)
  })

  it('keeps a turn that ends in a tool call entirely in the process', () => {
    const [turn] = turns(buildTimeline([message(1, 'assistant', 0, [text('Running it.'), call('a')])], []))
    expect(turn?.instruction).toBeUndefined()
    expect(turn?.process.map(step => step.block.kind)).toEqual(['text', 'tool_call'])
    expect(turn?.answer).toEqual([])
  })

  it('keeps a result without a stored call as a visible step', () => {
    const [turn] = turns(buildTimeline([
      message(1, 'assistant', 0, [text('Asked.')]), message(2, 'tool', 1, [text('orphan output')], 'missing'),
    ], []))
    expect(turn?.answer.map(step => step.entry.sequence)).toEqual([1, 2])
  })

  it('shows an instruction that no message answered yet as an empty turn', () => {
    const [turn] = turns(buildTimeline([message(7, 'user', 0, [text('stage')])], []))
    expect(turn).toMatchObject({ key: 7, process: [], answer: [], toolCalls: 0, spanMs: 0 })
  })
})

describe('inputs', () => {
  const entries = [
    message(1, 'user', 0, [text('stage one')]), message(2, 'assistant', 10, [text('done one')]),
    message(3, 'assistant', 40, [text('done after the input')]),
  ]

  it('places an input between the messages that surround its arrival time', () => {
    const items = buildTimeline(entries, [given(4, 25, 'please also check logs')])
    expect(items.map(item => item.kind)).toEqual(['turn', 'input', 'turn'])
    expect(turns(items).map(turn => turn.answer.map(step => step.entry.sequence))).toEqual([[2], [3]])
  })

  it('orders inputs by revision and appends those that arrived after the last message', () => {
    const items = buildTimeline(entries, [given(9, 100, 'late'), given(4, 50, 'first')])
    expect(items.map(item => item.kind === 'input' ? item.input.value : 'turn')).toEqual(['turn', 'first', 'late'])
  })

  it('shows inputs of a Run whose Session has no messages yet', () => {
    expect(buildTimeline([], [given(1, 0, 'only input')]).map(item => item.kind)).toEqual(['input'])
  })

  it('places an input that arrived with a message before that message', () => {
    const items = buildTimeline([message(1, 'assistant', 5, [text('answer')])], [given(1, 5, 'same moment')])
    expect(items.map(item => item.kind)).toEqual(['input', 'turn'])
  })
})

describe('input lines', () => {
  it('reads text, scalars and arrays as one line', () => {
    expect(inputLines('retry now')).toEqual([{ text: 'retry now' }])
    expect(inputLines(3)).toEqual([{ text: '3' }])
    expect(inputLines(null)).toEqual([{ text: 'null' }])
    expect(inputLines(['a', 2])).toEqual([{ text: '["a",2]' }])
  })

  it('reads an object as one labelled line per filled field', () => {
    expect(inputLines({ decision: 'approve', note: '', skipped: null, count: 2, nested: { a: 1 } })).toEqual([
      { label: 'decision', text: 'approve' }, { label: 'count', text: '2' }, { label: 'nested', text: '{"a":1}' },
    ])
  })
})

describe('input display lines', () => {
  it('reads a confirmation as the label of its button and anything else as input lines', () => {
    expect(inputDisplayLines(true, zhCN)).toEqual([{ text: '批准' }])
    expect(inputDisplayLines(false, zhCN)).toEqual([{ text: '拒绝' }])
    expect(inputDisplayLines({ decision: 'approve' }, zhCN)).toEqual([{ label: 'decision', text: 'approve' }])
  })
})

describe('message text', () => {
  const entry = message(1, 'assistant', 0, [reasoning('think'), text('first'), call('a'), text('second')])

  it('joins the blocks of one kind with the requested separator', () => {
    expect(blockText(entry, 'text')).toBe('first\nsecond')
    expect(blockText(entry, 'text', '\n\n')).toBe('first\n\nsecond')
    expect(blockText(entry, 'reasoning')).toBe('think')
  })

  it('reads a missing message as empty text', () => {
    expect(blockText(undefined, 'text')).toBe('')
  })

  it('indents complete tool arguments and keeps partial streamed arguments verbatim', () => {
    expect(prettyArguments('{"command":"ls","flags":["-l"]}')).toBe('{\n  "command": "ls",\n  "flags": [\n    "-l"\n  ]\n}')
    expect(prettyArguments('{"command":"l')).toBe('{"command":"l')
  })
})
