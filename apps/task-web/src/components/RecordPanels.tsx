/** Content panels of the record inspector: message preview and raw blocks, tool arguments, results and schema, timing and token usage. */
import clsx from 'clsx'
import { IconChevronRightOutlineRegular, IconCodeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { bytes, formatMillis } from '../support/format.ts'
import { assistantTimings, parseContainer } from '../support/presentation.ts'
import { blockText, prettyArguments } from '../support/timeline.ts'
import {
  durationOf, promptTokens, type AssistantRecord, type MessageRecord, type TokenTotals, type ToolRecord,
} from '../support/trajectory.ts'
import type { Run, TranscriptBlock, TranscriptEntry, TranscriptRequest } from '../support/types.ts'
import { CopyButton, KeyValue } from './ui.tsx'
import { Markdown } from './markdown.tsx'
import { Files, JsonView, Missing, StartedAt } from './RecordParts.tsx'
import { argumentSummary } from './Transcript.tsx'

/** Message as the reader sees it: thinking behind a toggle, Markdown text, tool calls and files.
 * @param props.run - execution that owns the attachments.
 * @param props.record - user, context or assistant message.
 * @param props.thinking - the thinking text is open.
 * @param props.onThinking - the thinking toggle was used.
 * @param props.onOpenCall - a tool call of the message was chosen, by its record id.
 * @returns the content, or a note when the message is empty.
 */
export function RenderedMessage({ run, record, thinking, onThinking, onOpenCall }: {
  run: Pick<Run, 'id'>
  record: MessageRecord | AssistantRecord
  thinking: boolean
  onThinking: (open: boolean) => void
  onOpenCall: (id: string) => void
}) {
  const copy = useT().run.trajectory
  const text = blockText(record.entry, 'text', '\n\n')
  const reasoning = blockText(record.entry, 'reasoning', '\n\n')
  const calls = record.kind === 'assistant' ? record.calls : []
  const files = record.entry.blocks.some(block => block.kind === 'image' || block.kind === 'file')
  if (text === '' && reasoning === '' && calls.length === 0 && !files) return <Missing>{copy.noContent}</Missing>
  return (
    <div className="tw-detail-message">
      {reasoning !== '' && (
        <div className="tw-detail-thinking">
          <button type="button" className="tw-detail-thinking-toggle" aria-expanded={thinking} onClick={() => { onThinking(!thinking) }}>
            <span>{copy.detail.thinking}</span>
            <IconChevronRightOutlineRegular size={12} />
          </button>
          {thinking && <div className="tw-reasoning"><Markdown text={reasoning} compact /></div>}
        </div>
      )}
      {text !== '' && <Markdown text={text} compact />}
      {calls.length > 0 && (
        <div className="tw-record-calls">
          {calls.map(({ id, block }) => (
            <button key={id} type="button" className="tw-record-call" title={copy.detail.openCall} onClick={() => { onOpenCall(id) }}>
              <IconCodeOutlineRegular size={14} />
              <span className="tw-tool-name">{block.name}</span>
              <span className="tw-tool-summary">{argumentSummary(block.arguments)}</span>
            </button>
          ))}
        </div>
      )}
      <Files run={run} entry={record.entry} />
    </div>
  )
}

function rawText(block: TranscriptBlock): string {
  switch (block.kind) {
    case 'text':
    case 'reasoning': return block.text
    case 'tool_call': return `${block.name}\n${prettyArguments(block.arguments)}`
    case 'image':
    case 'file': return `${block.name} · ${block.mediaType} · ${bytes(block.bytes)}`
    case 'unsupported': return block.type
  }
}

/** Blocks of a stored message as plain text, one box per block.
 * @param props.entry - stored message.
 * @returns the blocks with their position and type, or a note when the message has none.
 */
export function RawBlocks({ entry }: { entry: TranscriptEntry }) {
  const t = useT()
  const copy = t.run.trajectory
  if (entry.blocks.length === 0) return <Missing>{copy.noContent}</Missing>
  return (
    <div className="tw-detail-blocks">
      {entry.blocks.map((block, index) => (
        <div key={index} className="tw-detail-block">
          <div className="tw-detail-block-head">
            <span className="tw-muted-small">{copy.detail.block(index + 1, block.kind === 'unsupported' ? block.type : block.kind)}</span>
            <CopyButton text={rawText(block)} label={t.common.copy} />
          </div>
          <pre className="tw-code-block">{rawText(block)}</pre>
        </div>
      ))}
    </div>
  )
}

/** Origin of a user-role message as a JSON tree.
 * @param props.source - stored `source` of the message; null when the log recorded none.
 * @returns the tree, or a note.
 */
export function SourceView({ source }: { source: TranscriptEntry['source'] }) {
  const copy = useT().run.trajectory.detail
  if (source === null) return <Missing>{copy.sourceMissing}</Missing>
  return <JsonView data={source} label={copy.sourceJson} />
}

/** Arguments of a tool call.
 * @param props.record - tool call.
 * @param props.preview - show fewer lines of long strings.
 * @returns a JSON tree for object arguments, otherwise the text; a note without a call.
 */
export function ArgumentsView({ record, preview = false }: { record: ToolRecord; preview?: boolean }) {
  const copy = useT().run.trajectory.detail
  if (record.call === undefined) return <Missing>{copy.noPayload}</Missing>
  const container = parseContainer(record.call.arguments)
  return container === undefined ? <pre className="tw-code-block">{record.call.arguments}</pre>
    : <JsonView data={container} label={copy.payloadJson} preview={preview} />
}

/** Result of a tool call.
 * @param props.run - execution that owns the attachments.
 * @param props.record - tool call.
 * @param props.live - the Run can still produce the result.
 * @param props.preview - show fewer lines of long strings.
 * @returns a JSON tree for a single JSON result, otherwise the text; a note while the result is missing or empty.
 */
export function ResultView({ run, record, live, preview = false }: { run: Pick<Run, 'id'>; record: ToolRecord; live: boolean; preview?: boolean }) {
  const t = useT()
  const copy = t.run.trajectory
  const { result } = record
  if (result === undefined) return <Missing>{live ? copy.running : copy.detail.noResult}</Missing>
  const text = blockText(result, 'text')
  const container = result.blocks.filter(block => block.kind === 'text').length === 1 ? parseContainer(text) : undefined
  const files = result.blocks.some(block => block.kind === 'image' || block.kind === 'file')
  return (
    <>
      {container !== undefined ? <JsonView data={container} label={copy.detail.resultJson} preview={preview} failed={record.failed} />
        : text === '' ? (files ? null : <Missing>{copy.detail.noOutput}</Missing>)
          : <pre className={clsx('tw-code-block', record.failed && 'tw-detail-failed')}>{text}</pre>}
      <Files run={run} entry={result} />
    </>
  )
}

/** Declaration of a tool as the model saw it.
 * @param props.record - tool call.
 * @param props.preview - show fewer lines of long strings.
 * @returns name, description and parameter schema, or a note when the request header was not logged.
 */
export function SchemaView({ record, preview = false }: { record: ToolRecord; preview?: boolean }) {
  const copy = useT().run.trajectory.detail
  const { schema } = record
  if (schema === undefined) return <Missing>{copy.schemaUnavailable}</Missing>
  return (
    <div className="tw-detail-schema">
      <h4 className="tw-detail-schema-name">{schema.name}</h4>
      <p className="tw-detail-schema-description">{schema.description}</p>
      <h5 className="tw-detail-schema-title">{copy.parameters}</h5>
      <JsonView data={schema.parameters} label={copy.parametersJson(schema.name)} preview={preview} />
    </div>
  )
}

/** Start and length of a tool call.
 * @param props.record - tool call.
 * @param props.live - the Run can still produce the result.
 * @param props.preview - leave out the timing source.
 * @returns rows of the start time, duration and where the times come from.
 */
export function ToolTiming({ record, live, preview = false }: { record: ToolRecord; live: boolean; preview?: boolean }) {
  const t = useT()
  const copy = t.run.trajectory.timing
  const length = durationOf(record)
  const running = record.result === undefined && live
  return (
    <div className="tw-record-kv">
      <KeyValue label={copy.started}><StartedAt at={record.startedAt} /></KeyValue>
      <KeyValue label={copy.duration}>
        {length !== null ? formatMillis(length, t) : running ? t.run.trajectory.status.pending : copy.notAvailable}
      </KeyValue>
      {!preview && <KeyValue label={copy.source}>{length === null ? copy.notAvailable : copy.sessionTimestamps}</KeyValue>}
    </div>
  )
}

/** Start, length, first-token delay, generation time and throughput of a model request.
 * @param props.record - model request.
 * @returns rows of the request's timing.
 */
export function RequestTiming({ record }: { record: AssistantRecord }) {
  const t = useT()
  const copy = t.run.trajectory.timing
  const timings = assistantTimings(record, t)
  return (
    <div className="tw-record-kv">
      <KeyValue label={copy.started}><StartedAt at={record.startedAt} /></KeyValue>
      <KeyValue label={copy.totalDuration}>{timings.total}</KeyValue>
      <KeyValue label={copy.ttft}>{timings.ttft}</KeyValue>
      <KeyValue label={copy.generation}>{timings.generation}</KeyValue>
      <KeyValue label={copy.throughput}>{timings.throughput}</KeyValue>
    </div>
  )
}

/** Output tokens of a model request with the share spent on reasoning.
 * @param props.usage - counters of the request; undefined when the provider reported none.
 * @returns rows, indented for the parts of the total.
 */
export function TokenRows({ usage }: { usage: TokenTotals | undefined }) {
  const copy = useT().run.trajectory
  const count = (value: number) => copy.unit.tokens(value.toLocaleString())
  const content = usage?.output !== undefined && usage.reasoning !== undefined ? Math.max(0, usage.output - usage.reasoning) : undefined
  return (
    <>
      <KeyValue label={copy.usage.tokens}>{usage?.output === undefined ? '—' : count(usage.output)}</KeyValue>
      {usage?.reasoning !== undefined && <KeyValue label={copy.usage.reasoning} sub>{count(usage.reasoning)}</KeyValue>}
      {content !== undefined && <KeyValue label={copy.usage.content} sub>{count(content)}</KeyValue>}
    </>
  )
}

/** Input and output token counters, with the parts of each.
 * @param props.usage - counters; undefined when the provider reported none.
 * @returns rows, or a note when nothing was reported.
 */
export function UsageRows({ usage }: { usage: TokenTotals | undefined }) {
  const copy = useT().run.trajectory
  if (usage === undefined) return <Missing>{copy.usage.notReported}</Missing>
  const count = (value: number) => copy.unit.tokens(value.toLocaleString())
  const reported = usage.input !== undefined || usage.cacheRead !== undefined || usage.cacheWrite !== undefined
  const content = usage.output !== undefined && usage.reasoning !== undefined ? Math.max(0, usage.output - usage.reasoning) : undefined
  return (
    <div className="tw-record-kv">
      {reported && <KeyValue label={copy.usage.input}>{count(promptTokens(usage))}</KeyValue>}
      {usage.cacheRead !== undefined && <KeyValue label={copy.usage.cached} sub>{count(usage.cacheRead)}</KeyValue>}
      {usage.cacheWrite !== undefined && <KeyValue label={copy.usage.cacheCreated} sub>{count(usage.cacheWrite)}</KeyValue>}
      {usage.input !== undefined && <KeyValue label={copy.usage.other} sub>{count(usage.input)}</KeyValue>}
      {usage.output !== undefined && <KeyValue label={copy.usage.output}>{count(usage.output)}</KeyValue>}
      {usage.reasoning !== undefined && <KeyValue label={copy.usage.reasoning} sub>{count(usage.reasoning)}</KeyValue>}
      {content !== undefined && <KeyValue label={copy.usage.content} sub>{count(content)}</KeyValue>}
    </div>
  )
}

/** Token counters of one request next to the totals of the Run up to it.
 * @param props.record - model request.
 * @returns two groups of rows.
 */
export function UsagePanel({ record }: { record: AssistantRecord }) {
  const copy = useT().run.trajectory.usage
  return (
    <div className="tw-detail-usage">
      <div className="tw-detail-usage-group">
        <h4 className="tw-detail-schema-title">{copy.thisRequest}</h4>
        <UsageRows usage={record.usage} />
      </div>
      <div className="tw-detail-usage-group">
        <h4 className="tw-detail-schema-title">{copy.sessionCumulative}</h4>
        <UsageRows usage={record.cumulative} />
      </div>
    </div>
  )
}

/** Model configuration of a request.
 * @param props.header - request header in force; undefined when the Session logged none.
 * @param props.preview - show fewer lines of long strings.
 * @returns the configuration as a JSON tree, or a note.
 */
export function OptionsView({ header, preview = false }: { header: TranscriptRequest | undefined; preview?: boolean }) {
  const copy = useT().run.trajectory.detail
  if (header === undefined) return <Missing>{copy.optionsMissing}</Missing>
  return <JsonView data={header.config} label={copy.optionsJson} preview={preview} />
}
