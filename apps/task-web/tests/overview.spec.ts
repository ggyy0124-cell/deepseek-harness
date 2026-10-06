/** Overview lanes: which lane a record sits on, the two axes, turn boundaries and the records a selected interval keeps. */
import { describe, expect, it } from 'vitest'
import { buildOverview, focusedIds, laneOf } from '../src/support/overview.ts'
import { buildTrajectory } from '../src/support/trajectory.ts'
import { at, given, message, sampleTrajectory, text } from './trajectory-fixtures.ts'

const base = Date.parse(at(0))

describe('lanes', () => {
  it('puts instructions, context and people on the input lane, requests on the model lane and tool calls on the tools lane', () => {
    expect(sampleTrajectory.records.map(record => [record.id, laneOf(record)])).toEqual([
      ['m1', 'input'], ['m2', 'model'], ['m2:2', 'tools'], ['m2:3', 'tools'], ['m5', 'model'], ['m5:0', 'tools'], ['i1', 'input'], ['m6', 'input'],
      ['m7', 'model'],
    ])
    expect(laneOf({ kind: 'context' })).toBe('input')
  })
})

describe('equal-width axis', () => {
  const overview = buildOverview(sampleTrajectory, 'sequence')

  it('gives each record one unit in display order and marks only the failed tool call', () => {
    expect(overview).toMatchObject({ start: 0, end: 9 })
    expect(overview?.spans.map(span => [span.id, span.start, span.end])).toEqual([
      ['m1', 0, 1], ['m2', 1, 2], ['m2:2', 2, 3], ['m2:3', 3, 4], ['m5', 4, 5], ['m5:0', 5, 6], ['i1', 6, 7], ['m6', 7, 8], ['m7', 8, 9],
    ])
    expect(overview?.spans.filter(span => span.failed).map(span => span.id)).toEqual(['m2:2'])
  })

  it('starts each turn at its first record and ignores inputs between turns', () => {
    expect(overview?.boundaries).toEqual([{ turn: 1, at: 0 }, { turn: 2, at: 7 }])
  })

  it('has no overview for a Run without records', () => {
    expect(buildOverview(buildTrajectory([], [], []), 'sequence')).toBeNull()
  })
})

describe('recorded-time axis', () => {
  const overview = buildOverview(sampleTrajectory, 'duration')

  it('removes the idle time before each record, so waiting for a person does not dwarf the work', () => {
    expect(overview).toMatchObject({ start: base, end: base + 14000 })
    expect(overview?.spans.map(span => [span.id, span.start - base, span.end - base])).toEqual([
      ['m1', 0, 0], ['m2', 0, 3000], ['m2:2', 3000, 4500], ['m2:3', 3000, 7500], ['m5', 7500, 10000], ['m5:0', 10000, 10000], ['i1', 10000, 10000],
      ['m6', 10000, 10000], ['m7', 10000, 14000],
    ])
  })

  it('starts each turn where its earliest record sits on the axis', () => {
    expect(overview?.boundaries).toEqual([{ turn: 1, at: base }, { turn: 2, at: base + 10000 }])
  })

  it('leaves out records without a stored start, so a turn of such records has no boundary', () => {
    const untimed = buildTrajectory([message(1, 'assistant', 3, [text('hello')], { turn: 1, step: 1 })], [given(1, 0, 'hi')], [])
    expect(buildOverview(untimed, 'duration')).toMatchObject({ spans: [{ id: 'i1' }], boundaries: [] })
  })

  it('has no overview when no record has a stored start', () => {
    expect(buildOverview(buildTrajectory([], [], []), 'duration')).toBeNull()
    expect(buildOverview(buildTrajectory([message(1, 'assistant', 3, [text('hello')], { turn: 1, step: 1 })], [], []), 'duration')).toBeNull()
  })
})

describe('focus', () => {
  it('keeps the records active at any point of the interval, edges included', () => {
    const recorded = buildOverview(sampleTrajectory, 'duration')!
    expect([...focusedIds(recorded, { start: base + 3000, end: base + 3000 })]).toEqual(['m2', 'm2:2', 'm2:3'])
    expect([...focusedIds(recorded, { start: base + 20000, end: base + 30000 })]).toEqual([])
    const equal = buildOverview(sampleTrajectory, 'sequence')!
    expect([...focusedIds(equal, { start: 2, end: 3 })]).toEqual(['m2', 'm2:2', 'm2:3'])
  })
})
