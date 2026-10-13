/** Footer under the Session: loop counts and speed, token usage and cache hits, and context occupancy. Each reading opens its
 * details in a panel above it, or in a bottom sheet on a phone. */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  IconDatabaseOutlineRegular, IconGaugeOutlineRegular, Modal, useAnchoredPosition, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { PHONE_QUERY } from '../app/MobileBar.tsx'
import { useT } from '../i18n/index.ts'
import { compactCount, formatSpan } from '../support/format.ts'
import {
  barSegments, cacheHitPercent, COMPOSITION_PARTS, formatRate, occupancy, promptTotal, tokensPerSecond,
  type CompositionFigures, type Occupancy, type SessionFigures, type UsageFigures,
} from '../support/stats.ts'
import type { RunStats } from '../support/types.ts'

type Panel = 'session' | 'usage' | 'context'

/** Unplaced panel: laid out but hidden, so the placement can measure it. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }
/** Ring geometry: 14 px view box, 2 px stroke. */
const RING_RADIUS = 5.5
const RING_LENGTH = 2 * Math.PI * RING_RADIUS
const PART_LABEL = { systemTokens: 'system', toolsTokens: 'tools', messageTokens: 'messages' } as const

function subscribePhone(listener: () => void): () => void {
  const media = window.matchMedia(PHONE_QUERY)
  media.addEventListener('change', listener)
  return () => { media.removeEventListener('change', listener) }
}

/** Whether the phone layout applies. */
function usePhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches)
}

interface ReadingProps {
  readonly icon: ReactNode
  readonly label: ReactNode
  /** Accessible name of the button that opens the details. */
  readonly name: string
  /** Heading of the details; the details are absent when no `children` are given. */
  readonly title: string
  /** Figure shown at the end of the heading. */
  readonly headline?: ReactNode
  readonly children?: ReactNode
  readonly open: boolean
  readonly onOpen: (open: boolean) => void
  readonly phone: boolean
}

/** One reading of the footer and its details. */
function Reading({ icon, label, name, title, headline, children, open, onOpen, phone }: ReadingProps) {
  const t = useT()
  const anchor = useRef<HTMLSpanElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const floating = open && !phone
  const position = useAnchoredPosition({ open: floating, anchorRef: anchor, panelRef: panel, side: 'top', gap: 8, margin: 12 })
  useDismissOnOutsidePointer(anchor, floating, onOpen, panel)
  useEffect(() => {
    if (!floating) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [floating, onOpen])
  if (children === undefined) {
    return <span className="tw-stat-anchor"><span className="tw-stat">{icon}{label}</span></span>
  }
  return (
    <span ref={anchor} className="tw-stat-anchor">
      <button type="button" className="tw-stat" aria-haspopup="dialog" aria-expanded={open} aria-label={name}
        onClick={() => { onOpen(!open) }}>
        {icon}{label}
      </button>
      {floating && createPortal(
        <div ref={panel} className="tw-stat-panel" role="dialog" aria-label={title} style={position ?? MEASURE_STYLE}>
          <div className="tw-stat-panel-title">
            <span className="tw-stat-panel-name">{icon}{title}</span>
            {headline !== undefined && <span className="tw-stat-panel-value">{headline}</span>}
          </div>
          {children}
        </div>,
        document.body,
      )}
      {open && phone && (
        <Modal open title={title} closeLabel={t.common.close} backdropBlur={false} onClose={() => { onOpen(false) }}
          className="tw-dialog-medium tw-stat-sheet">
          {headline !== undefined && <div className="tw-stat-sheet-value">{headline}</div>}
          {children}
        </Modal>
      )}
    </span>
  )
}

function Ring({ percent }: { percent: number }) {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <circle className="tw-stat-ring-track" cx="7" cy="7" r={RING_RADIUS} />
      <circle className="tw-stat-ring-fill" cx="7" cy="7" r={RING_RADIUS} strokeDasharray={`${(RING_LENGTH * percent) / 100} ${RING_LENGTH}`}
        transform="rotate(-90 7 7)" />
    </svg>
  )
}

function SessionDetails({ session }: { session: SessionFigures }) {
  const t = useT()
  const copy = t.run.stats
  const rate = tokensPerSecond(session)
  return (
    <dl className="tw-stat-rows">
      {session.llmMs > 0 && <><dt>{copy.llmTime}</dt><dd>{formatSpan(session.llmMs)}</dd></>}
      {session.toolMs > 0 && <><dt>{copy.toolTime}</dt><dd>{formatSpan(session.toolMs)}</dd></>}
      {session.ttftSteps > 0 && <><dt>{copy.ttft}</dt><dd>{formatSpan(session.ttftMs / session.ttftSteps)}</dd></>}
      {rate !== null && <><dt>{copy.speed}</dt><dd>{t.run.trajectory.unit.tokensPerSecond(formatRate(rate))}</dd></>}
    </dl>
  )
}

function UsageDetails({ usage }: { usage: UsageFigures }) {
  const t = useT()
  const copy = t.run.stats
  const exact = (value: number) => t.run.trajectory.unit.tokens(value.toLocaleString())
  const hit = cacheHitPercent(usage)
  return (
    <dl className="tw-stat-rows">
      {hit !== null && <><dt>{copy.cacheHitRow}</dt><dd>{`${hit}%`}</dd></>}
      <dt>{copy.uncachedInput}</dt><dd>{exact(usage.uncachedInputTokens)}</dd>
      <dt>{copy.cacheRead}</dt><dd>{exact(usage.cacheReadTokens)}</dd>
      {usage.cacheWriteTokens !== 0 && <><dt>{copy.cacheWrite}</dt><dd>{exact(usage.cacheWriteTokens)}</dd></>}
      <dt>{copy.output}</dt><dd>{exact(usage.outputTokens)}</dd>
    </dl>
  )
}

function ContextDetails({ context, composition }: { context: Occupancy; composition: CompositionFigures | null }) {
  const t = useT()
  const copy = t.run.stats
  return (
    <>
      <div className="tw-stat-context-head">
        {copy.contextBefore !== '' && <span className="tw-stat-muted">{copy.contextBefore}</span>}
        <span className="tw-stat-strong">{`${context.percent}%`}</span>
        {copy.contextAfter !== '' && <span className="tw-stat-muted">{copy.contextAfter}</span>}
        <span className="tw-stat-context-figures">{`~${compactCount(context.used)} / ${compactCount(context.window)}`}</span>
      </div>
      <div className="tw-stat-bar">
        {barSegments(context.percent, composition).map(segment => (
          <div key={segment.key} className="tw-stat-segment" data-part={segment.key} style={{ width: `${segment.width}%` }} />
        ))}
      </div>
      {composition !== null && (
        <>
          <dl className="tw-stat-parts">
            {COMPOSITION_PARTS.map(key => (
              <div key={key} className="tw-stat-part">
                <dt><span className="tw-stat-swatch" data-part={key} aria-hidden />{copy[PART_LABEL[key]]}</dt>
                <dd>{`~${compactCount(composition[key])}`}</dd>
              </div>
            ))}
          </dl>
          <p className="tw-stat-note">{copy.compositionNote}</p>
        </>
      )}
    </>
  )
}

/** Session statistics of a Run.
 * @param props.stats - latest statistics; nothing renders before the first read.
 * @returns the footer, or null while the Session has no step, no token usage and no known context occupancy.
 */
export function RunStatsBar({ stats }: { stats: RunStats | undefined }) {
  const t = useT()
  const copy = t.run.stats
  const phone = usePhone()
  const [open, setOpen] = useState<Panel | null>(null)
  const session = stats?.session !== null && stats?.session !== undefined && stats.session.steps > 0 ? stats.session : null
  const usage = stats?.usage !== null && stats?.usage !== undefined && promptTotal(stats.usage) + stats.usage.outputTokens > 0
    ? stats.usage : null
  const context = occupancy(stats?.context ?? null)
  if (session === null && usage === null && context === null) return null
  const seat = (panel: Panel) => ({
    open: open === panel,
    onOpen: (next: boolean) => { setOpen(current => (next ? panel : current === panel ? null : current)) },
    phone,
  })
  const counts = session === null ? '' : copy.counts(session.turns, session.steps)
  const rate = session === null ? null : tokensPerSecond(session)
  const rateText = rate === null ? null : t.run.trajectory.unit.tokensPerSecond(formatRate(rate))
  const timed = session !== null && (session.llmMs > 0 || session.toolMs > 0 || session.ttftSteps > 0 || rate !== null)
  const total = usage === null ? 0 : promptTotal(usage) + usage.outputTokens
  const totalText = t.run.trajectory.unit.tokens(compactCount(total))
  const hit = usage === null ? null : cacheHitPercent(usage)
  const hitText = hit === null ? null : copy.cacheHit(hit)
  // A phone row leaves the speed and the word "cache" to the details, so all three readings fit beside each other.
  const shownRate = phone ? null : rateText
  const shownHit = hit === null ? null : phone ? copy.cacheHitShort(hit) : hitText
  const joined = (first: string, second: string | null) => (second === null ? first : `${first} · ${second}`)
  const pair = (first: string, second: string | null) => (
    <span className="tw-stat-label">{first}{second !== null && <><span className="tw-stat-sep" aria-hidden>·</span>{second}</>}</span>
  )
  return (
    <div className="tw-stats" role="group" aria-label={copy.label}>
      {session !== null && (
        <Reading icon={<IconGaugeOutlineRegular />} label={pair(counts, shownRate)} name={joined(counts, rateText)}
          title={copy.sessionTitle} {...seat('session')}>
          {timed ? <SessionDetails session={session} /> : undefined}
        </Reading>
      )}
      {usage !== null && (
        <Reading icon={<IconDatabaseOutlineRegular />} label={pair(totalText, shownHit)} name={joined(totalText, hitText)}
          title={copy.usageTitle} headline={t.run.trajectory.unit.tokens(total.toLocaleString())} {...seat('usage')}>
          <UsageDetails usage={usage} />
        </Reading>
      )}
      {context !== null && (
        <Reading icon={<Ring percent={context.percent} />} label={<span className="tw-stat-label">{`${context.percent}%`}</span>}
          name={copy.contextUsed(`${context.percent}%`)} title={copy.contextTitle} {...seat('context')}>
          <ContextDetails context={context} composition={stats?.composition ?? null} />
        </Reading>
      )}
    </div>
  )
}
