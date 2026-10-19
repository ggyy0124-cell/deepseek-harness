/** Session log model: loop grouping without invented starts, stream chunk expansion, folding and type filtering. */
import { describe, expect, it } from 'vitest'
import { buildLogTree, compactJson, expandStream, flattenLog, matchesType, type LogNode } from '../src/support/session-log.ts'
import type { SessionLogEntry } from '../src/support/types.ts'

function entry(sequence: number, type: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): SessionLogEntry {
  // The protocol brands nothing in an entry; the event is the stored JSON object.
  return { sequence, at: new Date(sequence).toISOString(), type, event: { seq: sequence, time: sequence, type, data, ...extra } as SessionLogEntry['event'] }
}
const stream = [
  { type: 'chunk', time: 10, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
  { type: 'reasoning-chunks', time0: 11, index: 0, dt: [2], texts: ['think', 'ing'] },
  { type: 'chunk', time: 14, chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'thinking' } } },
  { type: 'chunk', time: 15, chunk: { type: 'block-start', index: 1, blockType: 'tool-call' } },
  { type: 'tool-call-chunks', time0: 16, index: 1, id: 'call-1', name: 'read', dt: [], args: ['{"path":1}'] },
  { type: 'chunk', time: 17, chunk: { type: 'block-end', index: 1, block: { type: 'tool-call' } } },
  { type: 'chunk', time: 18, chunk: { type: 'finish', reason: { kind: 'stop' } } },
]
const log = [
  entry(0, 'permission/preset', { preset: 'read-only' }),
  entry(1, 'turn/start', { turn: 1 }),
  entry(2, 'step/start', { turn: 1, step: 1 }),
  entry(3, 'assistant/message', { turn: 1, step: 1, message: { content: [] }, stream }, { surfaceOp: 'append' }),
  entry(4, 'step/end', { turn: 1, step: 1 }),
  entry(5, 'working-directory/change', { cwd: '/work' }),
  entry(6, 'turn/end', { turn: 1 }),
  entry(7, 'step/end', { turn: 2, step: 1 }),
]
const types = (nodes: readonly LogNode[]): unknown[] =>
  nodes.map(node => node.children.length === 0 ? node.type : [node.type, types(node.children)])

describe('Session log tree', () => {
  it('nests events under their turn and step and keeps events without a loaded start at the root', () => {
    expect(types(buildLogTree(log))).toEqual([
      'permission/preset',
      ['turn/start', [
        ['step/start', [
          ['assistant/message', [
            ['block-start', ['reasoning-delta', 'reasoning-delta', 'block-end']], ['block-start', ['tool-call-delta', 'block-end']], 'finish',
          ]],
          'step/end',
        ]],
        'working-directory/change',
        'turn/end',
      ]],
      'step/end',
    ])
    expect(types(buildLogTree(log.slice(2, 5)))).toEqual([['step/start', [['assistant/message', expect.any(Array)], 'step/end']]])
  })
  it('summarizes events without type, position, time or stream, and blocks with their joined deltas', () => {
    const [preset, turn] = buildLogTree(log)
    expect(preset!.summary).toBe('{"preset":"read-only"}')
    const message = turn!.children[0]!.children[0]!
    expect(message.summary).toBe('{"turn":1,"step":1,"message":{"content":[]},"surfaceOp":"append"}')
    expect(message.group).toBe('stream')
    expect(message.children.map(child => child.summary)).toEqual(['reasoning: thinking', 'tool-call: {"path":1}', '{"reason":{"kind":"stop"}}'])
    expect(message.children[0]!.children.map(child => [child.summary, child.at])).toEqual([
      ['think', '1970-01-01T00:00:00.011Z'], ['ing', '1970-01-01T00:00:00.013Z'], ['{"block":{"type":"reasoning","text":"thinking"}}', '1970-01-01T00:00:00.014Z'],
    ])
    expect(buildLogTree([entry(0, 'custom', undefined, { data: undefined, extra: 1 })])[0]!.summary).toBe('{"extra":1}')
    expect(buildLogTree([{ ...entry(0, 'custom'), event: { seq: 0, time: 0, type: 'custom', data: [1] } }])[0]!.summary).toBe('{"data":[1]}')
  })
  it('expands batched deltas one per chunk and ignores streams in an unknown shape', () => {
    expect(expandStream(log[3]!.event).map(item => item.chunk.type)).toEqual([
      'block-start', 'reasoning-delta', 'reasoning-delta', 'block-end', 'block-start', 'tool-call-delta', 'block-end', 'finish',
    ])
    expect(expandStream({ data: { stream: [{ type: 'text-chunks', time0: 1, index: 0, dt: [], texts: ['a'] }] } })[0])
      .toEqual({ time: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } })
    expect(expandStream({ data: { stream: [{ type: 'tool-call-chunks', time0: 1, index: 0, id: 'c', dt: [], args: ['{'] }] } })[0]!.chunk)
      .toEqual({ type: 'tool-call-delta', index: 0, id: 'c', argumentsDelta: '{' })
    expect(expandStream({ data: { stream: [{ type: 'future-record' }] } })).toEqual([])
    expect(expandStream({ data: {} })).toEqual([])
  })
  it('shortens long summaries', () => {
    expect(compactJson('x'.repeat(500))).toHaveLength(240)
  })
})

describe('Session log rows', () => {
  const roots = buildLogTree(log)
  it('opens turns and steps, folds streams and reverses the default for toggled rows', () => {
    const rows = flattenLog(roots, new Set(), '').rows
    expect(rows.map(row => [row.node.type, row.depth, row.open])).toEqual([
      ['permission/preset', 0, false], ['turn/start', 0, true], ['step/start', 1, true], ['assistant/message', 2, false], ['step/end', 2, false],
      ['working-directory/change', 1, false], ['turn/end', 1, false], ['step/end', 0, false],
    ])
    const toggled = flattenLog(roots, new Set(['1', '3']), '')
    expect(toggled.rows.map(row => row.node.type)).toEqual(['permission/preset', 'turn/start', 'step/end'])
    expect(flattenLog(roots, new Set(['3']), '').rows.filter(row => row.depth === 3).map(row => row.node.type)).toEqual(['block-start', 'block-start', 'finish'])
    expect(toggled.matches).toBe(3)
  })
  it('keeps matching rows with their ancestors as context and counts only matches', () => {
    const filtered = flattenLog(roots, new Set(['1']), 'DELTA')
    expect(filtered.rows.map(row => [row.node.type, row.context, row.open])).toEqual([
      ['turn/start', true, true], ['step/start', true, true], ['assistant/message', true, true],
      ['block-start', true, true], ['reasoning-delta', false, false], ['reasoning-delta', false, false],
      ['block-start', true, true], ['tool-call-delta', false, false],
    ])
    expect(filtered.matches).toBe(3)
    expect(flattenLog(roots, new Set(), 'nothing').rows).toEqual([])
  })
  it('matches case-insensitive fragments with * wildcards', () => {
    expect(matchesType('tool-call-delta', 'tool*delta')).toBe(true)
    expect(matchesType('tool-call-delta', 'delta*tool')).toBe(false)
    expect(matchesType('turn/start', '  ')).toBe(true)
    expect(matchesType('turn/start', 'TURN')).toBe(true)
  })
})
