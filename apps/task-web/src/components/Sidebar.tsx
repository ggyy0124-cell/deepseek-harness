/** Right sidebar of the Run detail page: a tab strip over a scrolling body. It pushes the page aside on wide screens and covers the
 * page's right edge on narrow ones. */
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { IconCloseOutlineRegular, IconPanelLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { clampSidebarWidth, SIDEBAR_WIDTH } from '../support/sidebar.ts'
import { IconButton } from './ui.tsx'

/** Width change in px of one arrow key press on the resize handle. */
const KEY_STEP_PX = 16

/** One tab of the sidebar strip. */
export interface SidebarTab<Id extends string> {
  readonly id: Id
  readonly label: string
  /** Accessible name of the close control; a tab without one cannot be closed. */
  readonly closeLabel?: string
}

/** Open or collapse control of the sidebar, with the glyph of the left sidebar's collapse button mirrored.
 * @param props.label - accessible name and tooltip.
 * @param props.onClick - request to open or collapse.
 * @param props.buttonRef - receives the button, so focus can return to it when the sidebar closes.
 * @returns icon button.
 */
export function SidebarToggle({ label, onClick, buttonRef }: {
  label: string
  onClick: () => void
  buttonRef?: Ref<HTMLButtonElement>
}) {
  return <IconButton label={label} onClick={onClick} {...(buttonRef === undefined ? {} : { buttonRef })}
    icon={<IconPanelLeftOutlineRegular size={15} className="tw-mirror" />} />
}

/** Edge of the sidebar that resizes it by pointer drag, double click reset or arrow keys.
 * @param props.width - committed width in px.
 * @param props.onLive - width while dragging.
 * @param props.onCommit - width once the gesture ends.
 * @returns separator element.
 */
function ResizeHandle({ width, onLive, onCommit }: { width: number; onLive: (width: number) => void; onCommit: (width: number) => void }) {
  const t = useT()
  const drag = useRef<{ startX: number; startWidth: number; latest: number } | null>(null)
  const finish = () => {
    const state = drag.current
    drag.current = null
    if (state !== null) onCommit(state.latest)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowLeft' ? KEY_STEP_PX : event.key === 'ArrowRight' ? -KEY_STEP_PX : 0
    if (delta === 0) return
    event.preventDefault()
    onCommit(clampSidebarWidth(width + delta))
  }
  return (
    <div role="separator" aria-orientation="vertical" aria-label={t.run.sidebar.resize} aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH.min} aria-valuemax={SIDEBAR_WIDTH.max} tabIndex={0} className="tw-rightbar-handle"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { startX: event.clientX, startWidth: width, latest: width }
      }}
      onPointerMove={(event) => {
        const state = drag.current
        if (state === null) return
        state.latest = clampSidebarWidth(state.startWidth + state.startX - event.clientX)
        onLive(state.latest)
      }}
      onPointerUp={finish} onPointerCancel={finish}
      onDoubleClick={() => { onCommit(SIDEBAR_WIDTH.initial) }} onKeyDown={onKeyDown} />
  )
}

/** Sidebar shell: tab strip, collapse control and the active tab's body.
 * @param props.open - the sidebar is shown.
 * @param props.covering - the sidebar covers the page's right edge instead of pushing the page aside.
 * @param props.width - width in px while open.
 * @param props.tabs - tabs in strip order.
 * @param props.active - id of the shown tab.
 * @param props.activeRef - receives the active tab's button.
 * @param props.scrollKey - the body scrolls back to its top whenever this value changes.
 * @param props.onSelect - tab chosen by click or arrow keys.
 * @param props.onCloseTab - closable tab closed.
 * @param props.onCollapse - collapse control, or Escape while covering.
 * @param props.onResize - committed width after a resize gesture.
 * @param props.children - body of the active tab.
 * @returns aside element, kept mounted while closed so the slide animation can play.
 */
export function Sidebar<Id extends string>({
  open, covering, width, tabs, active, activeRef, scrollKey, onSelect, onCloseTab, onCollapse, onResize, children,
}: {
  open: boolean
  covering: boolean
  width: number
  tabs: readonly SidebarTab<Id>[]
  active: Id
  activeRef?: Ref<HTMLButtonElement>
  scrollKey: string
  onSelect: (id: Id) => void
  onCloseTab: (id: Id) => void
  onCollapse: () => void
  onResize: (width: number) => void
  children: ReactNode
}) {
  const t = useT()
  const base = useId()
  const body = useRef<HTMLDivElement | null>(null)
  const [live, setLive] = useState<number | null>(null)
  const tabId = (id: Id) => `${base}-tab-${id}`
  useLayoutEffect(() => {
    if (body.current !== null) body.current.scrollTop = 0
  }, [active, scrollKey])
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    const next = tabs[(tabs.findIndex(tab => tab.id === active) + step + tabs.length) % tabs.length]
    if (next === undefined) return
    event.preventDefault()
    onSelect(next.id)
    document.getElementById(tabId(next.id))?.focus()
  }
  return (
    <div className="tw-rightbar" data-open={open || undefined} data-covering={covering || undefined} data-resizing={live !== null || undefined}
      style={{ '--tw-rightbar-width': `${live ?? width}px` } as CSSProperties}>
      <aside aria-label={t.run.sidebar.label} className="tw-rightbar-panel"
        onKeyDown={(event) => { if (event.key === 'Escape' && covering) onCollapse() }}>
        <ResizeHandle width={width} onLive={setLive} onCommit={(next) => { setLive(null); onResize(next) }} />
        <div className="tw-rightbar-strip">
          <div role="tablist" aria-label={t.run.sidebar.label} className="tw-rightbar-tabs" onKeyDown={move}>
            {tabs.map(tab => (
              <span key={tab.id} role="presentation" className="tw-rightbar-tab" data-active={tab.id === active || undefined}>
                <button type="button" role="tab" id={tabId(tab.id)} ref={tab.id === active ? activeRef : undefined}
                  aria-selected={tab.id === active} aria-controls={`${base}-panel`} tabIndex={tab.id === active ? 0 : -1}
                  className="tw-rightbar-tab-label" onClick={() => { onSelect(tab.id) }}>{tab.label}</button>
                {tab.closeLabel !== undefined && (
                  <button type="button" className="tw-rightbar-tab-close" aria-label={tab.closeLabel}
                    onClick={() => { onCloseTab(tab.id) }}><IconCloseOutlineRegular size={12} /></button>
                )}
              </span>
            ))}
          </div>
          <SidebarToggle label={t.run.sidebar.close} onClick={onCollapse} />
        </div>
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={tabId(active)} className="tw-rightbar-body" ref={body}>{children}</div>
      </aside>
    </div>
  )
}
