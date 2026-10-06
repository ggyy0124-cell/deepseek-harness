/** Inspector of one trajectory record or model request, shown in the Run sidebar. */
import { useState, type ReactNode } from 'react'
import { IconCodeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import {
  findSubject, locationOf, requestId, sourceLabel, statusOf, tabsOf, type DetailTab, type Subject,
} from '../support/presentation.ts'
import { inputDisplayLines } from '../support/timeline.ts'
import type { AssistantRecord, InputRecord, MessageRecord, ToolRecord, Trajectory, TrajectoryRecord } from '../support/trajectory.ts'
import type { Json, Run } from '../support/types.ts'
import { KindTag } from './KindTag.tsx'
import { DetailSection, JsonView, JumpLink, StartedAt } from './RecordParts.tsx'
import {
  ArgumentsView, OptionsView, RawBlocks, RenderedMessage, RequestTiming, ResultView, SchemaView, SourceView, TokenRows, ToolTiming,
  UsagePanel, UsageRows,
} from './RecordPanels.tsx'
import { EmptyState, KeyValue, Tabs } from './ui.tsx'

/** What a panel needs to navigate: choose another record or request, optionally on a given tab, or change tab within the selection. */
interface Navigation {
  readonly onSelect: (id: string, tab?: DetailTab) => void
  readonly onTab: (tab: DetailTab) => void
}

/** Status of a record as an overview row, red when it failed. */
function Status({ record, live }: { record: TrajectoryRecord; live: boolean }) {
  const copy = useT().run.trajectory
  const status = statusOf(record, live)
  return <KeyValue label={copy.detail.status}><span className={status === 'failed' ? 'tw-danger-text' : undefined}>{copy.status[status]}</span></KeyValue>
}

function textOf(config: Record<string, Json> | undefined, key: string): string | undefined {
  const value = config?.[key]
  return typeof value === 'string' ? value : undefined
}

function RequestPanel({ record, tab, onSelect, onTab }: { record: AssistantRecord; tab: DetailTab } & Navigation) {
  const copy = useT().run.trajectory
  const provider = textOf(record.header?.config, 'provider')
  const model = record.entry.model ?? textOf(record.header?.config, 'model')
  switch (tab) {
    case 'options': return <OptionsView header={record.header} />
    case 'usage': return <UsagePanel record={record} />
    case 'timing': return <RequestTiming record={record} />
    default: return (
      <>
        <div className="tw-record-kv">
          <Status record={record} live={false} />
          {provider !== undefined && <KeyValue label={copy.detail.provider} mono>{provider}</KeyValue>}
          {model !== undefined && <KeyValue label={copy.detail.model} mono>{model}</KeyValue>}
          <KeyValue label={copy.detail.toolCalls}>{record.calls.length}</KeyValue>
          <KeyValue label={copy.detail.result}>
            <JumpLink onClick={() => { onSelect(record.id, 'overview') }}>{copy.detail.assistantMessage}</JumpLink>
          </KeyValue>
        </div>
        {record.header !== undefined && (
          <DetailSection label={copy.detail.tabs.options} onOpen={() => { onTab('options') }}><OptionsView header={record.header} preview /></DetailSection>
        )}
        <DetailSection label={copy.detail.tabs.usage} onOpen={() => { onTab('usage') }}><UsageRows usage={record.usage} /></DetailSection>
        <DetailSection label={copy.detail.tabs.timing} onOpen={() => { onTab('timing') }}><RequestTiming record={record} /></DetailSection>
      </>
    )
  }
}

function MessagePanel({ run, record, tab, onSelect, onTab }: {
  run: Pick<Run, 'id'>
  record: MessageRecord | AssistantRecord
  tab: DetailTab
} & Navigation) {
  const t = useT()
  const copy = t.run.trajectory
  const [thinking, setThinking] = useState(false)
  const rendered = <RenderedMessage run={run} record={record} thinking={thinking} onThinking={setThinking} onOpenCall={onSelect} />
  switch (tab) {
    case 'rendered': return rendered
    case 'raw': return <RawBlocks entry={record.entry} />
    case 'source': return <SourceView source={record.entry.source} />
    default: return (
      <>
        <div className="tw-record-kv">
          {record.kind === 'assistant'
            ? (
              <KeyValue label={copy.detail.source}>
                <JumpLink onClick={() => { onSelect(requestId(record.request), 'overview') }}>{copy.request(record.request)}</JumpLink>
              </KeyValue>
            )
            : record.entry.source !== null && (
              <KeyValue label={copy.detail.source}>
                <JumpLink onClick={() => { onTab('source') }}>{sourceLabel(record.entry.source, t)}</JumpLink>
              </KeyValue>
            )}
          <Status record={record} live={false} />
          {record.kind === 'assistant' && <TokenRows usage={record.usage} />}
        </div>
        <DetailSection label={copy.detail.tabs.rendered} onOpen={() => { onTab('rendered') }}>{rendered}</DetailSection>
        {record.kind === 'assistant' && (
          <DetailSection label={copy.timing.request} onOpen={() => { onSelect(requestId(record.request), 'timing') }}>
            <RequestTiming record={record} />
          </DetailSection>
        )}
      </>
    )
  }
}

function ToolPanel({ run, record, live, tab, onSelect, onTab }: {
  run: Pick<Run, 'id'>
  record: ToolRecord
  live: boolean
  tab: DetailTab
} & Navigation) {
  const copy = useT().run.trajectory
  switch (tab) {
    case 'input': return <ArgumentsView record={record} />
    case 'output': return <ResultView run={run} record={record} live={live} />
    case 'schema': return <SchemaView record={record} />
    case 'timing': return <ToolTiming record={record} live={live} />
    default: return (
      <>
        <div className="tw-record-kv">
          {record.parent !== undefined && (
            <KeyValue label={copy.detail.hierarchy}>
              <JumpLink onClick={() => { if (record.parent !== undefined) onSelect(record.parent, 'overview') }}>{copy.detail.assistantMessage}</JumpLink>
            </KeyValue>
          )}
          <Status record={record} live={live} />
          {record.call !== undefined && <KeyValue label={copy.detail.callId} mono>{record.call.callId}</KeyValue>}
        </div>
        {record.call !== undefined && (
          <DetailSection label={copy.detail.tabs.input} onOpen={() => { onTab('input') }}><ArgumentsView record={record} preview /></DetailSection>
        )}
        {record.result !== undefined && (
          <DetailSection label={copy.detail.tabs.output} onOpen={() => { onTab('output') }}>
            <ResultView run={run} record={record} live={live} preview />
          </DetailSection>
        )}
        <DetailSection label={copy.detail.tabs.schema} onOpen={() => { onTab('schema') }}><SchemaView record={record} preview /></DetailSection>
        <DetailSection label={copy.detail.tabs.timing} onOpen={() => { onTab('timing') }}><ToolTiming record={record} live={live} preview /></DetailSection>
      </>
    )
  }
}

function InputPanel({ record, tab, onTab }: { record: InputRecord; tab: DetailTab; onTab: (tab: DetailTab) => void }) {
  const t = useT()
  const copy = t.run.trajectory
  const { value } = record.input
  if (tab === 'raw') {
    return typeof value === 'object' && value !== null ? <JsonView data={value} label={copy.detail.inputJson} />
      : <pre className="tw-code-block">{String(value)}</pre>
  }
  return (
    <>
      <div className="tw-record-kv">
        <KeyValue label={copy.timing.started}><StartedAt at={record.startedAt} /></KeyValue>
      </div>
      <DetailSection label={copy.detail.tabs.raw} onOpen={() => { onTab('raw') }}>
        {inputDisplayLines(value, t).map((line, index) => (
          <p key={index} className="tw-input-line">{line.label !== undefined && <span className="tw-input-label">{line.label}</span>}{line.text}</p>
        ))}
      </DetailSection>
    </>
  )
}

function Panel({ run, subject, tab, live, ...navigation }: {
  run: Pick<Run, 'id'>
  subject: Subject
  tab: DetailTab
  live: boolean
} & Navigation): ReactNode {
  if (subject.kind === 'request') return <RequestPanel record={subject.record} tab={tab} {...navigation} />
  const { record } = subject
  switch (record.kind) {
    case 'user':
    case 'context':
    case 'assistant': return <MessagePanel run={run} record={record} tab={tab} {...navigation} />
    case 'tool': return <ToolPanel run={run} record={record} live={live} tab={tab} {...navigation} />
    case 'input': return <InputPanel record={record} tab={tab} onTab={navigation.onTab} />
  }
}

/** Inspector of the selected trajectory record or model request.
 * @param props.run - execution, for attachment downloads and the live state of tool calls.
 * @param props.trajectory - records of the Run.
 * @param props.id - selected record id, or the id of a model request.
 * @param props.tab - tab the reader chose; an id whose record lacks that tab opens on the overview.
 * @param props.onSelect - another record or request chosen from within the inspector, optionally on a given tab.
 * @param props.onTab - tab chosen.
 * @returns header, tabs and the panel of the active tab.
 */
export function RecordDetail({ run, trajectory, id, tab, onSelect, onTab }: {
  run: Pick<Run, 'id' | 'terminalAt'>
  trajectory: Trajectory
  id: string
  tab: DetailTab
} & Navigation) {
  const t = useT()
  const copy = t.run.trajectory
  const subject = findSubject(trajectory, id)
  if (subject === undefined) {
    return <EmptyState icon={<IconCodeOutlineRegular size={20} />} title={copy.detail.gone}>{copy.detail.goneBody}</EmptyState>
  }
  const tabs = tabsOf(subject)
  const active = tabs.includes(tab) ? tab : 'overview'
  return (
    <div className="tw-detail">
      <div className="tw-detail-head">
        <div className="tw-detail-name">
          {subject.kind === 'request'
            ? <><span className="tw-detail-dot" aria-hidden="true" /><span className="tw-detail-request">{copy.request(subject.record.request)}</span></>
            : <KindTag record={subject.record} />}
          <span className="tw-muted-small tw-detail-location">{locationOf(subject.record, t)}</span>
        </div>
        <div className="tw-detail-tabs">
          <Tabs variant="underline" label={t.run.sidebar.event} value={active} onChange={onTab}
            items={tabs.map(value => ({ value, label: copy.detail.tabs[value] }))} />
        </div>
      </div>
      <div className="tw-detail-body">
        <Panel run={run} subject={subject} tab={active} live={run.terminalAt === null} onSelect={onSelect} onTab={onTab} />
      </div>
    </div>
  )
}
