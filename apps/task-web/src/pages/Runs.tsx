/** Run history: status, kind, definition, business key and time filters over cursor pages. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Menu, IconChevronDownOutlineRegular, IconQueueOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular,
  Pill, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { ACTIVE_STATUS_QUERY, useApp, useShared } from '../app/context.tsx'
import { describeFailure, isProblem, type RequestFailure } from '../lib/connection.ts'
import { definitionTitle, failureText, shortId } from '../lib/format.ts'
import { Link, paths, useRouter } from '../lib/router.tsx'
import { RUN_KINDS, RUN_STATUSES, type Run, type RunKind, type RunStatus } from '../lib/types.ts'
import { EmptyState, IconButton, Notice, PageHeader, Segmented, Select, StatusInline, Time } from '../components/ui.tsx'

/** Filters fixed by the embedding page. */
export interface FixedRunFilters {
  readonly definitionId?: string
  readonly parentRunId?: string
}

type Range = 'day' | 'week' | 'month' | 'all'
const RANGE_MS: Record<Range, number | null> = { day: 86400000, week: 7 * 86400000, month: 30 * 86400000, all: null }
const PRIMARY_STATUSES: readonly RunStatus[] = ['running', 'waiting_input', 'blocked', 'queued', 'succeeded', 'failed']
const PAGE_SIZE = '50'

/** Runs page with editable filters stored in the address.
 * @returns main element.
 */
export function RunsPage() {
  const t = useT()
  return (
    <main className="tw-main tw-gap-16">
      <PageHeader title={t.runs.title} subtitle={t.runs.subtitle} />
      <RunList fixed={{}} />
    </main>
  )
}

/** Filtered Run table with live change notice and cursor pagination.
 * @param props.fixed - filters owned by the embedding page.
 * @returns filters, table and footer.
 */
export function RunList({ fixed }: { fixed: FixedRunFilters }) {
  const t = useT()
  const { connection, events } = useApp()
  const { definitions } = useShared()
  const { route, navigate } = useRouter()
  const embedded = fixed.definitionId !== undefined || fixed.parentRunId !== undefined
  const [localQuery, setLocalQuery] = useState(() => new URLSearchParams())
  const query = embedded ? localQuery : route.query
  const status = query.get('status') ?? 'all'
  const kind = (query.get('kind') ?? 'all') as RunKind | 'all'
  const definitionId = fixed.definitionId ?? query.get('definitionId') ?? ''
  const businessKey = query.get('businessKey') ?? ''
  const range = (query.get('range') ?? 'all') as Range
  const [keyDraft, setKeyDraft] = useState(businessKey)
  const [rows, setRows] = useState<readonly Run[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<RequestFailure | undefined>()
  const [restarted, setRestarted] = useState(false)
  const [fresh, setFresh] = useState({ created: 0, changed: 0 })
  const [generation, setGeneration] = useState(0)
  const [moreOpen, setMoreOpen] = useState(false)
  const shown = useRef<readonly Run[]>([])
  shown.current = rows

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '' || value === 'all') next.delete(key)
      else next.set(key, value)
    }
    if (embedded) setLocalQuery(next)
    else navigate(`${paths.runs()}${next.toString() === '' ? '' : `?${next.toString()}`}`, { replace: true })
  }

  const filters = useMemo(() => {
    const out: Record<string, string> = { limit: PAGE_SIZE }
    if (status === 'active') out['status'] = ACTIVE_STATUS_QUERY
    else if (status !== 'all') out['status'] = status
    if (kind !== 'all') out['kind'] = kind
    if (definitionId !== '') out['definitionId'] = definitionId
    if (fixed.parentRunId !== undefined) out['parentRunId'] = fixed.parentRunId
    if (businessKey !== '') out['businessKey'] = businessKey
    const span = RANGE_MS[range]
    if (span !== null) out['createdFrom'] = new Date(Date.now() - span).toISOString()
    return out
    // `generation` recomputes createdFrom on explicit reloads.
  }, [status, kind, definitionId, fixed.parentRunId, businessKey, range, generation])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setFailure(undefined)
    setFresh({ created: 0, changed: 0 })
    connection.call('listRuns', { query: filters, signal: controller.signal }).then((page) => {
      setRows(page.items)
      setCursor(page.nextCursor)
      setLoading(false)
    }, (error: unknown) => {
      if (controller.signal.aborted) return
      setFailure(describeFailure(error))
      setLoading(false)
    })
    return () => { controller.abort() }
  }, [connection, filters])

  useEffect(() => events.subscribe((signal) => {
    if (signal.kind !== 'event') return
    const { event, runId } = signal.event
    if (event === 'run.reserved' && !shown.current.some(run => run.id === runId)) setFresh(value => ({ ...value,
      created: value.created + 1 }))
    else if (runId !== null && shown.current.some(run => run.id === runId)
      && /^(run|stage|cancel|cleanup)\./.test(event)) setFresh(value => ({ ...value, changed: value.changed + 1 }))
  }), [events])

  const loadMore = () => {
    if (cursor === null) return
    setLoading(true)
    connection.call('listRuns', { query: { ...filters, cursor } }).then((page) => {
      setRows(current => [...current, ...page.items.filter(item => !current.some(existing => existing.id === item.id))])
      setCursor(page.nextCursor)
    }, (error: unknown) => {
      if (isProblem(error, 'cursor_stale', 'invalid_cursor')) { setRestarted(true); setGeneration(value => value + 1); return }
      setFailure(describeFailure(error))
    }).finally(() => { setLoading(false) })
  }
  const reload = () => { setRestarted(false); setGeneration(value => value + 1) }
  const extraStatuses = RUN_STATUSES.filter(item => !PRIMARY_STATUSES.includes(item))
  const definitionOptions = [{ value: '', label: t.runs.allTasks }, ...(definitions.value ?? []).map(item => ({ value: item.id,
    label: item.title }))]
  return (
    <div className="tw-stack-16">
      <div className="tw-stack-12">
        <div className="tw-filter-pills">
          <Pill active={status === 'all'} onClick={() => { update({ status: null }) }}>{t.runs.all}</Pill>
          {fixed.parentRunId === undefined && <Pill active={status === 'active'}
            onClick={() => { update({ status: 'active' }) }}>{t.runs.active}</Pill>}
          {PRIMARY_STATUSES.map(item => <Pill key={item} active={status === item}
            onClick={() => { update({ status: item }) }}>{t.status[item]}</Pill>)}
          <Menu open={moreOpen} onClose={() => { setMoreOpen(false) }} portal selectedId={status}
            items={extraStatuses.map(item => ({ id: item, label: t.status[item] }))}
            onSelect={(item) => { setMoreOpen(false); update({ status: item }) }}
            anchor={<Pill active={extraStatuses.includes(status as RunStatus)} onClick={() => { setMoreOpen(open => !open) }}>
              {extraStatuses.includes(status as RunStatus) ? t.status[status as RunStatus]
                : t.runs.moreStatus}<IconChevronDownOutlineRegular size={12} /></Pill>} />
        </div>
        <div className="tw-filter-row">
          <Segmented label={t.runs.kindLabel} value={kind} onChange={(value) => { update({ kind: value }) }}
            items={[{ value: 'all' as const, label: t.runs.all }, ...RUN_KINDS.map(item => ({ value: item, label: t.kind[item] }))]} />
          <span className="tw-flex" />
          {fixed.definitionId === undefined && (
            <Select label={t.runs.definitionLabel} width={168} value={definitionId} options={definitionOptions}
              onChange={(value) => { update({ definitionId: value }) }} />
          )}
          <div className="tw-key-filter">
            <Input icon={<IconSearchOutlineRegular size={16} />} placeholder={t.runs.businessKey} aria-label={t.runs.businessKey}
              value={keyDraft}
              onChange={(event) => { setKeyDraft(event.target.value) }}
              onKeyDown={(event) => { if (event.key === 'Enter'
                && !event.nativeEvent.isComposing) { event.preventDefault(); update({ businessKey: keyDraft.trim() }) } }}
              onBlur={() => { if (keyDraft.trim() !== businessKey) update({ businessKey: keyDraft.trim() }) }} />
          </div>
          <Select label={t.runs.created} width={136} value={range} onChange={(value) => { update({ range: value }) }}
            options={(['day', 'week', 'month', 'all'] as const).map(item => ({ value: item, label: t.runs.ranges[item] }))} />
          <IconButton label={t.common.refresh} tone="caption" icon={<IconRefreshOutlineRegular size={16} />} onClick={reload} />
        </div>
      </div>
      {(fresh.created > 0 || fresh.changed > 0) && (
        <div className="tw-fresh" role="status">
          <span className="tw-inline-flex tw-gap-8">{t.runs.fresh(fresh.created, fresh.changed)}</span>
          <button type="button" className="tw-text-button" onClick={reload}>{t.runs.reloadList}</button>
        </div>
      )}
      {restarted && <Notice kind="warning" title={t.runs.restarted}>{t.runs.restartedBody}</Notice>}
      {failure !== undefined && <Notice kind="error" title={t.common.loadFailed}>{failureText(failure, t)}</Notice>}
      <div className="tw-run-table" role="table" aria-label={t.runs.title}>
        <div className="tw-run-table-head" role="row">
          <span role="columnheader" className="tw-col-status">{t.runs.columns.status}</span>
          <span role="columnheader" className="tw-col-run">{t.runs.columns.run}</span>
          <span role="columnheader" className="tw-col-task">{t.runs.columns.task}</span>
          <span role="columnheader" className="tw-col-source">{t.runs.columns.source}</span>
          <span role="columnheader" className="tw-col-time">{t.runs.columns.created}</span>
          <span role="columnheader" className="tw-col-time">{t.runs.columns.updated}</span>
          <span role="columnheader" className="tw-col-cleanup">{t.runs.columns.cleanup}</span>
        </div>
        <div role="rowgroup" className="tw-run-table-body">
          {rows.map(run => (
            <Link key={run.id} to={paths.run(run.id)} className="tw-run-table-row" role="row">
              <span role="cell" className="tw-col-status"><StatusInline status={run.status} /></span>
              <span role="cell" className="tw-col-run">
                <span className="tw-run-name">{run.businessKey ?? t.runs.execution(t.kind[run.kind])}</span>
                {run.kind !== 'ordinary' && <Tag tone="neutral">{t.kind[run.kind]}</Tag>}
                <span className="tw-mono tw-muted-text">{shortId(run.id)}</span>
              </span>
              <span role="cell" className="tw-col-task tw-ellipsis">{definitionTitle(definitions.value, run.definitionId)}</span>
              <span role="cell" className="tw-col-source tw-mono tw-muted-text">{run.parentRunId === null ? ''
                : t.runs.pollSource(shortId(run.parentRunId))}</span>
              <span role="cell" className="tw-col-time"><Time value={run.createdAt} /></span>
              <span role="cell" className="tw-col-time"><Time value={run.updatedAt} /></span>
              <span role="cell" className={run.cleanup === 'blocked' ? 'tw-col-cleanup tw-danger-text' : 'tw-col-cleanup tw-muted-text'}>
                {run.cleanup === 'complete' ? '' : t.cleanup[run.cleanup]}</span>
            </Link>
          ))}
        </div>
        {!loading && rows.length === 0 && failure === undefined && (
          <EmptyState icon={<IconQueueOutlineRegular size={20} />} title={t.runs.empty}>{t.runs.emptyBody}</EmptyState>
        )}
      </div>
      <div className="tw-table-foot">
        <span>{loading ? t.common.loading : t.runs.count(rows.length)}</span>
        {cursor !== null
          ? <Button variant="outline" size="sm" disabled={loading} onClick={loadMore}>{t.runs.loadMore}</Button>
          : rows.length > 0 && <span>{t.runs.end}</span>}
      </div>
    </div>
  )
}
