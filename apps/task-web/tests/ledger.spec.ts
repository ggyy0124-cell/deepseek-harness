/** Ledger lines: turn and step headers, folded turns, folded tool calls and the records a search keeps. */
import { describe, expect, it } from 'vitest'
import { buildLines, foldableCalls, foldableTurns, type Folds, type Line } from '../src/support/ledger.ts'
import { buildTrajectory } from '../src/support/trajectory.ts'
import { message, sampleTrajectory, text } from './trajectory-fixtures.ts'

const none: Folds = { turns: new Set(), calls: new Set() }
const fold = (patch: { turns?: string[]; calls?: string[] }): Folds => ({ turns: new Set(patch.turns), calls: new Set(patch.calls) })
const outline = (lines: readonly Line[]) => lines.map((line) => {
  switch (line.kind) {
    case 'input': return `input ${line.record.id}`
    case 'turn': return `turn ${line.turn.turn}${line.open ? '' : ' folded'}`
    case 'group': return `group ${line.group.id}`
    case 'record': return `${line.record.id}${line.folded ? ' folded' : ''}`
    case 'summary': return `summary ${line.scope} ${line.id} ${line.steps}/${line.calls} ${line.names.join(',')}`
  }
})

describe('foldable parts', () => {
  it('folds the turns that hold more than one record and the requests that asked for tool calls', () => {
    expect(foldableTurns(sampleTrajectory)).toEqual(['m1', 'm6'])
    expect(foldableCalls(sampleTrajectory)).toEqual(['m2', 'm5'])
    const lone = buildTrajectory([message(1, 'assistant', 0, [text('hello')], { turn: 1, step: 1 })], [], [])
    expect([foldableTurns(lone), foldableCalls(lone)]).toEqual([[], []])
  })
})

describe('lines', () => {
  it('lists each turn with its step groups, records and the inputs between turns', () => {
    expect(outline(buildLines(sampleTrajectory, null, none))).toEqual([
      'turn 1', 'group 1:messages', 'm1', 'group 1:1', 'm2', 'm2:2', 'm2:3', 'group 1:2', 'm5', 'm5:0',
      'input i1',
      'turn 2', 'group 2:messages', 'm6', 'group 2:1', 'm7',
    ])
  })

  it('marks a request with tool calls as foldable and unfolded by default', () => {
    const records = buildLines(sampleTrajectory, null, none).flatMap(line => (line.kind === 'record' ? [line] : []))
    expect(records.map(line => [line.record.id, line.foldable, line.folded])).toEqual([
      ['m1', false, false], ['m2', true, false], ['m2:2', false, false], ['m2:3', false, false], ['m5', true, false], ['m5:0', false, false],
      ['m6', false, false], ['m7', false, false],
    ])
  })

  it('shows the first record of a folded turn and a summary of the rest', () => {
    expect(outline(buildLines(sampleTrajectory, null, fold({ turns: ['m1'] })))).toEqual([
      'turn 1 folded', 'm1', 'summary turn m1 2/3 read_file,bash',
      'input i1',
      'turn 2', 'group 2:messages', 'm6', 'group 2:1', 'm7',
    ])
  })

  it('replaces the tool calls of a folded request with a summary that names the tools', () => {
    expect(outline(buildLines(sampleTrajectory, null, fold({ calls: ['m2'] })))).toEqual([
      'turn 1', 'group 1:messages', 'm1', 'group 1:1', 'm2 folded', 'summary calls m2 0/2 read_file,bash', 'group 1:2', 'm5', 'm5:0',
      'input i1',
      'turn 2', 'group 2:messages', 'm6', 'group 2:1', 'm7',
    ])
  })

  it('does not fold a turn with a single record', () => {
    const lone = buildTrajectory([message(1, 'assistant', 0, [text('hello')], { turn: 1, step: 1 })], [], [])
    expect(outline(buildLines(lone, null, fold({ turns: ['m1'] })))).toEqual(['turn 1', 'group 1:1', 'm1'])
    expect(buildLines(lone, null, none)[0]).toMatchObject({ kind: 'turn', foldable: false, open: true })
  })
})

describe('search', () => {
  const folded = fold({ turns: ['m1', 'm6'], calls: ['m2', 'm5'] })

  it('keeps the matching records with their turn and step headers and ignores folds', () => {
    expect(outline(buildLines(sampleTrajectory, new Set(['m2:2']), folded))).toEqual(['turn 1', 'group 1:1', 'm2:2'])
    expect(outline(buildLines(sampleTrajectory, new Set(['m2', 'm7']), folded))).toEqual([
      'turn 1', 'group 1:1', 'm2', 'turn 2', 'group 2:1', 'm7',
    ])
  })

  it('keeps a matching input and drops the turns and inputs without a match', () => {
    expect(outline(buildLines(sampleTrajectory, new Set(['i1']), none))).toEqual(['input i1'])
    expect(buildLines(sampleTrajectory, new Set(), none)).toEqual([])
  })
})
