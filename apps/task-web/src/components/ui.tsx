/** Task Web building blocks over the upstream `ui-primitives` atoms. */
import { useState, type ReactNode, type Ref } from 'react'
import clsx from 'clsx'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconCopyOutlineRegular,
  IconInfoOutlineRegular, IconWarningOutlineRegular, IconWarningTriangleOutlineRegular, Menu, Tag, Tooltip, writeClipboard,
  type MenuEntry, type TagTone,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { formatTime, utcTitle } from '../support/format.ts'
import { useStore } from '../support/store.ts'
import { preferences } from '../support/preferences.ts'
import type { RunStatus } from '../support/types.ts'
import { Link } from '../support/router.tsx'

/** Neutral DSH Task mark: a stroked tile with a check.
 * @param props.size - edge in px.
 * @returns inline SVG.
 */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="tw-mark">
      <rect x="3" y="3" width="18" height="18" rx="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 12.2L10.8 15L16.2 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Indeterminate progress ring.
 * @param props.size - edge in px.
 * @param props.tone - color family.
 * @returns inline SVG.
 */
export function Spinner({ size = 14, tone = 'muted' }: { size?: number; tone?: 'muted' | 'info' | 'deep' | 'warning' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={clsx('tw-spinner', `tw-tone-${tone}`)}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Six-pixel state dot.
 * @param props.state - color family.
 * @returns dot element.
 */
export function Dot({ state }: { state: 'done' | 'warning' | 'error' | 'idle' }) {
  return <span className="tw-dot" data-state={state} aria-hidden="true"><span /></span>
}

const STATUS_MARK: Record<RunStatus, 'ongoing' | 'done' | 'warning' | 'error' | 'idle'> = {
  provisioning: 'ongoing', queued: 'idle', running: 'ongoing', waiting_input: 'warning', waiting_retry: 'idle', blocked: 'error',
  recovering: 'ongoing', cancelling: 'ongoing', succeeded: 'done', failed: 'error', cancelled: 'idle',
}
const STATUS_TONE: Record<RunStatus, TagTone> = {
  provisioning: 'neutral', queued: 'neutral', running: 'info', waiting_input: 'warning', waiting_retry: 'neutral', blocked: 'danger',
  recovering: 'neutral', cancelling: 'neutral', succeeded: 'success', failed: 'danger', cancelled: 'outline',
}

/** Status glyph: a spinner for ongoing states, a dot otherwise.
 * @param props.status - Run status.
 * @returns glyph element.
 */
export function StatusMark({ status }: { status: RunStatus }) {
  const mark = STATUS_MARK[status]
  if (mark === 'ongoing') return <Spinner tone={status === 'running' ? 'info' : 'muted'} />
  return <Dot state={mark} />
}

/** Status capsule.
 * @param props.status - Run status.
 * @returns tag element.
 */
export function StatusTag({ status }: { status: RunStatus }) {
  const t = useT()
  return <Tag tone={STATUS_TONE[status]}>{t.status[status]}</Tag>
}

/** Glyph and label of a status, used in tables.
 * @param props.status - Run status.
 * @returns inline status.
 */
export function StatusInline({ status }: { status: RunStatus }) {
  const t = useT()
  return <span className="tw-status-inline"><StatusMark status={status} /><span>{t.status[status]}</span></span>
}

const NOTICE_ICON = {
  warning: <IconWarningTriangleOutlineRegular size={16} />,
  error: <IconWarningOutlineRegular size={16} />,
  info: <IconInfoOutlineRegular size={16} />,
  success: <IconCheckOutlineRegular size={16} />,
}

/** Inline notice band.
 * @param props.kind - state family.
 * @param props.title - emphasized first sentence.
 * @param props.children - supporting text.
 * @param props.actions - trailing controls.
 * @returns status region.
 */
export function Notice({ kind, title, children,
  actions }: { kind: 'warning' | 'error' | 'info' | 'success'; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div role="status" className="tw-notice" data-kind={kind}>
      <span className="tw-notice-icon">{NOTICE_ICON[kind]}</span>
      <div className="tw-notice-text"><span className="tw-notice-title">{title}</span>{children !== undefined && <span
        className="tw-notice-body">{children}</span>}</div>
      {actions}
    </div>
  )
}

/** Bordered surface.
 * @param props.className - layout class.
 * @returns section element.
 */
export function Card({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return <section className={clsx('tw-card', className)} aria-label={label}>{children}</section>
}

/** Section heading with optional count and trailing control.
 * @returns heading row.
 */
export function SectionTitle({ title, count, right }: { title: string; count?: number | string | undefined; right?: ReactNode }) {
  return (
    <div className="tw-section-title">
      <div className="tw-section-title-left"><h2>{title}</h2>{count !== undefined && <span className="tw-caption">{count}</span>}</div>
      {right}
    </div>
  )
}

/** Labeled settings row with a trailing control.
 * @returns row element.
 */
export function SettingsRow({ label, hint, children, error,
  htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; error?: string | undefined; htmlFor?: string }) {
  return (
    <div className="tw-settings-row">
      <div className="tw-settings-row-label">
        {htmlFor === undefined ? <div className="tw-settings-row-title">{label}</div> : <label className="tw-settings-row-title"
          htmlFor={htmlFor}>{label}</label>}
        {hint !== undefined && hint !== '' && <div className="tw-settings-row-hint">{hint}</div>}
        {error !== undefined && <div className="tw-field-error" role="alert">{error}</div>}
      </div>
      <div className="tw-settings-row-control">{children}</div>
    </div>
  )
}

/** Square icon tile.
 * @returns tile element.
 */
export function Tile({ children, size = 'md', muted = false }: { children: ReactNode; size?: 'md' | 'sm'; muted?: boolean }) {
  return <span className={clsx('tw-tile', size === 'sm' && 'tw-tile-sm', muted && 'tw-muted')} aria-hidden="true">{children}</span>
}

/** Page heading with crumbs, subtitle and actions.
 * @returns header element.
 */
export function PageHeader({ title, subtitle, actions, crumbs }: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  crumbs?: readonly { label: string; to?: string }[]
}) {
  return (
    <header className={clsx('tw-page-header', crumbs === undefined && 'tw-page-header-section')}>
      <div className="tw-page-header-text">
        {crumbs !== undefined && <Crumbs items={crumbs} />}
        <h1>{title}</h1>
        {subtitle !== undefined && <p>{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="tw-page-header-actions">{actions}</div>}
    </header>
  )
}

/** Breadcrumb trail.
 * @returns navigation element.
 */
export function Crumbs({ items }: { items: readonly { label: string; to?: string }[] }) {
  return (
    <nav className="tw-crumbs" aria-label="breadcrumb">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="tw-crumb">
          {index > 0 && <IconChevronRightOutlineRegular size={12} />}
          {item.to === undefined ? <span>{item.label}</span> : <Link to={item.to} className="tw-link-quiet">{item.label}</Link>}
        </span>
      ))}
    </nav>
  )
}

/** Key/value row of an information panel.
 * @param props.sub - the row details the row above it and is indented.
 * @returns row element.
 */
export function KeyValue({ label, children, mono = false, sub = false }: {
  label: string
  children: ReactNode
  mono?: boolean
  sub?: boolean
}) {
  return (
    <div className="tw-kv" data-sub={sub || undefined}>
      <span className="tw-kv-label">{label}</span>
      <span className={clsx('tw-kv-value', mono && 'tw-mono')}>{children}</span>
    </div>
  )
}

/** Centered empty or missing state.
 * @returns status block.
 */
export function EmptyState({ icon, title, children,
  action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="tw-empty">
      <span className="tw-empty-icon">{icon}</span>
      <span className="tw-empty-title">{title}</span>
      {children !== undefined && <span className="tw-empty-body">{children}</span>}
      {action}
    </div>
  )
}

/** Icon-only button with an accessible label and tooltip.
 * @returns button element.
 */
export function IconButton({ label, icon, onClick, size = 28, disabled, tone, buttonRef }: {
  label: string
  icon: ReactNode
  onClick?: () => void
  size?: 24 | 28
  disabled?: boolean
  tone?: 'muted' | 'caption'
  buttonRef?: Ref<HTMLButtonElement>
}) {
  return (
    <Tooltip label={label} side="bottom" delayMs={400}>
      <button type="button" ref={buttonRef} aria-label={label} className={clsx('tw-icon-button', size === 24 && 'tw-icon-button-sm',
        tone !== undefined && `tw-icon-${tone}`)}
      onClick={onClick} disabled={disabled}>{icon}</button>
    </Tooltip>
  )
}

/** Copy text to the clipboard with transient confirmation.
 * @returns icon button.
 */
export function CopyButton({ text, label, size = 24 }: { text: string; label: string; size?: 24 | 28 }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  return (
    <IconButton size={size} tone="caption" label={copied ? t.common.copied : label}
      icon={copied ? <IconCheckOutlineRegular size={16} /> : <IconCopyOutlineRegular size={16} />}
      onClick={() => {
        void writeClipboard(text).then((ok) => {
          if (!ok) return
          setCopied(true)
          setTimeout(() => { setCopied(false) }, 1200)
        })
      }} />
  )
}

/** Shell command line with a copy button.
 * @returns code row.
 */
export function CommandLine({ command }: { command: string }) {
  const t = useT()
  return (
    <div className="tw-command"><code className="tw-mono">{command}</code><CopyButton text={command} label={t.common.copyCommand} /></div>
  )
}

/** Inline code span.
 * @returns code element.
 */
export function InlineCode({ children }: { children: ReactNode }) {
  return <code className="tw-inline-code">{children}</code>
}

/** Monospace text.
 * @returns span element.
 */
export function Mono({ children, tone }: { children: ReactNode; tone?: 'muted' | 'strong' }) {
  return <span className={clsx('tw-mono', tone === 'muted' && 'tw-muted-text', tone === 'strong' && 'tw-strong-text')}>{children}</span>
}

/** Displayed API time with its UTC value on hover.
 * @returns time element.
 */
export function Time({ value, weekday = false, seconds = false,
  full = false }: { value: string | null; weekday?: boolean; seconds?: boolean; full?: boolean }) {
  const t = useT()
  useStore(preferences)
  if (value === null) return <span>{t.common.none}</span>
  return (
    <time dateTime={value} title={t.time.utcTitle(utcTitle(value))}>
      {formatTime(value, { ...(weekday ? { weekdays: t.weekdays, today: t.time.today } : {}), seconds, full })}
    </time>
  )
}

/** Option of a {@link Select}. */
export interface SelectOption<Value extends string> {
  readonly value: Value
  readonly label: string
  readonly hint?: string
}

/** Selector button opening a menu of options.
 * @returns selector element.
 */
export function Select<Value extends string>({ value, options, onChange, label, width, mono = false, disabled = false, placeholder }: {
  value: Value | undefined
  options: readonly SelectOption<Value>[]
  onChange: (value: Value) => void
  label: string
  width?: number
  mono?: boolean
  disabled?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(option => option.value === value)
  const items: MenuEntry[] = options.map(option => ({ id: option.value, label: option.label }))
  return (
    <Menu open={open} onClose={() => { setOpen(false) }} portal selectedId={value} items={items}
      onSelect={(id) => { setOpen(false); onChange(id as Value) }}
      anchor={(
        <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled}
          className={clsx('tw-select', mono && 'tw-mono', current === undefined && 'tw-select-placeholder')} style={width === undefined
            ? undefined : { width }}
          onClick={() => { setOpen(value => !value) }}>
          <span className="tw-select-label">{current?.label ?? placeholder ?? ''}</span>
          <IconChevronDownOutlineRegular size={14} />
        </button>
      )} />
  )
}

/** Progress bar.
 * @returns meter element.
 */
export function Progress({ value, label, height = 6 }: { value: number; label: string; height?: number }) {
  const clamped = Math.max(0, Math.min(1, value))
  return (
    <div className="tw-progress" style={{ height }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}>
      <div style={{ width: `${Math.round(clamped * 100)}%` }} />
    </div>
  )
}

/** Tab strip that renders as page-level segmented tabs, or as underlined tabs for a view switch inside a page.
 * @param props.variant - `segmented` for page tabs; `underline` for the header tabs of a view switch.
 * @returns tablist element.
 */
export function Tabs<Value extends string>({ items, value, onChange, label, variant = 'segmented' }: {
  items: readonly { value: Value; label: string; count?: number | string | undefined }[]
  value: Value
  onChange: (value: Value) => void
  label: string
  variant?: 'segmented' | 'underline'
}) {
  return (
    <div role="tablist" aria-label={label} className={clsx('tw-tabs', variant === 'underline' && 'tw-tabs-underline')}>
      {items.map(item => (
        <button key={item.value} type="button" role="tab" aria-selected={item.value === value} className="tw-tab"
          onClick={() => { onChange(item.value) }}>
          <span>{item.label}</span>
          {item.count !== undefined && item.count !== 0 && item.count !== '' && <span className="tw-tab-count">{item.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Segmented choice for short option lists.
 * @returns tablist element.
 */
export function Segmented<Value extends string>({ items, value, onChange, label, disabled = false }: {
  items: readonly { value: Value; label: string }[]
  value: Value
  onChange: (value: Value) => void
  label: string
  disabled?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={label} className="tw-segmented">
      {items.map(item => (
        <button key={item.value} type="button" role="radio" aria-checked={item.value === value} disabled={disabled}
          className="tw-segment" onClick={() => { onChange(item.value) }}>{item.label}</button>
      ))}
    </div>
  )
}
