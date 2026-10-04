/** Overview: attention counters, recent Runs, upcoming triggers and execution capacity. */
import type { ReactNode } from 'react'
import { IconAlarmClockOutlineRegular, IconPlayOutlineRegular, IconRefreshOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { useApp, useShared } from '../app/context.tsx'
import { definitionTitle, formatTime, relative, runName } from '../support/format.ts'
import { useResource } from '../support/resource.ts'
import { Link, paths } from '../support/router.tsx'
import type { Definition } from '../support/types.ts'
import { Card, Dot, IconButton, PageHeader, Progress, SectionTitle, StatusMark, StatusTag, Time } from '../components/ui.tsx'

/** Overview page.
 * @returns main element.
 */
export function OverviewPage() {
  const t = useT()
  const { connection } = useApp()
  const shared = useShared()
  const diagnostics = useResource('diagnostics', signal => connection.call('getDiagnostics', { signal }))
  const recent = useResource('recent-runs', async signal => (await connection.call('listRuns', { query: { limit: '6' }, signal })).items)
  const runs = shared.active.value ?? []
  const interactions = shared.interactions.value ?? []
  const definitions = shared.definitions.value
  const blocked = runs.filter(run => run.status === 'blocked' && run.cleanup !== 'blocked')
  const cleanup = runs.filter(run => run.cleanup === 'blocked')
  const queued = runs.filter(run => run.status === 'queued')
  const bySource = (source: string) => interactions.filter(item => item.source === source).length
  const reload = () => {
    diagnostics.reload()
    recent.reload()
    shared.active.reload()
    shared.interactions.reload()
    shared.definitions.reload()
  }
  const scheduler = diagnostics.value?.scheduler
  const firstBlocked = blocked[0]
  const firstCleanup = cleanup[0]
  const oldestQueued = diagnostics.value?.oldestQueuedAt ?? null
  return (
    <main className="tw-main tw-gap-24">
      <PageHeader title={t.overview.title}
        subtitle={scheduler === undefined ? undefined : t.overview.subtitle(t.overview.scheduler[scheduler], location.host)}
        actions={<IconButton label={t.common.refresh} tone="caption" icon={<IconRefreshOutlineRegular size={16} />} onClick={reload} />} />
      <div className="tw-attention">
        <Attention to={paths.inbox()} label={t.overview.attentionInbox} count={interactions.length} mark={<Dot state={interactions.length > 0 ? 'warning' : 'idle'} />}
          sub={interactions.length === 0 ? t.overview.nothing : t.overview.inboxBreakdown(bySource('business'), bySource('tool_approval'),
            bySource('agent_question'))} />
        <Attention to={blocked.length === 1 && firstBlocked !== undefined ? paths.run(firstBlocked.id) : paths.runs({ status: 'blocked' })}
          label={t.overview.attentionBlocked} count={blocked.length} mark={<Dot state={blocked.length > 0 ? 'error' : 'idle'} />}
          sub={firstBlocked === undefined ? t.overview.nothing
            : `${definitionTitle(definitions, firstBlocked.definitionId)} · ${firstBlocked.reason ?? t.status.blocked}`} />
        <Attention to={cleanup.length === 1 && firstCleanup !== undefined ? paths.run(firstCleanup.id) : paths.runs({ status: 'blocked' })}
          label={t.overview.attentionCleanup} count={cleanup.length} mark={<Dot state={cleanup.length > 0 ? 'error' : 'idle'} />}
          sub={firstCleanup === undefined ? t.overview.nothing : t.overview.cleanupSub(runName(firstCleanup, t),
            t.status[firstCleanup.outcome ?? 'failed'])} />
        <Attention to={paths.runs({ status: 'queued' })} label={t.overview.attentionQueued} count={queued.length} mark={<Dot state="idle" />}
          sub={oldestQueued === null ? t.overview.nothing : t.overview.queuedSince(formatTime(oldestQueued))} />
      </div>
      <div className="tw-overview-columns">
        <Card className="tw-overview-recent">
          <SectionTitle title={t.overview.recent} right={<Link to={paths.runs()} className="tw-link">{t.common.viewAll}</Link>} />
          <div className="tw-recent-list">
            {recent.value?.length === 0 && <p className="tw-muted-line">{t.overview.noRuns}</p>}
            {recent.value?.map(run => (
              <Link key={run.id} to={paths.run(run.id)} className="tw-recent-row">
                <span className="tw-recent-mark"><StatusMark status={run.status} /></span>
                <span className="tw-recent-body">
                  <span className="tw-recent-name">{runName(run, t)}</span>
                  <span className="tw-recent-def">{definitionTitle(definitions, run.definitionId)}</span>
                  <span className="tw-flex" />
                  <StatusTag status={run.status} />
                  <span className="tw-recent-time"><Time value={run.updatedAt} /></span>
                </span>
              </Link>
            ))}
          </div>
        </Card>
        <div className="tw-overview-side">
          <Card>
            <SectionTitle title={t.overview.upcoming} />
            <Upcoming definitions={definitions} />
          </Card>
          <Card>
            <SectionTitle title={t.overview.capacity} right={<Link to={paths.diagnostics()} className="tw-link">{t.nav.diagnostics}</Link>} />
            {diagnostics.value !== undefined && (
              <>
                <div className="tw-capacity-figure"><span className="tw-figure">{diagnostics.value.activePermits}</span><span
                  className="tw-muted-text">{t.overview.used(diagnostics.value.concurrency)}</span></div>
                <Progress value={diagnostics.value.activePermits / diagnostics.value.concurrency} label={t.overview.capacity} />
                <div className="tw-capacity-meta">
                  <span>{t.overview.queued(diagnostics.value.queuedRuns)}</span>
                  <span>{t.overview.outbox(diagnostics.value.outboxPending)}</span>
                  <span>{t.overview.recoveryErrors(diagnostics.value.recoveryErrors)}</span>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </main>
  )
}

function Attention({ to, label, count, mark, sub }: { to: string; label: string; count: number; mark: ReactNode; sub: string }) {
  return (
    <Link to={to} className="tw-attention-card">
      <span className="tw-attention-label">{mark}{label}</span>
      <span className="tw-figure">{count}</span>
      <span className="tw-attention-sub" title={sub}>{sub}</span>
    </Link>
  )
}

function Upcoming({ definitions }: { definitions: readonly Definition[] | undefined }) {
  const t = useT()
  const scheduled = (definitions ?? []).filter(definition => definition.installed && definition.config.schedule.kind !== 'manual')
  const sorted = [...scheduled].sort((left, right) => {
    if (left.nextDueAt === null) return right.nextDueAt === null ? left.title.localeCompare(right.title) : 1
    if (right.nextDueAt === null) return -1
    return Date.parse(left.nextDueAt) - Date.parse(right.nextDueAt)
  }).slice(0, 6)
  if (sorted.length === 0) return <p className="tw-muted-line">{t.overview.noUpcoming}</p>
  return (
    <div className="tw-upcoming">
      {sorted.map(definition => (
        <Link key={definition.id} to={paths.definition(definition.id)} className="tw-upcoming-row">
          {definition.config.schedule.kind === 'polling' ? <IconRefreshOutlineRegular size={16} />
            : definition.config.schedule.kind === 'scheduled' ? <IconAlarmClockOutlineRegular size={16} /> : <IconPlayOutlineRegular size={16} />}
          <span className="tw-upcoming-title">{definition.title}</span>
          {definition.availability === 'active' && definition.nextDueAt !== null
            ? <span className="tw-upcoming-when"><span><Time value={definition.nextDueAt}
              weekday={Date.parse(definition.nextDueAt) - Date.now() > 86400000} /></span><span
              className="tw-muted-small">{relative(definition.nextDueAt, t)}</span></span>
            : <Tag tone={definition.availability === 'blocked' || definition.availability === 'retirement_blocked' ? 'danger'
              : 'outline'}>{t.availability[definition.availability]}</Tag>}
        </Link>
      ))}
    </div>
  )
}
