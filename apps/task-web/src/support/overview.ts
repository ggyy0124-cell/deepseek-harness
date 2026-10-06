/** Overview of a trajectory: its records on input, model and tool lanes along an equal-width or recorded-time axis. */
import type { Trajectory, TrajectoryRecord } from './trajectory.ts'

/** Lane of the overview that a record sits on. */
export type Lane = 'input' | 'model' | 'tools'

/** Lanes from top to bottom. */
export const LANES: readonly Lane[] = ['input', 'model', 'tools']

/** Horizontal axis: one equal-width block per record, or recorded time with the idle gaps between records removed. */
export type OverviewMode = 'sequence' | 'duration'

/** Interval on the active axis. */
export interface AxisRange {
  readonly start: number
  readonly end: number
}

/** One record placed on the axis. */
export interface OverviewSpan extends AxisRange {
  readonly id: string
  readonly lane: Lane
  readonly kind: TrajectoryRecord['kind']
  readonly failed: boolean
}

/** Where a turn starts on the axis. */
export interface OverviewBoundary {
  readonly turn: number
  readonly at: number
}

/** Every record on the axis. */
export interface Overview extends AxisRange {
  readonly spans: readonly OverviewSpan[]
  readonly boundaries: readonly OverviewBoundary[]
}

/** Lane of a record.
 * @param record - any trajectory record.
 * @returns `input` for instructions, context and people's inputs, `model` for requests and `tools` for tool calls.
 */
export function laneOf(record: Pick<TrajectoryRecord, 'kind'>): Lane {
  switch (record.kind) {
    case 'user':
    case 'context':
    case 'input': return 'input'
    case 'assistant': return 'model'
    case 'tool': return 'tools'
  }
}

function place(record: TrajectoryRecord, range: AxisRange): OverviewSpan {
  return { id: record.id, lane: laneOf(record), kind: record.kind, failed: record.kind === 'tool' && record.failed, ...range }
}

function sequence(trajectory: Trajectory): Overview | null {
  const spans: OverviewSpan[] = []
  const boundaries: OverviewBoundary[] = []
  for (const item of trajectory.items) {
    if (item.kind === 'turn') boundaries.push({ turn: item.turn, at: spans.length })
    for (const record of item.kind === 'turn' ? item.records : [item]) {
      spans.push(place(record, { start: spans.length, end: spans.length + 1 }))
    }
  }
  return spans.length === 0 ? null : { start: 0, end: spans.length, spans, boundaries }
}

/** Recorded times with the idle time before each record taken off, so waiting for a person does not dwarf the work. */
function duration(trajectory: Trajectory): Overview | null {
  const timed = trajectory.records.flatMap(record => (record.startedAt === null ? []
    : [{ record, start: record.startedAt, end: record.endedAt ?? record.startedAt }]))
  if (timed.length === 0) return null
  const idleBefore = new Map<string, number>()
  let idle = 0
  let covered = Number.NEGATIVE_INFINITY
  for (const { record, start, end } of [...timed].sort((left, right) => left.start - right.start || left.end - right.end)) {
    if (covered !== Number.NEGATIVE_INFINITY && start > covered) idle += start - covered
    idleBefore.set(record.id, idle)
    covered = Math.max(covered, end)
  }
  const spans = timed.map(({ record, start, end }) => {
    const offset = idleBefore.get(record.id) ?? 0
    return place(record, { start: start - offset, end: end - offset })
  })
  const byId = new Map(spans.map(span => [span.id, span]))
  const boundaries = trajectory.items.flatMap((item): OverviewBoundary[] => {
    if (item.kind === 'input') return []
    const starts = item.records.flatMap(record => byId.get(record.id)?.start ?? [])
    return starts.length === 0 ? [] : [{ turn: item.turn, at: starts.reduce((first, start) => Math.min(first, start)) }]
  })
  return {
    start: spans.reduce((first, span) => Math.min(first, span.start), Number.POSITIVE_INFINITY),
    end: spans.reduce((last, span) => Math.max(last, span.end), Number.NEGATIVE_INFINITY),
    spans,
    boundaries,
  }
}

/** Place every record on the three lanes.
 * @param trajectory - records of the Run.
 * @param mode - `sequence` gives each record one unit of the axis; `duration` uses recorded times without idle gaps.
 * @returns the overview, or null when no record can be placed.
 */
export function buildOverview(trajectory: Trajectory, mode: OverviewMode): Overview | null {
  return mode === 'sequence' ? sequence(trajectory) : duration(trajectory)
}

/** Records that are active at any point of a selected interval.
 * @param overview - the records on the axis.
 * @param range - selected interval, inclusive.
 * @returns ids of the records inside the interval.
 */
export function focusedIds(overview: Overview, range: AxisRange): ReadonlySet<string> {
  return new Set(overview.spans.filter(span => span.start <= range.end && span.end >= range.start).map(span => span.id))
}
