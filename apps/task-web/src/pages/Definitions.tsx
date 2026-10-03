/** Task definitions: installed definitions with enablement, and retained uninstalled definitions. */
import { useState } from 'react'
import {
  Button, IconAlarmClockOutlineRegular, IconListPenOutlineRegular, IconPlayOutlineRegular, IconRefreshOutlineRegular, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useT, type Messages } from '../i18n/index.ts'
import { useApp, useShared } from '../app/context.tsx'
import { commandKey, describeFailure } from '../lib/connection.ts'
import { failureText, formatTime, scheduleSummary } from '../lib/format.ts'
import { Link, paths, useRouter } from '../lib/router.tsx'
import type { Definition } from '../lib/types.ts'
import { EmptyState, IconButton, Notice, PageHeader, SectionTitle, Tile } from '../components/ui.tsx'

/** Icon of a definition's schedule kind.
 * @param props.definition - definition.
 * @returns icon element.
 */
export function ScheduleIcon({ definition, size = 22 }: { definition: Pick<Definition, 'config'>; size?: number }) {
  switch (definition.config.schedule.kind) {
    case 'polling': return <IconRefreshOutlineRegular size={size} />
    case 'scheduled': return <IconAlarmClockOutlineRegular size={size} />
    case 'manual': return <IconPlayOutlineRegular size={size} />
  }
}

/** Tag tone of an availability value.
 * @param availability - definition availability.
 * @returns tone.
 */
export function availabilityTone(availability: Definition['availability']): 'success' | 'outline' | 'danger' | 'warning' {
  switch (availability) {
    case 'active': return 'success'
    case 'blocked':
    case 'retirement_blocked': return 'danger'
    case 'retiring': return 'warning'
    case 'paused':
    case 'unavailable':
    case 'retired': return 'outline'
  }
}

/** Enable or pause a definition; a stale revision reloads the list.
 * @returns toggle command and the pending definition identity.
 */
export function useEnableToggle(onChanged: () => void): { pending: string | null; toggle: (definition: Definition) => void } {
  const t = useT()
  const { connection, toast } = useApp()
  const [pending, setPending] = useState<string | null>(null)
  const toggle = (definition: Definition) => {
    setPending(definition.id)
    const enabled = !definition.enabled
    connection.call('enableDefinition', {
      params: { definitionId: definition.id }, body: { revision: definition.revision, enabled }, idempotencyKey: commandKey(),
    }).then(
      () => { toast(enabled ? t.definitions.enabled(definition.title) : t.definitions.paused(definition.title)) },
      (error: unknown) => { toast(`${t.definitions.toggleFailed}：${failureText(describeFailure(error), t)}`, 'error') },
    ).finally(() => { setPending(null); onChanged() })
  }
  return { pending, toggle }
}

/** Description line of a definition row.
 * @param definition - definition.
 * @param t - copy.
 * @returns schedule, next trigger, code and revision.
 */
export function definitionDescription(definition: Definition, t: Messages): string {
  const next = definition.availability === 'active' && definition.nextDueAt !== null
    ? ` · ${t.definitions.next(formatTime(definition.nextDueAt, { weekdays: t.weekdays, today: t.time.today }))}` : ''
  return `${scheduleSummary(definition.config.schedule, t)}${next} · ${t.definitions.version(definition.codeVersion)} · ${t.definitions.revision(definition.revision)}`
}

/** Definitions page.
 * @returns main element.
 */
export function DefinitionsPage() {
  const t = useT()
  const { openTrigger } = useApp()
  const { navigate } = useRouter()
  const { definitions } = useShared()
  const { pending, toggle } = useEnableToggle(definitions.reload)
  const items = definitions.value ?? []
  const installed = items.filter(definition => definition.installed)
  const uninstalled = items.filter(definition => !definition.installed)
  return (
    <main className="tw-main tw-gap-28">
      <PageHeader title={t.definitions.title} subtitle={t.definitions.subtitle}
        actions={<IconButton label={t.common.refresh} tone="caption" icon={<IconRefreshOutlineRegular size={16} />} onClick={definitions.reload} />} />
      {definitions.error !== undefined && <Notice kind="error" title={t.common.loadFailed}>{failureText(definitions.error, t)}</Notice>}
      {definitions.value !== undefined && items.length === 0 && (
        <EmptyState icon={<IconListPenOutlineRegular size={20} />} title={t.definitions.empty}>{t.definitions.emptyBody}</EmptyState>
      )}
      {installed.length > 0 && (
        <div className="tw-stack-8">
          <SectionTitle title={t.definitions.installed} count={installed.length} />
          <ul className="tw-definition-list">
            {installed.map(definition => (
              <li key={definition.id} className="tw-definition-row">
                <Link to={paths.definition(definition.id)} className="tw-definition-link">
                  <Tile><ScheduleIcon definition={definition} /></Tile>
                  <span className="tw-definition-text">
                    <span className="tw-definition-title">
                      <span>{definition.title}</span>
                      <Tag tone="neutral">{t.kind[definition.config.schedule.kind]}</Tag>
                      {definition.availability !== 'active' && <Tag tone={availabilityTone(definition.availability)}>{t.availability[definition.availability]}</Tag>}
                    </span>
                    <span className="tw-definition-desc">{definitionDescription(definition, t)}</span>
                    {definition.availability === 'blocked' && definition.reason !== null && (
                      <span className="tw-definition-blocked">{t.definitions.blockedLine}<span className="tw-mono">{definition.reason}</span> · {t.definitions.blockedFix}</span>
                    )}
                  </span>
                </Link>
                {definition.config.schedule.kind === 'manual' && definition.enabled && (
                  <Button variant="outline" size="sm" icon={<IconPlayOutlineRegular size={14} />} onClick={() => { openTrigger(definition.id) }}>{t.definitions.trigger}</Button>
                )}
                <Switch checked={definition.enabled} disabled={pending === definition.id || definition.availability === 'retiring'}
                  label={definition.enabled ? t.definitions.pause(definition.title) : t.definitions.enable(definition.title)}
                  onChange={() => { toggle(definition) }} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {uninstalled.length > 0 && (
        <div className="tw-stack-8">
          <SectionTitle title={t.definitions.uninstalled} count={uninstalled.length} />
          <ul className="tw-definition-list">
            {uninstalled.map(definition => (
              <li key={definition.id} className="tw-definition-row">
                <Link to={paths.definition(definition.id)} className="tw-definition-link">
                  <Tile muted><ScheduleIcon definition={definition} /></Tile>
                  <span className="tw-definition-text">
                    <span className="tw-definition-title tw-secondary-text">
                      <span>{definition.title}</span>
                      <Tag tone="neutral">{t.kind[definition.config.schedule.kind]}</Tag>
                      <Tag tone={availabilityTone(definition.availability)}>{t.availability[definition.availability]}</Tag>
                    </span>
                    <span className="tw-definition-desc">{t.definitions.retiredLine(t.definitions.keptRuns, definition.codeVersion)}</span>
                  </span>
                </Link>
                <Button variant="outline" size="sm" onClick={() => { navigate(paths.runs({ definitionId: definition.id })) }}>{t.definitions.history}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  )
}
