/** Inbox: waiting business replies, tool approvals and Agent questions across Runs. */
import { useState } from 'react'
import { IconQuestionOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { useShared } from '../app/context.tsx'
import { definitionTitle, failureText, runName } from '../lib/format.ts'
import { Link, paths } from '../lib/router.tsx'
import type { Interaction } from '../lib/types.ts'
import { EmptyState, IconButton, Notice, PageHeader, Segmented, StatusMark } from '../components/ui.tsx'
import { InteractionCard } from '../components/Interaction.tsx'

type Filter = 'all' | Interaction['source']

/** Inbox page.
 * @returns main element.
 */
export function InboxPage() {
  const t = useT()
  const { interactions, active, definitions } = useShared()
  const [filter, setFilter] = useState<Filter>('all')
  const items = interactions.value ?? []
  const count = (source: Interaction['source']) => items.filter(item => item.source === source).length
  const shown = items.filter(item => filter === 'all' || item.source === filter)
  const refresh = () => { interactions.reload(); active.reload() }
  return (
    <main className="tw-main tw-gap-20">
      <PageHeader title={t.inbox.title} subtitle={t.inbox.subtitle}
        actions={<IconButton label={t.common.refresh} tone="caption" icon={<IconRefreshOutlineRegular size={16} />} onClick={refresh} />} />
      <div>
        <Segmented label={t.inbox.filter} value={filter} onChange={setFilter} items={[
          { value: 'all', label: t.inbox.all(items.length) },
          { value: 'business', label: t.inbox.of(t.source.business, count('business')) },
          { value: 'tool_approval', label: t.inbox.of(t.source.tool_approval, count('tool_approval')) },
          { value: 'agent_question', label: t.inbox.of(t.source.agent_question, count('agent_question')) },
        ]} />
      </div>
      {interactions.error !== undefined && <Notice kind="error" title={t.common.loadFailed}>{failureText(interactions.error, t)}</Notice>}
      {interactions.value !== undefined && shown.length === 0 && (
        <EmptyState icon={<IconQuestionOutlineRegular size={20} />} title={t.inbox.empty}>{t.inbox.emptyBody}</EmptyState>
      )}
      <div className="tw-stack-20">
        {shown.map((item) => {
          const run = active.value?.find(candidate => candidate.id === item.runId)
          const name = run === undefined ? item.runId.slice(0, 8) : runName(run, t)
          return (
            <div key={`${item.id}:${item.revision}`} className="tw-stack-8">
              <div className="tw-inbox-head">
                {run !== undefined && <StatusMark status={run.status} />}
                <Link to={paths.run(item.runId)} className="tw-strong tw-link-quiet">{name}</Link>
                {run !== undefined && <span className="tw-muted-text">{definitionTitle(definitions.value, run.definitionId)}</span>}
                <span className="tw-flex" />
                <Link to={paths.run(item.runId)} className="tw-link">{t.interaction.openRun}</Link>
              </div>
              <InteractionCard interaction={item} runName={name} onDone={refresh} />
            </div>
          )
        })}
      </div>
    </main>
  )
}
