/** Layout of the Run detail right sidebar: whether it is open on wide screens and how wide it is, kept per browser. */
import { useCallback, useState, useSyncExternalStore } from 'react'
import { Store, useStore } from './store.ts'

/** Width limits and starting width of the sidebar in px. */
export const SIDEBAR_WIDTH = { min: 280, max: 560, initial: 340 } as const

/** Viewport width in px above which the sidebar pushes the page aside; at or below it the sidebar covers the page's right edge. */
export const WIDE_VIEWPORT_PX = 1100

/** Sidebar layout stored in this browser. */
export interface SidebarLayout {
  /** The reader's choice on wide screens; undefined until they choose, which reads as open. */
  readonly open: boolean | undefined
  readonly width: number
}

const KEY = 'dsh-task-web.run-sidebar'

/** Keep a width inside the sidebar limits.
 * @param width - requested width in px.
 * @returns the nearest allowed whole width.
 */
export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, Math.round(width)))
}

function initial(): SidebarLayout {
  const fallback: SidebarLayout = { open: undefined, width: SIDEBAR_WIDTH.initial }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return fallback
    const value = JSON.parse(raw) as Partial<SidebarLayout>
    return {
      open: typeof value.open === 'boolean' ? value.open : undefined,
      width: typeof value.width === 'number' && Number.isFinite(value.width) ? clampSidebarWidth(value.width) : fallback.width,
    }
  } catch {
    return fallback // Storage may be unavailable or hold a value from another version.
  }
}

/** Shared sidebar layout store. */
export const sidebarLayout = new Store<SidebarLayout>(initial())

/** Update and persist the sidebar layout.
 * @param patch - changed fields.
 */
export function updateSidebarLayout(patch: Partial<SidebarLayout>): void {
  const next = { ...sidebarLayout.get(), ...patch }
  sidebarLayout.set(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage may be unavailable in private windows; the layout still applies to this page.
  }
}

const WIDE_QUERY = `(min-width: ${WIDE_VIEWPORT_PX + 1}px)`

function subscribeViewport(listener: () => void): () => void {
  const media = window.matchMedia(WIDE_QUERY)
  media.addEventListener('change', listener)
  return () => { media.removeEventListener('change', listener) }
}

/** Observe whether the viewport is wide enough for the sidebar to push the page aside.
 * @returns true above {@link WIDE_VIEWPORT_PX}.
 */
export function useWideViewport(): boolean {
  return useSyncExternalStore(subscribeViewport, () => window.matchMedia(WIDE_QUERY).matches)
}

/** State of the sidebar on the current page. */
export interface RunSidebar {
  readonly open: boolean
  /** The sidebar covers the page's right edge instead of pushing the page aside. */
  readonly covering: boolean
  readonly width: number
  readonly setOpen: (open: boolean) => void
  readonly setWidth: (width: number) => void
}

/** Open state and width of the sidebar. Wide screens share the stored choice, which defaults to open; narrow screens start closed and
 * remember nothing, so a reload never opens a sidebar over the page.
 * @returns state and setters.
 */
export function useRunSidebar(): RunSidebar {
  const layout = useStore(sidebarLayout)
  const wide = useWideViewport()
  const [coveringOpen, setCoveringOpen] = useState(false)
  const setOpen = useCallback((open: boolean) => {
    if (wide) updateSidebarLayout({ open })
    else setCoveringOpen(open)
  }, [wide])
  const setWidth = useCallback((width: number) => { updateSidebarLayout({ width: clampSidebarWidth(width) }) }, [])
  return { open: wide ? layout.open ?? true : coveringOpen, covering: !wide, width: layout.width, setOpen, setWidth }
}
