/** Diagnostics: scheduler, queue, persistence and storage counters plus the live Task event feed. */
import type { ReactNode } from 'react'
import { IconRefreshOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { useApp, useShared } from '../app/context.tsx'
import { bytes, definitionTitle, formatTime, relative, runName, shortId } from '../lib/format.ts'
import { useResource } from '../lib/resource.ts'
import { Link, paths } from '../lib/router.tsx'
import { useStore } from '../lib/store.ts'
import { Card, Dot, IconButton, Mono, Notice, PageHeader, Progress, SectionTitle, Time } from '../components/ui.tsx'
import { failureText } from '../lib/format.ts'

/** Diagnostics page.
 * @returns main element.
 */
export function DiagnosticsPage() {
  const t = useT()
  const { connection, events } = useApp()
  const { definitions, active } = useShared()
  const diagnostics = useResource('diagnostics', signal => connection.call('getDiagnostics', { signal }))
  const ready = useResource('readiness', () => connection.readiness())
  const recent = useStore(events.recent)
  const cursor = useStore(events.cursor)
  const streamState = useStore(events.state)
  const value = diagnostics.value
  const runLabel = (id: string) => {
    const run = active.value?.find(item => item.id === id)
    return run === undefined ? shortId(id) : runName(run, t)
  }
  return (
    <main className="tw-main tw-gap-20">
      <PageHeader title={t.diagnostics.title} subtitle={t.diagnostics.subtitle}
        actions={<>
          {ready.value !== undefined && <Tag tone={ready.value ? 'success' : 'warning'}>{ready.value ? t.diagnostics.ready
            : t.diagnostics.notReady}</Tag>}
          <IconButton label={t.common.refresh} tone="caption" icon={<IconRefreshOutlineRegular size={16} />}
            onClick={() => { diagnostics.reload(); ready.reload() }} />
        </>} />
      {diagnostics.error !== undefined && <Notice kind="error" title={t.common.loadFailed}>{failureText(diagnostics.error, t)}</Notice>}
      {value !== undefined && (
        <>
          <div className="tw-metrics">
            <Metric label={t.diagnostics.scheduler}
              value={<span className="tw-inline-flex"><Dot state={value.scheduler === 'running' ? 'done' : value.scheduler === 'failed'
                ? 'error' : 'warning'} />{t.diagnostics.schedulerState[value.scheduler]}</span>}
              sub={ready.value === true ? t.diagnostics.schedulerOk : t.diagnostics.schedulerNot} />
            <Metric label={t.diagnostics.permits} value={`${value.activePermits} / ${value.concurrency}`}
              extra={<Progress value={value.activePermits / value.concurrency} label={t.diagnostics.permits} />} />
            <Metric label={t.diagnostics.queued} value={String(value.queuedRuns)}
              sub={value.oldestQueuedAt === null ? t.diagnostics.queuedNone
                : `${t.diagnostics.queuedSub(formatTime(value.oldestQueuedAt))} · ${relative(value.oldestQueuedAt, t)}`} />
            <Metric label={t.diagnostics.total} value={String(value.totalRuns)} sub={t.diagnostics.totalSub(value.activeRuns,
              value.completedRuns)} />
            <Metric label={t.diagnostics.pendingInputs} value={String(value.pendingInputs)} sub={t.diagnostics.pendingInputsSub} />
            <Metric label={t.diagnostics.recoveryErrors} value={String(value.recoveryErrors)} danger={value.recoveryErrors > 0}
              sub={value.recoveryErrors > 0 ? t.diagnostics.recoveryBad : t.diagnostics.recoveryOk} />
            <Metric label={t.diagnostics.cleanupFailures} value={String(value.cleanupFailures)} danger={value.cleanupFailures > 0}
              sub={value.cleanupFailures > 0 ? t.diagnostics.cleanupSub : t.diagnostics.cleanupNone} />
            <Metric label={t.diagnostics.outbox} value={String(value.outboxPending)}
              sub={value.oldestOutboxAt === null ? t.diagnostics.outboxNone
                : t.diagnostics.outboxSince(formatTime(value.oldestOutboxAt))} />
          </div>
          <Card>
            <SectionTitle title={t.diagnostics.storage} />
            {value.storage === null
              ? <p className="tw-muted-line">{t.diagnostics.storageUnknown}</p>
              : (
                <div className="tw-storage">
                  <div className="tw-flex"><Progress height={8} label={t.diagnostics.storage}
                    value={value.storage.totalBytes === 0 ? 0 : 1 - value.storage.availableBytes / value.storage.totalBytes} /></div>
                  <span
                    className="tw-secondary-text">{t.diagnostics.storageUsage(bytes(value.storage.totalBytes - value.storage.availableBytes), bytes(value.storage.availableBytes), bytes(value.storage.totalBytes))}</span>
                  <Tag tone={value.storage.pressure ? 'warning' : 'success'}>{value.storage.pressure ? t.diagnostics.storageLow
                    : t.diagnostics.storageOk}</Tag>
                </div>
              )}
          </Card>
          <div className="tw-columns">
            <Card className="tw-flex">
              <SectionTitle title={t.diagnostics.resources} count={value.resources.length} />
              {value.resources.length === 0
                ? <p className="tw-muted-line">{t.diagnostics.noResources}</p>
                : (
                  <table className="tw-table">
                    <thead><tr><th style={{ width: '34%' }}>{t.diagnostics.resource}</th><th
                      style={{ width: '14%' }}>{t.diagnostics.capacity}</th><th>{t.diagnostics.holders}</th></tr></thead>
                    <tbody>
                      {value.resources.map(resource => (
                        <tr key={resource.name}>
                          <td><Mono tone="strong">{resource.name}</Mono></td>
                          <td>{resource.capacity}</td>
                          <td>{resource.runIds.map(id => (
                            <div key={id}><Link to={paths.run(id)} className="tw-link">{runLabel(id)}</Link> <Mono
                              tone="muted">{shortId(id)}</Mono></div>
                          ))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </Card>
            <Card className="tw-flex">
              <SectionTitle title={t.diagnostics.retirements} count={value.retirements.length} />
              {value.retirements.length === 0
                ? <p className="tw-muted-line">{t.diagnostics.noRetirements}</p>
                : (
                  <table className="tw-table">
                    <thead><tr><th style={{ width: '40%' }}>{t.diagnostics.task}</th><th
                      style={{ width: '18%' }}>{t.diagnostics.codeVersion}</th><th
                      style={{ width: '18%' }}>{t.diagnostics.state}</th><th>{t.diagnostics.when}</th></tr></thead>
                    <tbody>
                      {value.retirements.map(item => (
                        <tr key={item.id}>
                          <td><Link to={paths.definition(item.definitionId, 'lifecycle')}
                            className="tw-link">{definitionTitle(definitions.value, item.definitionId)}</Link> <Mono
                            tone="muted">{item.definitionId}</Mono></td>
                          <td><Mono>{item.codeVersion}</Mono></td>
                          <td><Tag tone={item.state === 'complete' ? 'outline' : item.state === 'blocked' ? 'danger'
                            : 'warning'}>{t.retirement[item.state]}</Tag></td>
                          <td><Time value={item.requestedAt} full />{item.completedAt === null ? '' : ' → '}{item.completedAt !== null
                            && <Time value={item.completedAt} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              <p className="tw-footnote">{t.diagnostics.retireHint}</p>
            </Card>
          </div>
        </>
      )}
      <Card>
        <SectionTitle title={t.diagnostics.events}
          right={<span className="tw-inline-flex tw-muted-small"><Dot state={streamState === 'connected' || streamState === 'recovered'
            ? 'done' : 'warning'} />
          {streamState === 'connected' || streamState === 'recovered' ? t.settings.liveConnected : t.settings.liveDisconnected}
          {cursor !== null && <> · {t.diagnostics.cursor('')}<Mono tone="muted">{abbreviateCursor(cursor)}</Mono></>}</span>} />
        <div className="tw-event-list">
          {recent.length === 0 && <p className="tw-muted-line">{t.diagnostics.noEvents}</p>}
          {recent.map(event => (
            <div key={event.cursor} className="tw-event-row">
              <Mono tone="muted"><Time value={event.at} seconds /></Mono>
              <span className="tw-mono tw-flex">{event.event}</span>
              {event.runId === null ? <Mono tone="muted">—</Mono> : <Link to={paths.run(event.runId)}
                className="tw-mono tw-link-quiet">{shortId(event.runId)}</Link>}
            </div>
          ))}
        </div>
      </Card>
    </main>
  )
}

function abbreviateCursor(cursor: string): string {
  const [store, position] = cursor.split(':')
  return `${(store ?? '').slice(0, 8)}-…:${position ?? ''}`
}

function Metric({ label, value, sub, extra,
  danger = false }: { label: string; value: ReactNode; sub?: string; extra?: ReactNode; danger?: boolean }) {
  return (
    <section className="tw-card tw-metric">
      <span className="tw-metric-label">{label}</span>
      <span className={danger ? 'tw-metric-value tw-danger-text' : 'tw-metric-value'}>{value}</span>
      {sub !== undefined && <span className="tw-muted-small">{sub}</span>}
      {extra}
    </section>
  )
}
