/** Primary navigation with the list of unfinished Runs. */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconChevronRightOutlineRegular, IconDataOutlineRegular, IconGaugeOutlineRegular, IconListPenOutlineRegular, IconPanelLeftOutlineRegular,
  IconPlayOutlineRegular, IconQuestionOutlineRegular, IconQueueOutlineRegular, IconSettingsOutlineRegular, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { definitionTitle, formatTime } from '../support/format.ts'
import { Link, paths, useRouter } from '../support/router.tsx'
import { IconButton, Mark, StatusMark } from '../components/ui.tsx'
import { useApp, useShared } from './context.tsx'

/** Sidebar navigation.
 * @param props.onCollapse - hide the sidebar.
 * @returns navigation element.
 */
export function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const t = useT()
  const { route } = useRouter()
  const { openTrigger, openSettings } = useApp()
  const { active, interactions, definitions } = useShared()
  const section = route.segments[0] ?? ''
  const currentRun = route.segments[0] === 'runs' ? route.segments[1] : undefined
  const inboxCount = interactions.value?.length ?? 0
  const runs = active.value ?? []
  const nav: { key: string; label: string; icon: ReactNode; to: string; badge?: number }[] = [
    { key: '', label: t.nav.overview, icon: <IconGaugeOutlineRegular size={16} />, to: paths.overview() },
    { key: 'definitions', label: t.nav.definitions, icon: <IconListPenOutlineRegular size={16} />, to: paths.definitions() },
    { key: 'runs', label: t.nav.runs, icon: <IconQueueOutlineRegular size={16} />, to: paths.runs() },
    { key: 'inbox', label: t.nav.inbox, icon: <IconQuestionOutlineRegular size={16} />, to: paths.inbox(), badge: inboxCount },
    { key: 'diagnostics', label: t.nav.diagnostics, icon: <IconDataOutlineRegular size={16} />, to: paths.diagnostics() },
  ]
  return (
    <nav aria-label={t.nav.label} className="tw-sidebar">
      <div className="tw-sidebar-brand">
        <Link to={paths.overview()} className="tw-brand"><Mark /><span>{t.brand}</span></Link>
        <IconButton label={t.nav.collapse} icon={<IconPanelLeftOutlineRegular size={16} />} onClick={onCollapse} />
      </div>
      <button type="button" className="tw-sidebar-primary" onClick={() => { openTrigger() }}>
        <IconPlayOutlineRegular size={16} /><span>{t.nav.trigger}</span>
      </button>
      <div className="tw-sidebar-nav">
        {nav.map(item => (
          <Link key={item.key} to={item.to} className={clsx('tw-nav-row', section === item.key && 'tw-active')} aria-current={section === item.key ? 'page' : undefined}>
            {item.icon}<span>{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && <span className="tw-nav-badge"><Tag tone="warning">{item.badge}</Tag></span>}
          </Link>
        ))}
      </div>
      <div className="tw-sidebar-section">
        <span>{t.nav.active(runs.length)}</span>
        <Link to={paths.runs({ status: 'active' })} className="tw-icon-button tw-icon-caption" aria-label={t.nav.viewActive} title={t.nav.viewActive}>
          <IconChevronRightOutlineRegular size={16} />
        </Link>
      </div>
      <div className="tw-sidebar-runs">
        {runs.length === 0 && <span className="tw-sidebar-empty">{t.nav.noActive}</span>}
        {runs.map((run) => {
          const title = run.businessKey === null
            ? `${definitionTitle(definitions.value, run.definitionId)} · ${formatTime(run.createdAt)}`
            : `${run.businessKey} · ${definitionTitle(definitions.value, run.definitionId)}`
          return (
            <Link key={run.id} to={paths.run(run.id)} className={clsx('tw-run-row', currentRun === run.id && 'tw-active')} title={title}>
              <span className="tw-run-row-mark"><StatusMark status={run.status} /></span>
              <span className="tw-run-row-title">{title}</span>
              <span className="tw-run-row-time">{formatTime(run.updatedAt)}</span>
            </Link>
          )
        })}
      </div>
      <button type="button" className="tw-nav-row tw-sidebar-settings" onClick={() => { openSettings() }}>
        <IconSettingsOutlineRegular size={16} /><span>{t.nav.settings}</span>
      </button>
    </nav>
  )
}
