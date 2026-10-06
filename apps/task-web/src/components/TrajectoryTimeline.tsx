/** Overview strip above the trajectory: every record on input, model and tool lanes, with drag-to-focus. */
import { memo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT, type Messages } from '../i18n/index.ts'
import { formatClock, formatMillis } from '../support/format.ts'
import { LANES, type AxisRange, type Overview, type OverviewSpan } from '../support/overview.ts'
import { kindLabel, tokenTimings } from '../support/presentation.ts'
import { durationOf, type TrajectoryRecord } from '../support/trajectory.ts'

/** Pointer travel in px below which a press and release count as a click. */
const CLICK_PX = 3
const TOOLTIP_DELAY_MS = 500

const clamp = (fraction: number): number => Math.min(1, Math.max(0, fraction))
const ordered = (first: number, second: number): AxisRange => (
  first <= second ? { start: first, end: second } : { start: second, end: first }
)

/** Interval of `width` around `center`, moved inside the axis when it would stick out. */
function centered(center: number, width: number, axis: AxisRange): AxisRange {
  const start = Math.min(Math.max(center - width / 2, axis.start), Math.max(axis.start, axis.end - width))
  return { start, end: Math.min(axis.end, start + width) }
}

/** Record whose span is nearest to a point of the axis. */
function nearest(spans: readonly OverviewSpan[], point: number): OverviewSpan | undefined {
  const distance = (span: OverviewSpan) => (point < span.start ? span.start - point : point > span.end ? point - span.end : 0)
  return spans.reduce<OverviewSpan | undefined>(
    (best, span) => (best === undefined || distance(span) < distance(best) ? span : best), undefined)
}

/** Tooltip text of one record: kind, start and end time, length and, for model requests, the split at the first token. */
function describe(record: TrajectoryRecord, t: Messages): string {
  const copy = t.run.trajectory.timeline
  const length = durationOf(record)
  const clock = record.startedAt === null ? null
    : record.endedAt === null ? copy.started(formatClock(record.startedAt)) : `${formatClock(record.startedAt)} → ${formatClock(record.endedAt)}`
  const split = record.kind === 'assistant' ? tokenTimings(record) : undefined
  const timing = [
    length === null ? null : copy.total(formatMillis(length, t)),
    split === undefined ? null : copy.ttftDecoding(formatMillis(split.ttftMs, t), formatMillis(split.decodingMs, t)),
  ].filter(part => part !== null).join(' · ')
  return [kindLabel(record, t), clock, timing].filter(line => line !== null && line !== '').join('\n')
}

/** Selected interval as fractions of the axis.
 * @param range - interval on the axis.
 * @param axis - whole axis.
 */
function fractions(range: AxisRange, axis: AxisRange): AxisRange {
  const length = Math.max(1, axis.end - axis.start)
  return { start: clamp((range.start - axis.start) / length), end: clamp((range.end - axis.start) / length) }
}

/** Pointer press that has not been released yet. */
interface Press {
  readonly pointerId: number
  readonly anchor: number
  readonly clientX: number
  readonly id: string | null
}

/** Timeline of a Run.
 * @param props.overview - records on the axis; null when no record can be placed.
 * @param props.records - records by id, for tooltips.
 * @param props.currentId - record shown in the sidebar.
 * @param props.range - interval that focuses the ledger.
 * @param props.matches - ids of the records that match the search; null without a search.
 * @param props.onRange - interval chosen or cleared by dragging, Escape or double-click.
 * @param props.onSelect - record chosen by clicking its block.
 * @param props.onReveal - record the ledger should scroll to after the axis was clicked between blocks.
 * @returns the three lanes with their blocks, turn boundaries and selection.
 */
export const TrajectoryTimeline = memo(function TrajectoryTimeline({
  overview, records, currentId, range, matches, onRange, onSelect, onReveal,
}: {
  overview: Overview | null
  records: ReadonlyMap<string, TrajectoryRecord>
  currentId: string | null
  range: AxisRange | null
  matches: ReadonlySet<string> | null
  onRange: (range: AxisRange | null) => void
  onSelect: (id: string) => void
  onReveal: (id: string) => void
}) {
  const t = useT()
  const copy = t.run.trajectory.timeline
  const press = useRef<Press | null>(null)
  const [draft, setDraft] = useState<AxisRange | null>(null)
  const [hover, setHover] = useState<{ readonly fraction: number; readonly id: string | null } | null>(null)
  const labels = (
    <div className="tw-tl-labels" aria-hidden="true">
      {LANES.map(lane => <span key={lane}>{copy.lanes[lane]}</span>)}
    </div>
  )
  if (overview === null) {
    return (
      <section className="tw-tl" aria-label={copy.label}>
        <div className="tw-tl-plot">{labels}<div className="tw-tl-track"><span className="tw-tl-empty">{copy.noTiming}</span></div></div>
      </section>
    )
  }
  const length = Math.max(1, overview.end - overview.start)
  const fractionAt = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return clamp((event.clientX - box.left) / Math.max(1, box.width))
  }
  const idAt = (event: PointerEvent<HTMLElement>) => (event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>('[data-timeline-id]')?.dataset['timelineId'] ?? null : null)
  const shown = draft ?? range
  const selection = shown === null ? null : fractions(shown, overview)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const fraction = fractionAt(event)
    const anchor = overview.start + fraction * length
    const id = idAt(event)
    press.current = { pointerId: event.pointerId, anchor, clientX: event.clientX, id }
    setHover({ fraction, id })
    if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
    setDraft({ start: anchor, end: anchor })
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const fraction = fractionAt(event)
    setHover({ fraction, id: idAt(event) })
    const current = press.current
    if (current !== null && current.pointerId === event.pointerId) setDraft(ordered(current.anchor, overview.start + fraction * length))
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = press.current
    if (current === null || current.pointerId !== event.pointerId) return
    press.current = null
    setDraft(null)
    const selected = ordered(current.anchor, overview.start + fractionAt(event) * length)
    const click = Math.abs(event.clientX - current.clientX) < CLICK_PX
    if (click && current.id !== null) {
      onRange(null)
      onSelect(current.id)
      return
    }
    const minimum = length / overview.spans.length
    const center = click ? selected.start : (selected.start + selected.end) / 2
    onRange(selected.end - selected.start < minimum ? centered(center, minimum, overview) : selected)
    const target = click ? nearest(overview.spans, selected.start) : undefined
    if (target !== undefined) onReveal(target.id)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || range === null) return
    event.preventDefault()
    onRange(null)
  }
  return (
    <section className="tw-tl" aria-label={copy.label}>
      <div className="tw-tl-plot">
        {labels}
        <div className="tw-tl-track" tabIndex={0} aria-label={copy.overview} onKeyDown={onKeyDown} onPointerDown={onPointerDown}
          onPointerMove={onPointerMove} onPointerUp={onPointerUp} onContextMenu={(event) => { event.preventDefault() }}
          onPointerCancel={() => { press.current = null; setDraft(null); setHover(null) }}
          onPointerLeave={() => { if (press.current === null) setHover(null) }}
          onDoubleClick={(event) => { event.preventDefault(); onRange(null) }}>
          {hover !== null && hover.id === null && draft === null && (
            <div className="tw-tl-hover" aria-hidden="true" style={{ '--tw-tl-at': `${hover.fraction * 100}%` } as CSSProperties} />
          )}
          {selection !== null && (
            <>
              <div className="tw-tl-selection" data-dragging={draft === null ? undefined : 'true'} aria-hidden="true"
                style={{ '--tw-tl-from': `${selection.start * 100}%`, '--tw-tl-size': `${(selection.end - selection.start) * 100}%` } as CSSProperties} />
              <div className="tw-tl-edges" data-dragging={draft === null ? undefined : 'true'} aria-hidden="true"
                style={{ '--tw-tl-from': `${selection.start * 100}%`, '--tw-tl-size': `${(selection.end - selection.start) * 100}%` } as CSSProperties} />
            </>
          )}
          <div className="tw-tl-boundaries" aria-hidden="true">
            {overview.boundaries.filter(boundary => boundary.at > overview.start).map(boundary => (
              <span key={boundary.turn} className="tw-tl-boundary" style={{ '--tw-tl-at': `${(boundary.at - overview.start) / length * 100}%` } as CSSProperties} />
            ))}
          </div>
          <div className="tw-tl-lanes">
            {overview.spans.map((span) => {
              const record = records.get(span.id)
              const size = (span.end - span.start) / length * 100
              const split = record?.kind === 'assistant' ? tokenTimings(record) : undefined
              const generated = split === undefined ? 0 : split.ttftMs + split.decodingMs
              const ttft = split === undefined || generated <= 0 ? null : split.ttftMs / generated
              return (
                <Tooltip key={span.id} label={() => (record === undefined ? '' : describe(record, t))} side="bottom" delayMs={TOOLTIP_DELAY_MS} portal>
                  <span aria-hidden="true" className="tw-tl-span" data-timeline-id={span.id} data-kind={span.kind}
                    data-split={ttft === null ? undefined : 'true'} data-failed={span.failed || undefined}
                    data-current={span.id === currentId || undefined} data-hovered={hover?.id === span.id || undefined}
                    data-match={matches === null ? undefined : String(matches.has(span.id))}
                    data-inside={shown === null ? undefined : String(span.start <= shown.end && span.end >= shown.start)}
                    style={{
                      '--tw-tl-from': `${(span.start - overview.start) / length * 100}%`,
                      '--tw-tl-size': `${size}%`,
                      '--tw-tl-gap': `min(${size * 0.08}%, 1px)`,
                      '--tw-tl-lane': LANES.indexOf(span.lane),
                      ...ttft === null ? {} : { '--tw-tl-ttft': `${ttft * 100}%` },
                    } as CSSProperties} />
                </Tooltip>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
})
