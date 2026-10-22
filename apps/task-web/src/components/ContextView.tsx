/** Context view of a Run's Session: what the model's context is made of now, how it grew request by request, what changed it,
 * which files the Agent touched and what each tool costs. The figures come from the `dsh-context` plugin on the Task host.
 */
import { useState, type ReactNode } from 'react'
import { IconGaugeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import {
  billedTokens, cacheHit, CONTEXT_PARTS, fileActivity, sharePercent, shrinkMarkers, toolRows, turnCount,
  type ContextInsight, type ContextParts, type ContextRequest, type ContextState,
} from '../support/context.ts'
import { compactCount, failureText, formatClock, formatSpan } from '../support/format.ts'
import { Card, CommandLine, EmptyState, KeyValue, Mono, Notice, SectionTitle, Spinner } from './ui.tsx'

/** Command that installs the plugin into the Task Profile. */
export const INSTALL_COMMAND = 'dsh plugin --profile task add dsh-context'
/** Bar height of the trend chart in pixels. */
const TREND_HEIGHT = 120
/** Rows shown before a table offers the rest. */
const TABLE_ROWS = 12

function Legend({ parts, total }: { parts: ContextParts; total: number }) {
  const t = useT()
  return (
    <ul className="tw-ctx-legend">
      {CONTEXT_PARTS.filter(part => parts[part] > 0).map(part => (
        <li key={part}>
          <span className="tw-ctx-swatch" data-part={part} />
          <span className="tw-ctx-legend-name">{t.run.context.parts[part]}</span>
          <Mono>{compactCount(parts[part])}</Mono>
          <span className="tw-muted-small">{sharePercent(parts[part], total)}%</span>
        </li>
      ))}
    </ul>
  )
}

function Overview({ insight }: { insight: ContextInsight }) {
  const t = useT()
  const copy = t.run.context
  const { timeline } = insight
  const billed = billedTokens(timeline.cost)
  const hit = billed === null ? null : cacheHit(billed)
  const window = timeline.contextWindow ?? null
  const shrinks = timeline.events.filter(event => event.kind === 'compaction' || event.kind === 'prune').length
  return (
    <Card label={copy.overview}>
      <SectionTitle title={copy.overview} right={timeline.model === undefined ? undefined : <Mono tone="muted">{timeline.model}</Mono>} />
      <div className="tw-ctx-grid">
        <KeyValue label={copy.occupancy}>
          {window === null ? compactCount(timeline.current.total)
            : `${compactCount(timeline.current.total)} / ${compactCount(window)} · ${sharePercent(timeline.current.total, window)}%`}
        </KeyValue>
        <KeyValue label={copy.requests}>{copy.turnsAndRequests(turnCount(timeline.requests), timeline.requests.length)}</KeyValue>
        <KeyValue label={copy.toolCalls}>{timeline.timing?.toolCalls ?? timeline.toolCalls ?? 0}</KeyValue>
        <KeyValue label={copy.humanInputs}>{timeline.humanInputs ?? 0}</KeyValue>
        <KeyValue label={copy.shrinks}>{shrinks}</KeyValue>
        {timeline.timing !== undefined && <KeyValue label={copy.activeTime}>{formatSpan(timeline.timing.wallMs)}</KeyValue>}
        {billed !== null && (
          <KeyValue label={copy.billedInput}>{compactCount(billed.uncached + billed.cacheRead + billed.cacheWrite)}</KeyValue>
        )}
        {billed !== null && <KeyValue label={copy.billedOutput}>{compactCount(billed.output)}</KeyValue>}
        {hit !== null && <KeyValue label={copy.cacheHit}>{hit}%</KeyValue>}
      </div>
    </Card>
  )
}

function CurrentContext({ insight }: { insight: ContextInsight }) {
  const t = useT()
  const copy = t.run.context
  const { current, contextWindow } = insight.timeline
  const scale = Math.max(contextWindow ?? current.total, current.total, 1)
  return (
    <Card label={copy.current}>
      <SectionTitle title={copy.current} count={contextWindow === undefined ? undefined : copy.ofWindow(compactCount(contextWindow))} />
      <div className="tw-ctx-bar" role="img" aria-label={copy.currentBar(compactCount(current.total))}>
        {CONTEXT_PARTS.filter(part => current[part] > 0).map(part => (
          <span key={part} className="tw-ctx-segment" data-part={part} style={{ width: `${(current[part] / scale) * 100}%` }} />
        ))}
      </div>
      <Legend parts={current} total={current.total} />
      <p className="tw-muted-small">{copy.estimateNote}</p>
    </Card>
  )
}

function requestLabel(request: ContextRequest, index: number): string {
  return request.turn === undefined ? `#${index + 1}` : `T${request.turn}·S${request.step ?? 1}`
}

function Trend({ insight }: { insight: ContextInsight }) {
  const t = useT()
  const copy = t.run.context
  const { requests, events } = insight.timeline
  const [picked, setPicked] = useState<number | null>(null)
  if (requests.length === 0) return null
  const max = Math.max(...requests.map(request => request.total), 1)
  const markers = shrinkMarkers(requests, events)
  const shown = picked === null ? undefined : { request: requests[picked] as ContextRequest, index: picked }
  return (
    <Card label={copy.trend}>
      <SectionTitle title={copy.trend} count={requests.length} />
      <div className="tw-ctx-trend-scroll">
        <div className="tw-ctx-trend" style={{ height: TREND_HEIGHT }}>
          {requests.map((request, index) => (
            <button key={request.seq} type="button" className="tw-ctx-column" aria-pressed={picked === index}
              aria-label={copy.requestBar(requestLabel(request, index), compactCount(request.total))}
              onClick={() => { setPicked(current => (current === index ? null : index)) }}>
              {markers.some(marker => marker.index === index) && <span className="tw-ctx-marker" title={copy.shrinkMarker} />}
              <span className="tw-ctx-stack" style={{ height: `${(request.total / max) * 100}%` }}>
                {CONTEXT_PARTS.filter(part => request[part] > 0).map(part => (
                  <span key={part} className="tw-ctx-segment" data-part={part} style={{ height: `${(request[part] / request.total) * 100}%` }} />
                ))}
              </span>
            </button>
          ))}
        </div>
      </div>
      {shown === undefined
        ? <p className="tw-muted-small">{copy.trendHint(compactCount(max))}</p>
        : (
          <div className="tw-stack-8">
            <div className="tw-row-between">
              <span>{requestLabel(shown.request, shown.index)} · <Mono>{formatClock(shown.request.time)}</Mono></span>
              <span className="tw-muted-small">
                {[shown.request.prompt === undefined ? null : copy.prompt(compactCount(shown.request.prompt)),
                  shown.request.cacheRead === undefined ? null : copy.cacheRead(compactCount(shown.request.cacheRead)),
                  shown.request.output === undefined ? null : copy.output(compactCount(shown.request.output))].filter(Boolean).join(' · ')}
              </span>
            </div>
            <Legend parts={shown.request} total={shown.request.total} />
          </div>
        )}
    </Card>
  )
}

/** Name of a context event kind; kinds a newer plugin adds keep their own name. */
function eventKind(kind: string, names: Readonly<Record<string, string>>): string {
  return Object.hasOwn(names, kind) ? names[kind] as string : kind
}

function Events({ insight }: { insight: ContextInsight }) {
  const t = useT()
  const copy = t.run.context
  const { events } = insight.timeline
  if (events.length === 0) return null
  return (
    <Card label={copy.events}>
      <SectionTitle title={copy.events} count={events.length} />
      <div className="tw-table-scroll">
        <table className="tw-table">
          <thead><tr><th>{copy.time}</th><th>{copy.kind}</th><th>{copy.detail}</th><th>{copy.tokens}</th></tr></thead>
          <tbody>
            {[...events].reverse().map(event => (
              <tr key={`${event.seq}:${event.kind}`}>
                <td><Mono>{formatClock(event.time)}</Mono></td>
                <td>{eventKind(event.kind, copy.eventKinds)}</td>
                <td className="tw-ctx-wrap">
                  {[event.name, event.form, event.from !== undefined && event.to !== undefined ? `${event.from} → ${event.to}` : undefined,
                    event.detail].filter(Boolean).join(' · ') || '—'}
                </td>
                <td><Mono>{event.tokens === undefined ? '—' : compactCount(event.tokens)}</Mono></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** Rows a folded table shows, and the heading control that shows the rest or folds them again. */
function useFold<Row>(rows: readonly Row[]): { readonly shown: readonly Row[]; readonly toggle: ReactNode } {
  const t = useT()
  const [all, setAll] = useState(false)
  if (rows.length <= TABLE_ROWS) return { shown: rows, toggle: undefined }
  return {
    shown: all ? rows : rows.slice(0, TABLE_ROWS),
    toggle: <button type="button" className="tw-text-button" onClick={() => { setAll(value => !value) }}>
      {all ? t.run.context.showLess : t.common.viewAll}</button>,
  }
}

function Files({ insight }: { insight: ContextInsight }) {
  const t = useT()
  const copy = t.run.context
  const rows = fileActivity(insight.timeline.fileOps ?? [])
  const fold = useFold(rows)
  if (rows.length === 0) return null
  return (
    <Card label={copy.files}>
      <SectionTitle title={copy.files} count={rows.length} right={fold.toggle} />
      <div className="tw-table-scroll">
        <table className="tw-table">
          <thead>
            <tr><th>{copy.file}</th><th>{copy.reads}</th><th>{copy.writes}</th><th>{copy.searches}</th><th>{copy.lines}</th></tr>
          </thead>
          <tbody>
            {fold.shown.map(row => (
              <tr key={`${row.pattern}:${row.path}`}>
                <td className="tw-ctx-wrap"><Mono>{row.pattern ? copy.pattern(row.path) : row.path}</Mono>
                  {row.errors > 0 && <span className="tw-ctx-error"> {copy.errors(row.errors)}</span>}</td>
                <td>{row.reads || '—'}</td>
                <td>{row.writes || '—'}</td>
                <td>{row.searches || '—'}</td>
                <td><Mono>{row.added === 0 && row.removed === 0 ? '—' : `+${row.added} −${row.removed}`}</Mono></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {insight.timeline.fileOpsFloor !== undefined && <p className="tw-muted-small">{copy.filesTrimmed}</p>}
    </Card>
  )
}

function Tools({ insight }: { insight: ContextInsight }) {
  const t = useT()
  const copy = t.run.context
  const rows = toolRows(insight)
  const fold = useFold(rows)
  if (rows.length === 0) return null
  return (
    <Card label={copy.tools}>
      <SectionTitle title={copy.tools} count={rows.length} right={fold.toggle} />
      <div className="tw-table-scroll">
        <table className="tw-table">
          <thead>
            <tr><th>{copy.tool}</th><th>{copy.source}</th><th>{copy.schemaTokens}</th><th>{copy.calls}</th><th>{copy.runTime}</th></tr>
          </thead>
          <tbody>
            {fold.shown.map(row => (
              <tr key={row.name}>
                <td><Mono>{row.name}</Mono></td>
                <td className="tw-ctx-wrap tw-muted-small">{row.plugin === undefined || row.plugin === '<unknown-plugin>' ? '—' : row.plugin}</td>
                <td><Mono>{row.tokens === null ? '—' : compactCount(row.tokens)}</Mono></td>
                <td>{row.calls || '—'}</td>
                <td><Mono>{row.calls === 0 ? '—' : formatSpan(row.ms)}</Mono></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** Context view.
 * @param props.state - insight state from `useRunContext`.
 * @returns cards, or the state that keeps them from showing.
 */
export function ContextView({ state }: { state: ContextState }) {
  const t = useT()
  const copy = t.run.context
  if (state.status === 'loading') return <div className="tw-log-loading"><Spinner /> {copy.loading}</div>
  if (state.status === 'unavailable') {
    return (
      <EmptyState icon={<IconGaugeOutlineRegular size={20} />} title={copy.unavailableTitle}
        action={<CommandLine command={INSTALL_COMMAND} />}>{copy.unavailableBody}</EmptyState>
    )
  }
  if (state.status === 'pending') return <EmptyState icon={<IconGaugeOutlineRegular size={20} />} title={copy.pendingTitle}>{copy.pendingBody}</EmptyState>
  if (state.status === 'incompatible') return <Notice kind="warning" title={copy.incompatibleTitle}>{copy.incompatibleBody}</Notice>
  if (state.status === 'failed') return <Notice kind="error" title={copy.failed}>{failureText(state.failure, t)}</Notice>
  const { insight } = state
  if (insight.timeline.unsupported !== undefined) {
    return <Notice kind="warning" title={copy.unsupportedTitle}>
      {copy.unsupportedBody(insight.timeline.unsupported.current, insight.timeline.unsupported.minimum)}</Notice>
  }
  if (insight.timeline.requests.length === 0 && insight.timeline.current.total === 0)
    return <EmptyState icon={<IconGaugeOutlineRegular size={20} />} title={copy.emptyTitle}>{copy.emptyBody}</EmptyState>
  return (
    <div className="tw-stack-16 tw-ctx">
      <Overview insight={insight} />
      <CurrentContext insight={insight} />
      <Trend insight={insight} />
      <Events insight={insight} />
      <Files insight={insight} />
      <Tools insight={insight} />
      <p className="tw-muted-small">{copy.attribution}</p>
    </div>
  )
}
