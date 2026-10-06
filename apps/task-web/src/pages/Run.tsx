/** Run detail: conversation and trajectory, interactions, result, attachments, lineage and the right sidebar. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconChecklistOutlineRegular, IconEllipsisOutlineRegular, IconPaperclipOutlineRegular, IconQuestionOutlineRegular,
  IconQueueOutlineRegular, IconRefreshOutlineRegular, IconSendOutlineRegular, IconStopFillRegular, IconWarningOutlineRegular,
  Menu, Modal, Tag, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useT, type Messages } from '../i18n/index.ts'
import { useApp, useShared } from '../app/context.tsx'
import { commandKey, describeFailure } from '../support/connection.ts'
import { definitionTitle, failureText, formatTime, runName, shortId } from '../support/format.ts'
import { useResource } from '../support/resource.ts'
import { Link, paths, useRouter } from '../support/router.tsx'
import { useStickToBottom } from '../support/scroll.ts'
import type { DetailTab } from '../support/presentation.ts'
import { useRunSidebar } from '../support/sidebar.ts'
import { useTranscript } from '../support/transcript.ts'
import { buildTrajectory } from '../support/trajectory.ts'
import { acceptsInput, type Attachment, type Json, type Run, type RunInput } from '../support/types.ts'
import {
  Card, CopyButton, Dot, EmptyState, KeyValue, Mono, Notice, StatusMark, StatusTag, Tabs, Time,
} from '../components/ui.tsx'
import { MetaLine, Transcript } from '../components/Transcript.tsx'
import { RecordDetail } from '../components/RecordDetail.tsx'
import { Sidebar, SidebarToggle, type SidebarTab } from '../components/Sidebar.tsx'
import { TrajectoryView } from '../components/Trajectory.tsx'
import { InteractionCard } from '../components/Interaction.tsx'
import { ResultView } from '../components/Result.tsx'
import { AttachmentsPanel, useUpload } from '../components/Attachments.tsx'
import { hasFormControls, SchemaForm, schemaDefault } from '../components/SchemaForm.tsx'

type Tab = 'session' | 'interactions' | 'result' | 'files' | 'lineage'

/** How the Session tab shows the stored messages. */
type SessionView = 'chat' | 'trajectory'

/** Tabs of the right sidebar; the record tab exists while a trajectory record is selected. */
type SideTab = 'status' | 'record'

const NO_INPUTS: readonly RunInput[] = []

/** Consecutive failed reads before the Session tab names the failure; the first one is a routine reconnect. */
const STREAM_FAILURES_BEFORE_NOTICE = 2

/** Tallest the supplemental input grows, in px, before it scrolls. */
const COMPOSER_MAX_PX = 240

/** Run detail page.
 * @param props.id - Run identity.
 * @returns page body.
 */
export function RunPage({ id }: { id: string }) {
  const t = useT()
  const { connection } = useApp()
  const { navigate } = useRouter()
  const run = useResource(`run:${id}`, signal => connection.call('getRun', { params: { runId: id }, signal }),
    { affects: runId => runId === id })
  if (run.value === undefined) {
    if (run.error?.kind === 'problem' && run.error.code === 'not_found') {
      return (
        <main className="tw-main">
          <EmptyState icon={<IconQueueOutlineRegular size={20} />} title={t.run.notFound}
            action={<Button variant="outline" size="sm"
              onClick={() => { navigate(paths.runs()) }}>{t.run.backToRuns}</Button>}>{t.run.notFoundBody}</EmptyState>
        </main>
      )
    }
    return <main className="tw-main">{run.error === undefined ? <p className="tw-muted-line">{t.common.loading}</p> : <Notice kind="error"
      title={t.common.loadFailed}>{failureText(run.error, t)}</Notice>}</main>
  }
  return <RunDetail key={id} run={run.value} reload={run.reload} />
}

function defaultTab(run: Run): Tab {
  if (run.terminalAt !== null && run.kind === 'polling') return 'lineage'
  if (run.terminalAt !== null) return 'result'
  return 'session'
}

function startLabel(run: Run, t: Messages): string {
  const time = formatTime(run.createdAt)
  if (run.occurrence !== null) {
    const missed = run.occurrence.missed
    if (missed !== null) return t.run.coalesced(formatTime(run.occurrence.scheduledAt), formatTime(missed.from),
      formatTime(missed.through), missed.count)
    return t.run.triggered(formatTime(run.occurrence.scheduledAt))
  }
  return t.run.runStarted(time)
}

function RunDetail({ run, reload }: { run: Run; reload: () => void }) {
  const t = useT()
  const { connection, toast, openSettings } = useApp()
  const shared = useShared()
  const { navigate } = useRouter()
  const [tab, setTab] = useState<Tab>(() => defaultTab(run))
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'cancel' | 'cleanup' } | null>(null)
  const [menu, setMenu] = useState(false)
  const transcript = useTranscript(run)
  const interactions = useResource(`run-interactions:${run.id}`, async signal => (await connection.call('listInteractions',
    { params: { runId: run.id }, signal })).items,
  { affects: runId => runId === run.id })
  const inputs = useResource(`run-inputs:${run.id}`, async signal => (await connection.call('listInputs',
    { params: { runId: run.id }, signal })).items, { affects: runId => runId === run.id })
  const attachments = useResource(`attachments:${run.id}`, () => connection.guard(() => connection.client.attachments(run.id)),
    { affects: runId => runId === run.id })
  const scroller = useRef<HTMLDivElement | null>(null)
  const sidebar = useRunSidebar()
  const [view, setView] = useState<SessionView>('chat')
  const [selection, setSelection] = useState<{ readonly id: string; readonly tab: DetailTab } | null>(null)
  const [sideTab, setSideTab] = useState<SideTab>('status')
  const toggle = useRef<HTMLButtonElement | null>(null)
  const activeSideTab = useRef<HTMLButtonElement | null>(null)
  const focusAfter = useRef<'toggle' | 'sidebar' | null>(null)
  const definition = shared.definitions.value?.find(item => item.id === run.definitionId)
  const name = run.businessKey ?? `${t.runs.execution(t.kind[run.kind])} · ${formatTime(run.createdAt)}`
  const waiting = (interactions.value ?? []).filter(item => run.terminalAt === null && item.runId === run.id)
  const ended = run.terminalAt !== null
  const cleanupBlocked = run.cleanup === 'blocked'
  const canCancel = !ended && run.status !== 'cancelling' && !cleanupBlocked
  const open = acceptsInput(run)
  const working = !ended && (run.status === 'running' || run.status === 'provisioning' || run.status === 'recovering')
  const files = attachments.value ?? []
  const lastMessage = transcript.entries.at(-1)
  const chatting = tab === 'session' && view === 'chat'
  useStickToBottom(scroller, `${lastMessage?.sequence ?? 0}:${inputs.value?.length ?? 0}:${waiting.map(item => `${item.id}:${item.revision}`).join()}`,
    chatting)
  const selectedId = selection?.id ?? null
  const needsTrajectory = selectedId !== null || (tab === 'session' && view === 'trajectory')
  const trajectory = useMemo(
    () => (needsTrajectory ? buildTrajectory(transcript.entries, inputs.value ?? NO_INPUTS, transcript.requests) : undefined),
    [needsTrajectory, transcript.entries, transcript.requests, inputs.value])
  const activeSide: SideTab = selectedId !== null && sideTab === 'record' ? 'record' : 'status'
  const sideTabs: readonly SidebarTab<SideTab>[] = [
    { id: 'status', label: t.run.sidebar.status },
    ...(selectedId === null ? [] : [{ id: 'record' as const, label: t.run.sidebar.event, closeLabel: t.run.sidebar.closeEvent }]),
  ]
  // Focus follows an explicit open or collapse; selecting a trajectory row opens the sidebar without taking focus from the table.
  useEffect(() => {
    const wanted = focusAfter.current
    if (wanted === 'sidebar' && sidebar.open) activeSideTab.current?.focus()
    else if (wanted === 'toggle' && !sidebar.open) toggle.current?.focus()
    else return
    focusAfter.current = null
  }, [sidebar.open])
  const expandSidebar = () => { focusAfter.current = 'sidebar'; sidebar.setOpen(true) }
  const collapseSidebar = () => { focusAfter.current = 'toggle'; sidebar.setOpen(false) }
  const { setOpen: setSidebarOpen } = sidebar
  // The tab stays while the reader moves between records, so comparing the timing of two tool calls takes one click each.
  const selectRecord = useCallback((id: string, detailTab?: DetailTab) => {
    setSelection(current => ({ id, tab: detailTab ?? current?.tab ?? 'overview' }))
    setSideTab('record')
    setSidebarOpen(true)
  }, [setSidebarOpen])
  const selectDetailTab = (detailTab: DetailTab) => {
    setSelection(current => (current === null ? null : { id: current.id, tab: detailTab }))
  }
  const closeRecord = () => { setSelection(null); setSideTab('status') }
  const callArguments = (callId: string | null) => {
    if (callId === null) return undefined
    for (const entry of transcript.entries) for (const block of entry.blocks) if (block.kind === 'tool_call'
      && block.callId === callId) return block.arguments
    return undefined
  }
  const refreshAll = () => {
    reload(); interactions.reload(); inputs.reload(); attachments.reload(); shared.interactions.reload(); shared.active.reload()
  }

  const cancel = () => {
    setConfirmCancel(false)
    connection.call('cancelRun', { params: { runId: run.id }, idempotencyKey: commandKey() })
      .then(() => { setNotice({ kind: 'cancel' }); refreshAll() },
        (error: unknown) => { toast(`${t.run.cancelFailed}：${failureText(describeFailure(error), t)}`, 'error') })
  }
  const retryCleanup = () => {
    connection.call('retryCleanup', { params: { runId: run.id }, idempotencyKey: commandKey() })
      .then(() => { setNotice({ kind: 'cleanup' }); refreshAll() },
        (error: unknown) => { toast(`${t.run.cleanupFailed}：${failureText(describeFailure(error), t)}`, 'error') })
  }
  const outcomeLabel = t.status[run.outcome ?? 'failed']
  const column = clsx('tw-run-column', tab === 'session' && view === 'trajectory' && 'tw-run-column-wide')
  const tabs: { value: Tab; label: string; count?: number | undefined }[] = [
    { value: 'session', label: t.run.tabs.session },
    { value: 'interactions', label: t.run.tabs.interactions, count: waiting.length || undefined },
    { value: 'result', label: t.run.tabs.result },
    { value: 'files', label: t.run.tabs.files, count: files.length || undefined },
    { value: 'lineage', label: t.run.tabs.lineage },
  ]
  const ordered = ended ? [...tabs.filter(item => item.value === defaultTab(run)), ...tabs.filter(item => item.value !== defaultTab(run))]
    : tabs

  return (
    <div className="tw-run-page">
      <header className="tw-run-header">
        <div className="tw-run-header-left">
          <Link to={paths.runs()} className="tw-link-quiet">{t.nav.runs}</Link><span className="tw-crumb-sep">›</span>
          <Link to={paths.definition(run.definitionId)} className="tw-link-quiet">{definitionTitle(shared.definitions.value,
            run.definitionId)}</Link><span className="tw-crumb-sep">›</span>
          <h1 className="tw-run-title">{name}</h1>
          <StatusTag status={run.status} />
          <Tag tone="outline">{t.kind[run.kind]}</Tag>
        </div>
        <div className="tw-inline-flex tw-gap-8">
          {!sidebar.open && <SidebarToggle label={t.run.sidebar.open} onClick={expandSidebar} buttonRef={toggle} />}
          {canCancel && <Button variant="outline" size="sm" className="tw-page-button tw-danger-button" icon={<IconStopFillRegular
            size={14} />} onClick={() => { setConfirmCancel(true) }}>{t.run.cancel}</Button>}
          {cleanupBlocked && <Button variant="primary" size="sm" className="tw-page-button" icon={<IconRefreshOutlineRegular size={14} />}
            onClick={retryCleanup}>{t.run.retryCleanup}</Button>}
          <Menu open={menu} onClose={() => { setMenu(false) }} portal align="end"
            items={[{ id: 'run', label: t.run.copyRunId }, { id: 'session', label: t.run.copySessionId }, { id: 'definition',
              label: t.run.openDefinition }]}
            onSelect={(item) => {
              setMenu(false)
              if (item === 'run') void writeClipboard(run.id)
              else if (item === 'session') void writeClipboard(run.sessionId)
              else navigate(paths.definition(run.definitionId))
            }}
            anchor={<button type="button" className="tw-icon-button" aria-label={t.common.more}
              onClick={() => { setMenu(value => !value) }}><IconEllipsisOutlineRegular size={16} /></button>} />
        </div>
      </header>
      <div className="tw-run-body">
        <div className="tw-run-center">
          <div className="tw-run-tabs">
            <div className={clsx(column, 'tw-row-between')}>
              <Tabs label={t.run.tabsLabel} value={tab} onChange={setTab} items={ordered} />
              {!ended && (
                <span className="tw-inline-flex tw-muted-small">
                  <Dot state={transcript.state === 'live' ? 'done' : 'warning'} />
                  {transcript.state === 'live' ? t.run.sessionLive : transcript.state === 'pending' ? t.run.sessionPending
                    : transcript.state === 'reconnecting' ? t.run.sessionReconnecting : t.run.sessionConnecting}
                </span>
              )}
            </div>
            {tab === 'session' && (
              <div className={column}>
                <Tabs variant="underline" label={t.run.views.label} value={view} onChange={setView}
                  items={[{ value: 'chat', label: t.run.views.chat }, { value: 'trajectory', label: t.run.views.trajectory }]} />
              </div>
            )}
          </div>
          <div className="tw-run-scroll" ref={scroller}>
            <div className={clsx(column, 'tw-stack-16', 'tw-run-content')}>
              {notice?.kind === 'cancel' && !ended && <Notice kind="info" title={t.run.cancelAccepted}>{t.run.cancelAcceptedBody}</Notice>}
              {notice?.kind === 'cleanup' && !ended && <Notice kind="info"
                title={t.run.cleanupAccepted}>{t.run.cleanupAcceptedBody(outcomeLabel)}</Notice>}
              {tab === 'session' && (
                <>
                  {run.status === 'blocked' && !cleanupBlocked && (
                    <Banner title={t.run.blockedBanner} heading={run.reason ?? t.status.blocked}
                      steps={[t.run.blockedStep1, t.run.blockedStep2]}
                      actions={<Button variant="primary"
                        onClick={() => { openSettings('credentials') }}>{t.run.openCredentials}</Button>} />
                  )}
                  {cleanupBlocked && notice?.kind !== 'cleanup' && (
                    <Banner title={t.run.cleanupBanner(outcomeLabel)} heading={t.run.cleanupTitle}
                      steps={[t.run.cleanupStep1, t.run.cleanupStep2(outcomeLabel)]}
                      actions={<>
                        <Button variant="outline" onClick={() => { navigate(paths.diagnostics()) }}>{t.run.viewDiagnostics}</Button>
                        <Button variant="primary" icon={<IconRefreshOutlineRegular size={16} />}
                          onClick={retryCleanup}>{t.run.retryCleanup}</Button>
                      </>} />
                  )}
                  {run.status === 'waiting_retry' && run.retryAt !== null && (
                    <Notice kind="info" title={t.status.waiting_retry}>{run.reason ?? ''} {t.run.retrying(formatTime(run.retryAt))}</Notice>
                  )}
                  {transcript.failure !== undefined && transcript.failure.count >= STREAM_FAILURES_BEFORE_NOTICE && (
                    <Notice kind="warning" title={t.run.streamFailed}
                      actions={<Button variant="outline" size="sm" onClick={transcript.retry}>{t.run.retryNow}</Button>}>
                      {t.run.streamFailedBody(transcript.failure.error.kind === 'problem' ? failureText(transcript.failure.error, t)
                        : transcript.failure.error.detail)}
                    </Notice>
                  )}
                  {view === 'chat' || trajectory === undefined
                    ? <Transcript run={run} entries={transcript.entries} inputs={inputs.value ?? NO_INPUTS} working={working}
                      startLabel={startLabel(run, t)} />
                    : <TrajectoryView run={run} trajectory={trajectory} working={working} selectedId={selectedId}
                      onSelect={selectRecord} />}
                  {waiting.length > 0 && <MetaLine text={t.status.waiting_input} />}
                  {waiting.map(item => <InteractionCard key={`${item.id}:${item.revision}`} interaction={item} runName={name}
                    callArguments={callArguments(item.callId)} onDone={refreshAll} />)}
                </>
              )}
              {tab === 'interactions' && (
                waiting.length === 0
                  ? <EmptyState icon={<IconQuestionOutlineRegular size={20} />}
                    title={t.run.noInteractions}>{t.run.noInteractionsBody}</EmptyState>
                  : waiting.map(item => <InteractionCard key={`${item.id}:${item.revision}`} interaction={item} runName={name}
                    callArguments={callArguments(item.callId)} onDone={refreshAll} />)
              )}
              {tab === 'result' && <ResultTab run={run} attachments={files} />}
              {tab === 'files' && (
                <AttachmentsPanel run={run} items={files} canUpload={open} onChanged={attachments.reload}
                  closedText={run.outcome !== null && !ended ? t.run.files.closedOutcome : t.run.files.closed} />
              )}
              {tab === 'lineage' && <Lineage run={run} />}
            </div>
          </div>
          {open
            ? <Composer run={run} onSent={refreshAll} onUploaded={attachments.reload} />
            : <ReadonlyBar run={run} definitionNext={definition?.nextDueAt ?? null} />}
        </div>
        <Sidebar open={sidebar.open} covering={sidebar.covering} width={sidebar.width} tabs={sideTabs} active={activeSide}
          activeRef={activeSideTab} scrollKey={activeSide === 'record' ? `${selectedId ?? ''}:${selection?.tab ?? ''}` : activeSide} onSelect={setSideTab}
          onCloseTab={closeRecord} onCollapse={collapseSidebar} onResize={sidebar.setWidth}>
          {activeSide === 'record' && trajectory !== undefined && selection !== null
            ? <RecordDetail run={run} trajectory={trajectory} id={selection.id} tab={selection.tab} onSelect={selectRecord}
              onTab={selectDetailTab} />
            : <RunStatus run={run} definitionTitle={definitionTitle(shared.definitions.value, run.definitionId)}
              definitionRevision={definition?.revision} />}
        </Sidebar>
      </div>
      {confirmCancel && (
        <Modal open title={t.run.cancelConfirm} closeLabel={t.common.close} description={t.run.cancelBody} backdropBlur={false}
          onClose={() => { setConfirmCancel(false) }}
          footer={<>
            <Button variant="outline" onClick={() => { setConfirmCancel(false) }}>{t.common.cancel}</Button>
            <Button variant="primary" className="tw-danger-fill" onClick={cancel}>{t.run.cancel}</Button>
          </>} />
      )}
    </div>
  )
}

function Banner({ title, heading, steps, actions }: { title: string; heading: string; steps: readonly string[]; actions: ReactNode }) {
  return (
    <section className="tw-banner" role="status">
      <div className="tw-banner-strip"><IconWarningOutlineRegular size={14} /><span>{title}</span></div>
      <div className="tw-banner-body">
        <span className="tw-banner-heading">{heading}</span>
        <ol>{steps.map(step => <li key={step}>{step}</li>)}</ol>
        <div className="tw-banner-actions">{actions}</div>
      </div>
    </section>
  )
}

function ResultTab({ run, attachments }: { run: Run; attachments: readonly Attachment[] }) {
  const t = useT()
  if (run.terminalAt === null && run.outcome === null) {
    return <EmptyState icon={<IconChecklistOutlineRegular size={20} />} title={t.run.noResult}>{t.run.noResultBody}</EmptyState>
  }
  const status = run.outcome ?? run.status
  const kind = status === 'succeeded' ? 'success' : status === 'failed' ? 'error' : 'info'
  return (
    <>
      {run.terminalAt === null
        ? <Notice kind="error" title={t.run.outcomeRecorded(t.status[status as 'succeeded'])}>{t.run.outcomeRecordedBody}</Notice>
        : <Notice kind={kind}
          title={t.run.resultNotice(t.status[status as 'succeeded'])}>{t.run.resultEndedAt(formatTime(run.terminalAt))}</Notice>}
      {run.reason !== null && run.status !== 'succeeded' && <Card><p className="tw-result-text">{run.reason}</p></Card>}
      <ResultView run={run} attachments={attachments} />
    </>
  )
}

function Lineage({ run }: { run: Run }) {
  const t = useT()
  const { connection } = useApp()
  const { definitions } = useShared()
  const parentId = run.parentRunId
  const parent = useResource(parentId === null ? null : `run:${parentId}`, signal => connection.call('getRun',
    { params: { runId: parentId ?? '' }, signal }), { live: false })
  const related = useResource(`children:${parentId ?? run.id}`, async signal => (await connection.call('listRuns',
    { query: { parentRunId: parentId ?? run.id, limit: '200' }, signal })).items,
  { affects: (_runId, event) => event === 'run.reserved' || event === 'run.ended' })
  if (run.kind === 'ordinary') {
    const siblings = (related.value ?? []).filter(item => item.id !== run.id)
    return (
      <>
        <Card>
          <div className="tw-stack-8">
            <span className="tw-muted-small">{t.run.lineage.source}</span>
            <div className="tw-inline-flex tw-gap-10">
              {parentId === null ? <span>{t.common.none}</span> : (
                <>
                  <Link to={paths.run(parentId)} className="tw-link">{parent.value === undefined ? shortId(parentId)
                    : `${t.kind[parent.value.kind]} · ${t.run.lineage.pollRun(formatTime(parent.value.createdAt))}`}</Link>
                  <span className="tw-muted-small">{t.run.lineage.dispatched}</span>
                </>
              )}
            </div>
          </div>
        </Card>
        <Card>
          <span className="tw-muted-small">{t.run.lineage.siblings}</span>
          {siblings.length === 0 && <p className="tw-muted-line">{t.run.lineage.noSiblings}</p>}
          {siblings.map(item => <LineageRow key={item.id} run={item} title={definitionTitle(definitions.value, item.definitionId)} />)}
        </Card>
      </>
    )
  }
  const children = related.value ?? []
  return (
    <>
      <Card>
        <div className="tw-section-title"><div className="tw-section-title-left"><h2>{t.run.lineage.children}</h2><span
          className="tw-caption">{children.length}</span></div></div>
        {children.length === 0 && <p className="tw-muted-line">{t.run.lineage.noChildren}</p>}
        {children.map(item => <LineageRow key={item.id} run={item} title={definitionTitle(definitions.value, item.definitionId)} />)}
      </Card>
      <p className="tw-footnote">{t.run.lineage.childrenHint}</p>
    </>
  )
}

function LineageRow({ run, title }: { run: Run; title: string }) {
  const t = useT()
  return (
    <Link to={paths.run(run.id)} className="tw-lineage-row">
      <span className="tw-recent-mark"><StatusMark status={run.status} /></span>
      <span className="tw-stack-0"><span className="tw-strong">{runName(run, t)}</span><Mono
        tone="muted">{shortId(run.id)} · {title}</Mono></span>
      <span className="tw-flex" />
      <StatusTag status={run.status} />
      <span className="tw-muted-small tw-time-col"><Time value={run.createdAt} /></span>
    </Link>
  )
}

function Composer({ run, onSent, onUploaded }: { run: Run; onSent: () => void; onUploaded: () => void }) {
  const t = useT()
  const { connection, toast } = useApp()
  const schema = run.supplementalInputSchema
  const structured = schema !== null && schema['type'] !== 'string' && hasFormControls(schema)
  const [text, setText] = useState('')
  const [form, setForm] = useState<Json>(() => (schema === null ? null : schemaDefault(schema, schema)))
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(commandKey)
  const area = useRef<HTMLTextAreaElement | null>(null)
  const { upload, uploading } = useUpload(run, onUploaded)
  const blocked = run.status === 'blocked'
  const empty = !structured && text.trim() === ''
  useLayoutEffect(() => {
    const node = area.current
    if (node === null) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight + node.offsetHeight - node.clientHeight, COMPOSER_MAX_PX)}px`
  }, [text])
  const send = () => {
    if (busy || empty) return
    const input: Json = structured ? form : text.trim()
    setBusy(true)
    connection.call('sendInput', { params: { runId: run.id }, body: { input }, idempotencyKey: key }).then(() => {
      toast(t.run.sent)
      setText('')
      setForm(schema === null ? null : schemaDefault(schema, schema))
      setKey(commandKey())
      onSent()
      area.current?.focus()
    }, (error: unknown) => { toast(`${t.run.sendFailed}：${failureText(describeFailure(error), t)}`,
      'error') }).finally(() => { setBusy(false) })
  }
  // Enter submits and Shift+Enter inserts a line break; the Enter that confirms an IME candidate is not a submit.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    // oxlint-disable-next-line typescript/no-deprecated -- Safari reports the IME-confirming Enter as keyCode 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    send()
  }
  const sendLabel = blocked ? t.run.wake : t.run.send
  return (
    <div className="tw-composer-wrap">
      <div className="tw-composer">
        <div className="tw-composer-title"><span className="tw-strong">{t.run.composerLabel}</span><span className="tw-muted-small">{t.run.composerHint}</span></div>
        {structured
          ? <div className="tw-composer-form"><SchemaForm schema={schema} value={form} onChange={setForm} layout="stack" /></div>
          : <textarea ref={area} className="tw-composer-input" aria-label={t.run.composerLabel} rows={3}
            placeholder={blocked ? t.run.composerBlocked : t.run.composer} value={text}
            onChange={(event) => { setText(event.target.value) }} onKeyDown={onKeyDown} />}
        <div className="tw-composer-bar">
          <div className="tw-inline-flex tw-gap-8">
            <label className="tw-attach" title={t.run.upload}>
              <IconPaperclipOutlineRegular size={14} /><span>{t.run.attach}</span>
              <input type="file" multiple hidden aria-label={t.run.upload}
                onChange={(event) => { upload([...(event.target.files ?? [])]); event.target.value = '' }} />
            </label>
            <span className="tw-muted-small">{uploading > 0 ? t.run.files.uploading(uploading) : structured ? '' : t.run.sendKeys}</span>
          </div>
          <Button variant="primary" size="sm" icon={<IconSendOutlineRegular size={14} />} disabled={busy || empty}
            onClick={send}>{sendLabel}</Button>
        </div>
      </div>
    </div>
  )
}

function ReadonlyBar({ run, definitionNext }: { run: Run; definitionNext: string | null }) {
  const t = useT()
  const text = run.terminalAt === null
    ? (run.cleanup === 'blocked' || run.outcome !== null ? t.run.readonlyCleanup : t.run.readonlyCancelling)
    : run.kind === 'polling' && definitionNext !== null ? t.run.readonlyPoll(formatTime(definitionNext)) : t.run.readonlyEnded
  return <div className="tw-composer-wrap"><div className="tw-readonly-bar" role="status">{text}</div></div>
}

function RunStatus({ run, definitionTitle: title,
  definitionRevision }: { run: Run; definitionTitle: string; definitionRevision: number | undefined }) {
  const t = useT()
  const { definitions } = useShared()
  const definition = definitions.value?.find(item => item.id === run.definitionId)
  return (
    <>
      <section>
        <h2>{t.run.panel.run}</h2>
        <KeyValue label={t.run.panel.status}><StatusTag status={run.status} /></KeyValue>
        {run.outcome !== null && run.outcome !== run.status && <KeyValue label={t.run.panel.outcome}><StatusTag
          status={run.outcome} /></KeyValue>}
        {run.reason !== null && <KeyValue label={t.run.panel.reason}>{run.reason}</KeyValue>}
        <KeyValue label={t.run.panel.kind}>{t.kind[run.kind]}</KeyValue>
        {run.businessKey !== null && <KeyValue label={t.run.panel.businessKey} mono>{run.businessKey}</KeyValue>}
        <KeyValue label={t.run.panel.task}><Link to={paths.definition(run.definitionId)} className="tw-link">{title}</Link></KeyValue>
        {run.kind === 'ordinary' && <KeyValue label={t.run.panel.source}>{run.parentRunId === null ? t.common.none : <Link
          to={paths.run(run.parentRunId)} className="tw-link tw-mono">{shortId(run.parentRunId)}</Link>}</KeyValue>}
        <KeyValue label={t.run.panel.configRevision}>{run.configRevision}{definitionRevision !== undefined
          && definitionRevision !== run.configRevision ? ` (${t.definition.revision(definitionRevision)})` : ''}</KeyValue>
        <KeyValue label={t.run.panel.codeVersion}>{run.codeVersion}</KeyValue>
        <KeyValue label={t.run.panel.revision}>{run.revision}</KeyValue>
      </section>
      <section>
        <h2>{t.run.panel.time}</h2>
        {run.occurrence !== null && <KeyValue label={t.run.panel.scheduled}><Time value={run.occurrence.scheduledAt} full /></KeyValue>}
        {run.occurrence?.missed !== null && run.occurrence?.missed !== undefined && (
          <KeyValue label={t.run.panel.missed}>{run.occurrence.missed.count} · <Time value={run.occurrence.missed.from} full /> – <Time
            value={run.occurrence.missed.through} full /></KeyValue>
        )}
        <KeyValue label={t.run.panel.created}><Time value={run.createdAt} full /></KeyValue>
        <KeyValue label={t.run.panel.updated}><Time value={run.updatedAt} full /></KeyValue>
        <KeyValue label={t.run.panel.retryAt}><Time value={run.retryAt} full /></KeyValue>
        <KeyValue label={t.run.panel.ended}><Time value={run.terminalAt} full /></KeyValue>
        {run.kind === 'polling' && definition?.nextDueAt !== null && definition?.nextDueAt !== undefined && (
          <KeyValue label={t.run.panel.nextPoll}><Time value={definition.nextDueAt} full /></KeyValue>
        )}
      </section>
      <section>
        <h2>{t.run.panel.ids}</h2>
        <IdRow label={t.run.panel.runId} value={run.id} />
        <IdRow label={t.run.panel.sessionId} value={run.sessionId} />
      </section>
      <section>
        <h2>{t.run.panel.cleanup}</h2>
        <KeyValue label={t.runs.columns.cleanup}><Tag tone={run.cleanup === 'blocked' ? 'danger' : run.cleanup === 'complete' ? 'quiet'
          : 'neutral'}>{t.cleanup[run.cleanup]}</Tag></KeyValue>
      </section>
    </>
  )
}

function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="tw-id-row">
      <span className="tw-muted-small">{label}</span>
      <span className="tw-row-between"><Mono tone="strong">{value}</Mono><CopyButton text={value} label={label} /></span>
    </div>
  )
}
