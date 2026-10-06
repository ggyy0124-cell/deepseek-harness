/** Trajectory of a Run: toolbar, timeline and a ledger of turns, steps, requests and tool calls. */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconFlatListOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useT, type Messages } from '../i18n/index.ts'
import { setRecordedDuration, useRecordedDuration } from '../support/axis.ts'
import { compactCount, elapsed, formatSpan } from '../support/format.ts'
import { buildLines, foldableCalls, foldableTurns, type Folds, type Line } from '../support/ledger.ts'
import { buildOverview, focusedIds, type AxisRange } from '../support/overview.ts'
import { findSubject, inputText, requestId, usageTitle } from '../support/presentation.ts'
import { blockText } from '../support/timeline.ts'
import { durationOf, firstLine, matchesRecord, promptTokens, type Trajectory, type TrajectoryRecord } from '../support/trajectory.ts'
import type { Run } from '../support/types.ts'
import { KindTag } from './KindTag.tsx'
import { argumentSummary } from './Transcript.tsx'
import { TrajectoryTimeline } from './TrajectoryTimeline.tsx'
import { TrajectoryToolbar } from './TrajectoryToolbar.tsx'
import { EmptyState, Spinner } from './ui.tsx'

const NONE: ReadonlySet<string> = new Set()
const NO_FOLDS: Folds = { turns: NONE, calls: NONE }

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  return set.has(key) ? new Set([...set].filter(item => item !== key)) : new Set([...set, key])
}

function without(set: ReadonlySet<string>, key: string | undefined): ReadonlySet<string> {
  return key === undefined || !set.has(key) ? set : new Set([...set].filter(item => item !== key))
}

/** Everything one ledger row shows besides its number and kind. */
interface RowView {
  /** Tool name, shown in bold before the content. */
  readonly tool: string | undefined
  readonly content: string
  /** First line of a tool's result, shown after an arrow. */
  readonly result: string | undefined
  readonly input: string
  readonly output: string
  readonly think: string
  readonly time: string
  readonly title: string | undefined
}

function rowView(record: TrajectoryRecord, t: Messages): RowView {
  const copy = t.run.trajectory
  const length = durationOf(record)
  const base = { tool: undefined, result: undefined, input: '', output: '', think: '', time: length === null ? '' : formatSpan(length), title: undefined }
  switch (record.kind) {
    case 'user':
    case 'context': return { ...base, content: firstLine(blockText(record.entry, 'text')) || copy.noContent }
    case 'input': return { ...base, content: inputText(record, t) }
    case 'assistant': {
      const text = firstLine(blockText(record.entry, 'text'))
      const thinking = record.entry.blocks.some(block => block.kind === 'reasoning')
      const { usage } = record
      return {
        ...base,
        content: text !== '' ? text : record.calls.length > 0 ? copy.toolCallOnly : thinking ? copy.thinkingOnly : copy.noContent,
        input: usage === undefined ? '' : compactCount(promptTokens(usage)),
        output: usage?.output === undefined ? '' : compactCount(usage.output),
        think: usage?.reasoning === undefined ? '' : compactCount(usage.reasoning),
        title: usage === undefined ? undefined : usageTitle(usage, t),
      }
    }
    case 'tool': {
      const result = record.result === undefined ? undefined : firstLine(blockText(record.result, 'text'))
      return {
        ...base,
        tool: record.call?.name ?? '—',
        content: record.call === undefined ? '' : argumentSummary(record.call.arguments),
        result: result === '' ? copy.detail.noOutput : result,
      }
    }
  }
}

function RecordRow({ record, selected, tabbable, dimmed, live, foldable, folded, onSelect, onFold }: {
  record: TrajectoryRecord
  selected: boolean
  tabbable: boolean
  /** The timeline selection leaves this record out. */
  dimmed: boolean
  live: boolean
  foldable: boolean
  folded: boolean
  onSelect: (id: string) => void
  onFold: (id: string) => void
}) {
  const t = useT()
  const copy = t.run.trajectory
  const view = rowView(record, t)
  const pending = record.kind === 'tool' && record.result === undefined
  const failed = record.kind === 'tool' && record.failed
  return (
    <div role="row" data-traj-row="" data-record-id={record.id} tabIndex={tabbable ? 0 : -1} aria-selected={selected} className="tw-traj-row"
      data-kind={record.kind} data-selected={selected || undefined} data-failed={failed || undefined} data-dim={dimmed || undefined}
      onClick={() => { onSelect(record.id) }}
      onDoubleClick={foldable ? () => { onFold(record.id) } : undefined}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onSelect(record.id)
      }}>
      <span role="gridcell" className="tw-traj-cell tw-traj-index">{record.index}</span>
      <span role="gridcell" className="tw-traj-cell"><KindTag record={record} /></span>
      <span role="gridcell" className="tw-traj-cell tw-traj-content">
        {foldable && (
          <button type="button" className="tw-traj-fold" aria-expanded={!folded}
            aria-label={folded ? copy.callsOf.expand : copy.callsOf.collapse}
            onClick={(event) => { event.stopPropagation(); onFold(record.id) }}>
            {folded ? <IconChevronRightOutlineRegular size={12} /> : <IconChevronDownOutlineRegular size={12} />}
          </button>
        )}
        {view.tool !== undefined && <span className="tw-traj-tool">{view.tool}</span>}
        <span className="tw-traj-text">{view.content}</span>
        {view.result !== undefined && <span className="tw-traj-result"><span aria-hidden="true">→</span> {view.result}</span>}
        {pending && live && <span className="tw-traj-running"><Spinner /><span>{copy.running}</span></span>}
        {pending && !live && <span className="tw-traj-result">{copy.status.interrupted}</span>}
      </span>
      <span role="gridcell" className="tw-traj-cell tw-traj-num tw-traj-in" title={view.title}>{view.input}</span>
      <span role="gridcell" className="tw-traj-cell tw-traj-num tw-traj-out" title={view.title}>{view.output}</span>
      <span role="gridcell" className="tw-traj-cell tw-traj-num tw-traj-think" title={view.title}>{view.think}</span>
      <span role="gridcell" className="tw-traj-cell tw-traj-num tw-traj-time">{view.time}</span>
    </div>
  )
}

function TurnRow({ line, onToggle }: { line: Extract<Line, { kind: 'turn' }>; onToggle: (key: string) => void }) {
  const t = useT()
  const copy = t.run.trajectory
  const { turn, open, foldable } = line
  const parts = [
    turn.steps > 0 ? copy.summary.steps(turn.steps) : undefined,
    turn.toolCalls > 0 ? copy.summary.toolCalls(turn.toolCalls) : undefined,
    turn.failed > 0 ? `${turn.failed} ${copy.status.failed}` : undefined,
  ].filter(part => part !== undefined)
  const title = <span className="tw-traj-turn-title">{copy.turn(turn.turn)}</span>
  return (
    <div role="row" className="tw-traj-turn" data-open={open}>
      <div role="columnheader" aria-colspan={3} className="tw-traj-turn-main">
        {foldable ? (
          <button type="button" className="tw-traj-turn-button" aria-expanded={open} onClick={() => { onToggle(turn.key) }}>
            {open ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronRightOutlineRegular size={12} />}
            {title}
          </button>
        ) : title}
        <span className="tw-muted-small tw-traj-turn-summary">{parts.join(' · ')}</span>
      </div>
      <span role="columnheader" className="tw-traj-num tw-traj-label tw-traj-in">{copy.columns.input}</span>
      <span role="columnheader" className="tw-traj-num tw-traj-label tw-traj-out">{copy.columns.output}</span>
      <span role="columnheader" className="tw-traj-num tw-traj-label tw-traj-think">{copy.columns.think}</span>
      <span role="columnheader" className="tw-traj-num tw-traj-label tw-traj-time">{copy.columns.time}</span>
    </div>
  )
}

function GroupRow({ line, selectedId, onRequest }: {
  line: Extract<Line, { kind: 'group' }>
  selectedId: string | null
  onRequest: (id: string) => void
}) {
  const t = useT()
  const copy = t.run.trajectory
  const { group } = line
  const request = group.records.find(record => record.kind === 'assistant')?.request
  return (
    <div role="row" className="tw-traj-group">
      <span role="rowheader" className="tw-traj-group-title">{group.step === null ? copy.group.message : copy.group.step(group.step)}</span>
      {group.spanMs !== null && <span className="tw-muted-small">{formatSpan(group.spanMs)}</span>}
      {request !== undefined && (
        <button type="button" className="tw-traj-request" aria-pressed={selectedId === requestId(request)} onClick={() => { onRequest(requestId(request)) }}>
          {copy.request(request)}
        </button>
      )}
    </div>
  )
}

function SummaryRow({ line, onExpand }: { line: Extract<Line, { kind: 'summary' }>; onExpand: (scope: 'turn' | 'calls', id: string) => void }) {
  const t = useT()
  const copy = t.run.trajectory.summary
  const text = line.scope === 'turn'
    ? [line.steps > 0 ? copy.steps(line.steps) : undefined, line.calls > 0 ? copy.toolCalls(line.calls) : undefined]
      .filter(part => part !== undefined).join(' · ')
    : [copy.toolCalls(line.calls), line.names.join(', ')].filter(part => part !== '').join(' · ')
  return (
    <div role="row" className="tw-traj-summary">
      <button type="button" className="tw-traj-summary-button" aria-expanded={false} title={text} onClick={() => { onExpand(line.scope, line.id) }}>
        <span aria-hidden="true">…</span>
        <span className="tw-traj-summary-text">{text}</span>
      </button>
    </div>
  )
}

/** Table of a Run's turns, requests and tool calls with its toolbar and timeline.
 * @param props.run - execution, for the live indicator.
 * @param props.trajectory - records of the Run.
 * @param props.working - the Agent is working; the table ends with its activity line.
 * @param props.selectedId - record or request shown in the sidebar.
 * @param props.onSelect - record or request chosen by click, Enter or Space.
 * @returns toolbar, timeline and ledger.
 */
export function TrajectoryView({ run, trajectory, working, selectedId, onSelect }: {
  run: Pick<Run, 'createdAt' | 'terminalAt'>
  trajectory: Trajectory
  working: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const t = useT()
  const copy = t.run.trajectory
  const recorded = useRecordedDuration()
  const [query, setQuery] = useState('')
  const [folds, setFolds] = useState<Folds>(NO_FOLDS)
  const [focus, setFocus] = useState<{ readonly recorded: boolean; readonly range: AxisRange } | null>(null)
  const [reveal, setReveal] = useState<string | null>(null)
  const grid = useRef<HTMLDivElement | null>(null)
  const needle = useDeferredValue(query).trim().toLowerCase()
  const matches = useMemo(() => (needle === '' ? null
    : new Set(trajectory.records.filter(record => matchesRecord(record, needle)).map(record => record.id))), [trajectory, needle])
  const overview = useMemo(() => buildOverview(trajectory, recorded ? 'duration' : 'sequence'), [trajectory, recorded])
  const records = useMemo(() => new Map(trajectory.records.map(record => [record.id, record])), [trajectory])
  const range = focus !== null && focus.recorded === recorded && overview !== null && focus.range.start <= overview.end
    && focus.range.end >= overview.start ? focus.range : null
  const inside = useMemo(() => (overview === null || range === null ? null : focusedIds(overview, range)), [overview, range])
  const lines = useMemo(() => buildLines(trajectory, matches, folds), [trajectory, matches, folds])
  const currentId = useMemo(
    () => (selectedId === null ? null : findSubject(trajectory, selectedId)?.record.id ?? null), [trajectory, selectedId])
  const turnKeys = useMemo(() => foldableTurns(trajectory), [trajectory])
  const callIds = useMemo(() => foldableCalls(trajectory), [trajectory])
  const turnsFolded = turnKeys.length > 0 && turnKeys.every(key => folds.turns.has(key))
  const callsFolded = callIds.length > 0 && callIds.every(id => folds.calls.has(id))
  const live = run.terminalAt === null
  const rowIds = lines.flatMap(line => (line.kind === 'record' || line.kind === 'input' ? [line.record.id] : []))
  const tabbableId = selectedId !== null && rowIds.includes(selectedId) ? selectedId : rowIds[0]
  const onRange = useCallback((next: AxisRange | null) => { setFocus(next === null ? null : { recorded, range: next }) }, [recorded])
  const showRecord = useCallback((id: string) => {
    const turn = trajectory.items.find(item => item.kind === 'turn' && item.records.some(record => record.id === id))
    const record = records.get(id)
    const parent = record?.kind === 'tool' ? record.parent : undefined
    setFolds((current) => {
      const turns = without(current.turns, turn?.kind === 'turn' ? turn.key : undefined)
      const calls = without(current.calls, parent)
      return turns === current.turns && calls === current.calls ? current : { turns, calls }
    })
    setReveal(id)
  }, [trajectory, records])
  const selectFromTimeline = useCallback((id: string) => { onSelect(id); showRecord(id) }, [onSelect, showRecord])
  useEffect(() => {
    if (reveal === null) return
    const row = [...(grid.current?.querySelectorAll<HTMLElement>('[data-record-id]') ?? [])].find(element => element.dataset['recordId'] === reveal)
    row?.scrollIntoView({ block: 'nearest' })
    setReveal(null)
  }, [reveal, lines])
  const expand = (scope: 'turn' | 'calls', id: string) => {
    setFolds(current => (scope === 'turn' ? { ...current, turns: without(current.turns, id) } : { ...current, calls: without(current.calls, id) }))
  }
  // Rows are one tab stop: arrow keys move between them, so a long table does not trap keyboard users.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute('data-traj-row')) return
    const rows = [...(grid.current?.querySelectorAll<HTMLElement>('[data-traj-row]') ?? [])]
    const current = rows.indexOf(event.target)
    const target = event.key === 'ArrowDown' ? current + 1 : event.key === 'ArrowUp' ? current - 1 : event.key === 'Home' ? 0
      : event.key === 'End' ? rows.length - 1 : undefined
    const row = target === undefined ? undefined : rows[target]
    if (row === undefined) return
    event.preventDefault()
    row.focus()
  }
  if (trajectory.records.length === 0 && !working) {
    return <EmptyState icon={<IconFlatListOutlineRegular size={20} />} title={copy.empty}>{copy.emptyBody}</EmptyState>
  }
  const renderLine = (line: Line) => {
    switch (line.kind) {
      case 'input':
      case 'record': return (
        <RecordRow key={line.record.id} record={line.record} selected={line.record.id === selectedId}
          tabbable={line.record.id === tabbableId} dimmed={inside !== null && !inside.has(line.record.id)} live={live}
          foldable={line.kind === 'record' && line.foldable}
          folded={line.kind === 'record' && line.folded} onSelect={onSelect}
          onFold={(id) => { setFolds(current => ({ ...current, calls: toggled(current.calls, id) })) }} />
      )
      case 'turn': return (
        <TurnRow key={`turn:${line.turn.key}`} line={line} onToggle={(key) => { setFolds(current => ({ ...current, turns: toggled(current.turns, key) })) }} />
      )
      case 'group': return (
        <GroupRow key={`group:${line.turn.key}/${line.group.id}`} line={line} selectedId={selectedId} onRequest={onSelect} />
      )
      case 'summary': return <SummaryRow key={`summary:${line.scope}:${line.id}`} line={line} onExpand={expand} />
    }
  }
  const toggleTurns = () => { setFolds(current => ({ ...current, turns: turnsFolded ? NONE : new Set(turnKeys) })) }
  const toggleCalls = () => { setFolds(current => ({ ...current, calls: callsFolded ? NONE : new Set(callIds) })) }
  return (
    <section className="tw-traj" aria-label={t.run.views.trajectory}>
      <div className="tw-traj-head">
        <TrajectoryToolbar recorded={recorded} onRecorded={setRecordedDuration} query={query} onQuery={setQuery}
          turns={{ folded: turnsFolded, onToggle: toggleTurns }} calls={{ folded: callsFolded, onToggle: toggleCalls }} />
        <TrajectoryTimeline overview={overview} records={records} currentId={currentId} range={range} matches={matches} onRange={onRange}
          onSelect={selectFromTimeline} onReveal={showRecord} />
      </div>
      <div role="grid" aria-label={t.run.views.trajectory} className="tw-traj-grid" ref={grid} onKeyDown={onKeyDown}>
        {lines.map(renderLine)}
      </div>
      {matches !== null && lines.length === 0 && <p className="tw-muted-line tw-center">{copy.noMatch}</p>}
      {working && <div className="tw-working"><Spinner tone="deep" /><span>{t.run.working(elapsed(run.createdAt, t))}</span></div>}
    </section>
  )
}
