/** Phone-width navigation: a top bar that opens the sidebar as a drawer, and a bottom bar with the five sections.
 * Both render on every width; the stylesheet shows them only at or below {@link PHONE_VIEWPORT_PX}, where the sidebar becomes
 * the drawer. */
import type { ReactNode, Ref } from 'react'
import clsx from 'clsx'
import {
  IconChevronLeftOutlineRegular, IconDataOutlineRegular, IconGaugeOutlineRegular, IconListPenOutlineRegular, IconPanelLeftOutlineRegular,
  IconPlayOutlineRegular, IconQuestionOutlineRegular, IconQueueOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { Link, paths, useRouter } from '../support/router.tsx'
import { useApp, useShared } from './context.tsx'

/** Viewport width in px at or below which the phone layout applies; `app.css` uses the same value in its `max-width` media queries. */
const PHONE_VIEWPORT_PX = 760

/** Media query that matches the phone layout. */
export const PHONE_QUERY = `(max-width: ${PHONE_VIEWPORT_PX}px)`

/** Top bar of the phone layout: the drawer button, or a back button on detail pages, the section title and the trigger action.
 * @param props.menuRef - receives the drawer button so focus can return to it when the drawer closes.
 * @param props.onMenu - open the navigation drawer.
 * @returns header element.
 */
export function MobileBar({ menuRef, onMenu }: { menuRef: Ref<HTMLButtonElement>; onMenu: () => void }) {
  const t = useT()
  const { route, navigate } = useRouter()
  const { openTrigger } = useApp()
  const [first, second] = route.segments
  const title = first === 'definitions' ? t.nav.definitions : first === 'runs' ? t.nav.runs : first === 'inbox' ? t.nav.inbox
    : first === 'diagnostics' ? t.nav.diagnostics : t.nav.overview
  const parent = second === undefined ? null : first === 'definitions' ? paths.definitions() : first === 'runs' ? paths.runs() : null
  return (
    <header className="tw-mobilebar">
      {parent === null
        ? (
          <button type="button" ref={menuRef} className="tw-mobilebar-button" aria-label={t.nav.menu} onClick={onMenu}>
            <IconPanelLeftOutlineRegular size={20} />
          </button>
        )
        : (
          <button type="button" className="tw-mobilebar-button" aria-label={t.common.back} onClick={() => { navigate(parent) }}>
            <IconChevronLeftOutlineRegular size={20} />
          </button>
        )}
      <span className="tw-mobilebar-title">{title}</span>
      <button type="button" className="tw-mobilebar-button" aria-label={t.nav.trigger} onClick={() => { openTrigger() }}>
        <IconPlayOutlineRegular size={20} />
      </button>
    </header>
  )
}

/** Bottom section bar of the phone layout; the inbox entry carries the waiting interaction count.
 * @returns navigation element.
 */
export function TabBar() {
  const t = useT()
  const { route } = useRouter()
  const { interactions } = useShared()
  const section = route.segments[0] ?? ''
  const inboxCount = interactions.value?.length ?? 0
  const items: { key: string; label: string; icon: ReactNode; to: string; badge?: number }[] = [
    { key: '', label: t.nav.overview, icon: <IconGaugeOutlineRegular size={22} />, to: paths.overview() },
    { key: 'definitions', label: t.nav.definitions, icon: <IconListPenOutlineRegular size={22} />, to: paths.definitions() },
    { key: 'runs', label: t.nav.runs, icon: <IconQueueOutlineRegular size={22} />, to: paths.runs() },
    { key: 'inbox', label: t.nav.inbox, icon: <IconQuestionOutlineRegular size={22} />, to: paths.inbox(), badge: inboxCount },
    { key: 'diagnostics', label: t.nav.diagnostics, icon: <IconDataOutlineRegular size={22} />, to: paths.diagnostics() },
  ]
  return (
    <nav aria-label={t.nav.sections} className="tw-tabbar">
      {items.map(item => (
        <Link key={item.key} to={item.to} className={clsx('tw-tabbar-item', section === item.key && 'tw-active')}
          aria-current={section === item.key ? 'page' : undefined}>
          {item.icon}<span>{item.label}</span>
          {item.badge !== undefined && item.badge > 0 && <span className="tw-tabbar-badge">{item.badge}</span>}
        </Link>
      ))}
    </nav>
  )
}
