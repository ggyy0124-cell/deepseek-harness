/** Lines of the trajectory ledger after search and folding. */
import type { InputRecord, Trajectory, TrajectoryGroup, TrajectoryTurn, TurnRecord } from './trajectory.ts'

/** Folded turns (by turn key) and assistant records whose tool calls are folded (by record id). */
export interface Folds {
  readonly turns: ReadonlySet<string>
  readonly calls: ReadonlySet<string>
}

/** One line of the ledger. */
export type Line =
  | { readonly kind: 'input'; readonly record: InputRecord }
  | { readonly kind: 'turn'; readonly turn: TrajectoryTurn; readonly open: boolean; readonly foldable: boolean }
  | { readonly kind: 'group'; readonly turn: TrajectoryTurn; readonly group: TrajectoryGroup }
  | {
    readonly kind: 'record'
    readonly record: TurnRecord
    /** The record is a request with tool calls under it, which can fold. */
    readonly foldable: boolean
    /** The tool calls under the request are folded into the summary line that follows. */
    readonly folded: boolean
  }
  | {
    /** Stands for the folded lines of a turn (`turn`) or of the tool calls of one request (`calls`); `id` names what to unfold. */
    readonly kind: 'summary'
    readonly scope: 'turn' | 'calls'
    readonly id: string
    readonly steps: number
    readonly calls: number
    readonly names: readonly string[]
  }

/** Turns that fold: those with more than one record.
 * @param trajectory - records of the Run.
 * @returns turn keys.
 */
export function foldableTurns(trajectory: Trajectory): readonly string[] {
  return trajectory.items.flatMap(item => (item.kind === 'turn' && item.records.length > 1 ? [item.key] : []))
}

/** Requests whose tool calls fold: those followed by at least one tool call record.
 * @param trajectory - records of the Run.
 * @returns assistant record ids.
 */
export function foldableCalls(trajectory: Trajectory): readonly string[] {
  const parents = new Set(trajectory.records.flatMap(record => (record.kind === 'tool' && record.parent !== undefined ? [record.parent] : [])))
  return trajectory.requests.flatMap(request => (parents.has(request.id) ? [request.id] : []))
}

function names(records: readonly TurnRecord[]): readonly string[] {
  return [...new Set(records.flatMap(record => (record.kind === 'tool' && record.call !== undefined ? [record.call.name] : [])))]
}

function isCallOf(record: TurnRecord | undefined, assistantId: string): boolean {
  return record?.kind === 'tool' && record.parent === assistantId
}

function summarize(scope: 'turn' | 'calls', id: string, records: readonly TurnRecord[]): Line {
  return {
    kind: 'summary', scope, id,
    steps: records.filter(record => record.kind === 'assistant').length,
    calls: records.filter(record => record.kind === 'tool').length,
    names: names(records),
  }
}

/** Flatten the trajectory into ledger lines.
 * @param trajectory - records of the Run.
 * @param matches - ids of the records that match the search, or null without a search; a search keeps matching records with their
 * turns and steps and ignores folds.
 * @param folds - folded turns and tool calls.
 * @returns lines in display order: inputs, turn headers, step headers, records and fold summaries.
 */
export function buildLines(trajectory: Trajectory, matches: ReadonlySet<string> | null, folds: Folds): readonly Line[] {
  const lines: Line[] = []
  const searching = matches !== null
  const foldableIds = new Set(foldableCalls(trajectory))
  for (const item of trajectory.items) {
    if (item.kind === 'input') {
      if (matches === null || matches.has(item.id)) lines.push({ kind: 'input', record: item })
      continue
    }
    if (matches !== null && !item.records.some(record => matches.has(record.id))) continue
    const turnFoldable = item.records.length > 1
    const open = searching || !turnFoldable || !folds.turns.has(item.key)
    lines.push({ kind: 'turn', turn: item, open, foldable: turnFoldable })
    const [first, ...rest] = item.records
    if (!open && first !== undefined) {
      lines.push({ kind: 'record', record: first, foldable: false, folded: false }, summarize('turn', item.key, rest))
      continue
    }
    for (const group of item.groups) {
      const shown = matches === null ? group.records : group.records.filter(record => matches.has(record.id))
      if (shown.length === 0) continue
      lines.push({ kind: 'group', turn: item, group })
      for (let position = 0; position < shown.length; position++) {
        const record = shown[position]
        if (record === undefined) continue
        const foldable = record.kind === 'assistant' && foldableIds.has(record.id)
        const folded = foldable && !searching && folds.calls.has(record.id)
        lines.push({ kind: 'record', record, foldable, folded })
        if (!folded) continue
        let end = position + 1
        while (end < shown.length && isCallOf(shown[end], record.id)) end++
        lines.push(summarize('calls', record.id, shown.slice(position + 1, end)))
        position = end - 1
      }
    }
  }
  return lines
}
