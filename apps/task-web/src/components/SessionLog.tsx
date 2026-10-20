/** Raw Session events of a Run: rows grouped by turn, step and stream block, a type filter and the stored JSON of a selected row. */
import { useMemo, useState } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconCodeOutlineRegular, IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { elapsed, failureText } from '../support/format.ts'
import { buildLogTree, flattenLog, openByDefault, type LogNode, type SessionLogFeed } from '../support/session-log.ts'
import type { Run } from '../support/types.ts'
import { CopyButton, EmptyState, Notice, Spinner } from './ui.tsx'

/** Time of a row in UTC with milliseconds, as stored. */
function clock(iso: string): string {
  return iso.slice(11, 23)
}

/** Session log view.
 * @param props.feed - loaded events and paging actions from `useSessionLog`.
 * @param props.run - execution, for the live activity line.
 * @param props.working - the Agent is working; the log ends with its activity line.
 * @returns toolbar, rows and the detail of the selected row.
 */
export function SessionLogView({ feed, run, working = false }: {
  feed: SessionLogFeed
  run?: Pick<Run, 'createdAt'>
  working?: boolean
}) {
  const t = useT()
  const copy = t.run.sessionLog
  const [filter, setFilter] = useState('')
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const roots = useMemo(() => buildLogTree(feed.entries), [feed.entries])
  const { rows, matches } = useMemo(() => flattenLog(roots, toggled, filter), [roots, toggled, filter])
  const toggle = (node: LogNode) => {
    setToggled((current) => {
      const next = new Set(current)
      if (next.has(node.key)) next.delete(node.key)
      else next.add(node.key)
      return next
    })
  }
  const foldAll = (open: boolean) => {
    const keys = new Set<string>()
    const visit = (node: LogNode) => {
      if (node.children.length > 0 && openByDefault(node) !== open) keys.add(node.key)
      node.children.forEach(visit)
    }
    roots.forEach(visit)
    setToggled(keys)
  }

  if (feed.status === 'disabled')
    return <Notice kind="info" title={copy.disabledTitle}>{copy.disabledBody}</Notice>
  if (feed.status === 'pending') return <EmptyState icon={<IconCodeOutlineRegular size={20} />} title={copy.pendingTitle}>{copy.pendingBody}</EmptyState>
  if (feed.status === 'loading') return <div className="tw-log-loading"><Spinner /> {copy.loading}</div>
  return (
    <div className="tw-log">
      {feed.status === 'failed' && (
        <Notice kind="warning" title={copy.failed}
          actions={<Button variant="outline" size="sm" onClick={feed.reload}>{t.run.retryNow}</Button>}>
          {failureText(feed.failure, t)}
        </Notice>
      )}
      <div role="toolbar" aria-label={copy.label} className="tw-traj-toolbar tw-log-toolbar">
        <div className="tw-traj-actions">
          <button type="button" className="tw-traj-button" onClick={() => { foldAll(true) }}>
            <IconChevronDownOutlineRegular size={12} />{copy.expandAll}
          </button>
          <button type="button" className="tw-traj-button" onClick={() => { foldAll(false) }}>
            <IconChevronRightOutlineRegular size={12} />{copy.collapseAll}
          </button>
          <button type="button" className="tw-traj-button" aria-label={copy.reload} title={copy.reload} onClick={feed.reload}>
            <IconRefreshOutlineRegular size={12} />
          </button>
          <span className="tw-log-count">{filter.trim() === '' ? copy.count(feed.entries.length) : copy.matches(matches)}</span>
        </div>
        <label className="tw-traj-search">
          <IconSearchOutlineRegular size={14} />
          <input type="search" className="tw-input" aria-label={copy.filter} placeholder={copy.filterPlaceholder} value={filter}
            onChange={(event) => { setFilter(event.target.value) }} />
        </label>
      </div>
      {rows.length === 0
        ? <EmptyState icon={<IconCodeOutlineRegular size={20} />} title={filter.trim() === '' ? copy.empty : copy.noMatch} />
        : (
          <div role="tree" aria-label={copy.label} className="tw-log-rows">
            {rows.map(({ node, depth, context, open }) => (
              <div key={node.key} role="treeitem" aria-level={depth + 1} aria-selected={selected === node.key}
                aria-expanded={node.children.length > 0 ? open : undefined}>
                <div className="tw-log-row" data-context={context ? '' : undefined} data-selected={selected === node.key ? '' : undefined}
                  data-group={node.group ?? undefined}
                  onClick={() => { setSelected(current => (current === node.key ? null : node.key)) }}>
                  <span className="tw-log-seq">{node.sequence ?? ''}</span>
                  <span className="tw-log-time" title={node.at}>{clock(node.at)}</span>
                  <span className="tw-log-name" style={{ paddingLeft: depth * 14 }}>
                    {node.children.length > 0
                      ? (
                        <button type="button" className="tw-traj-fold" aria-label={open ? copy.collapse : copy.expand}
                          onClick={(event) => { event.stopPropagation(); toggle(node) }}>
                          {open ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronRightOutlineRegular size={12} />}
                        </button>
                      )
                      : <span className="tw-log-spacer" />}
                    <span className="tw-log-type" title={node.type}>{node.type}</span>
                  </span>
                  <span className="tw-log-summary">{node.summary}</span>
                </div>
                {selected === node.key && (
                  <div className="tw-log-detail">
                    <CopyButton text={JSON.stringify(node.value, null, 2)} label={copy.copyJson} />
                    <pre>{JSON.stringify(node.value, null, 2)}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      {feed.hasMore && (
        <div className="tw-log-more">
          <Button variant="outline" size="sm" disabled={feed.busy} onClick={feed.loadMore}>{copy.loadMore}</Button>
        </div>
      )}
      {working && run !== undefined && <div className="tw-working"><Spinner tone="deep" /><span>{t.run.working(elapsed(run.createdAt, t))}</span></div>}
    </div>
  )
}
