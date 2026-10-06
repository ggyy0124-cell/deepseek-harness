/** Read-only rendering of a Run's conversation: stage instructions, Agent turns and the inputs people gave. */
import { useMemo, useState, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconInfoOutlineRegular, IconThinkOutlineRegular,
  IconCodeOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { useApp } from '../app/context.tsx'
import { bytes, elapsed, formatDuration, formatTime } from '../support/format.ts'
import { saveBlob } from '../support/download.ts'
import { blockText, buildTimeline, inputDisplayLines, prettyArguments, type InputItem, type Step, type Turn } from '../support/timeline.ts'
import type { Run, RunInput, TranscriptBlock, TranscriptEntry } from '../support/types.ts'
import { Clamp } from './Clamp.tsx'
import { Markdown } from './markdown.tsx'
import { Spinner } from './ui.tsx'

/** Tool result paired with its call. */
interface ToolResult { readonly entry: TranscriptEntry }

/** Run fields the conversation reads. */
type ConversationRun = Pick<Run, 'id' | 'createdAt' | 'terminalAt' | 'status' | 'outcome'>

/** Height in px at which a stage instruction collapses behind an expand control. */
const INSTRUCTION_CLAMP_PX = 132

/** Conversation of a Run.
 * @param props.run - execution, used for start and end markers.
 * @param props.entries - stored messages in sequence order.
 * @param props.inputs - inputs people gave the Run, placed among the messages by arrival time.
 * @param props.working - the Agent is working; its latest turn stays open and the activity line shows.
 * @returns message column.
 */
export function Transcript({ run, entries, inputs, working, startLabel }: {
  run: ConversationRun
  entries: readonly TranscriptEntry[]
  inputs: readonly RunInput[]
  working: boolean
  startLabel: string
}) {
  const t = useT()
  const results = useMemo(() => {
    const paired = new Map<string, ToolResult>()
    for (const entry of entries) if (entry.role === 'tool' && entry.callId !== null) paired.set(entry.callId, { entry })
    return paired
  }, [entries])
  const timeline = useMemo(() => buildTimeline(entries, inputs), [entries, inputs])
  let latest = -1
  timeline.forEach((item, index) => { if (item.kind === 'turn') latest = index })
  const attention = run.status === 'blocked' || run.status === 'waiting_retry' || run.outcome === 'failed' || run.outcome === 'cancelled'
  return (
    <div className="tw-transcript">
      <MetaLine text={startLabel} />
      {timeline.length === 0 && !working && <p className="tw-muted-line tw-center">{t.run.emptyTranscript}</p>}
      {timeline.map((item, index) => {
        if (item.kind === 'input') return <InputBubble key={`input:${item.key}`} item={item} pending={run.terminalAt === null} />
        const mode = index !== latest ? 'closed' : working ? 'live' : attention ? 'pinned' : 'closed'
        return <TurnView key={`turn:${item.key}`} run={run} turn={item} results={results} mode={mode} />
      })}
      {working && <div className="tw-working"><Spinner tone="deep" /><span>{t.run.working(elapsed(run.createdAt, t))}</span></div>}
      {run.terminalAt !== null && <MetaLine text={t.run.runEnded(formatTime(run.terminalAt), t.status[run.status])} />}
    </div>
  )
}

/** Centered divider with a caption.
 * @returns divider element.
 */
export function MetaLine({ text }: { text: string }) {
  return <div className="tw-meta-line"><span /><span>{text}</span><span /></div>
}

/** How a turn presents its process: `live` shows it without a summary row, `pinned` keeps it open under a plain
 * summary, and `closed` folds it.
 */
type TurnMode = 'live' | 'pinned' | 'closed'

function TurnView({ run, turn, results, mode }: {
  run: ConversationRun
  turn: Turn
  results: ReadonlyMap<string, ToolResult>
  mode: TurnMode
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const folds = mode === 'closed' && turn.process.length > 0
  const shown = turn.process.length > 0 && (!folds || open)
  const summary = [t.run.turnTook(formatDuration(turn.spanMs, t)), turn.toolCalls > 0 ? t.run.turnTools(turn.toolCalls) : undefined]
    .filter(part => part !== undefined).join(' · ')
  return (
    <div className="tw-turn">
      {turn.instruction !== undefined && <Instruction run={run} entry={turn.instruction} />}
      {turn.process.length > 0 && mode !== 'live' && (
        <button type="button" className="tw-process-row" data-open={open || undefined} aria-expanded={folds ? open : undefined}
          disabled={!folds} onClick={() => { setOpen(value => !value) }}>
          <span>{summary}</span>{folds && <IconChevronDownOutlineRegular size={14} />}
        </button>
      )}
      {shown && <div className="tw-process-steps"><Steps run={run} steps={turn.process} results={results} /></div>}
      {turn.answer.length > 0 && <div className="tw-assistant-message"><Steps run={run} steps={turn.answer} results={results} /></div>}
    </div>
  )
}

function Steps({ run, steps, results }: { run: ConversationRun; steps: readonly Step[]; results: ReadonlyMap<string, ToolResult> }) {
  return (
    <>
      {steps.map(step => <Block key={`${step.entry.sequence}:${step.index}`} run={run} entry={step.entry} block={step.block}
        index={step.index} results={results} />)}
    </>
  )
}

/** Stage prompt a plugin wrote for the Agent; long prompts collapse. */
function Instruction({ run, entry }: { run: ConversationRun; entry: TranscriptEntry }) {
  const t = useT()
  const text = blockText(entry, 'text', '\n\n')
  const files = entry.blocks.map((block, index) => ({ block, index })).filter(item => item.block.kind === 'image' || item.block.kind === 'file')
  return (
    <div className="tw-instruction">
      <span className="tw-muted-small">{t.run.userLabel} · {formatTime(entry.at)}</span>
      {text !== '' && <div className="tw-instruction-body"><Clamp maxHeight={INSTRUCTION_CLAMP_PX}><Markdown text={text} compact /></Clamp></div>}
      {files.length > 0 && <div className="tw-chip-row">{files.map(item => <BlockChip key={item.index} run={run} entry={entry}
        block={item.block} index={item.index} />)}</div>}
      {entry.blocks.filter(block => block.kind === 'unsupported').map((block, index) => <Unsupported key={index} block={block} />)}
    </div>
  )
}

/** Supplemental input or reply from a person. */
function InputBubble({ item, pending }: { item: InputItem; pending: boolean }) {
  const t = useT()
  const { input } = item
  const lines = inputDisplayLines(input.value, t)
  return (
    <div className="tw-user-message">
      <span className="tw-muted-small tw-inline-flex tw-gap-6">
        {input.kind === 'response' ? t.run.replyLabel : t.run.inputLabel} · {formatTime(input.at)}
        {pending && !input.consumed && <Tag tone="outline">{t.run.inputQueued}</Tag>}
      </span>
      <div className="tw-bubble tw-input-bubble">
        {lines.map((line, index) => (
          <p key={index} className="tw-input-line">{line.label !== undefined && <span className="tw-input-label">{line.label}</span>}{line.text}</p>
        ))}
      </div>
    </div>
  )
}

function Block({ run, entry, block, index, results }: {
  run: ConversationRun
  entry: TranscriptEntry
  block: TranscriptBlock
  index: number
  results: ReadonlyMap<string, ToolResult>
}) {
  switch (block.kind) {
    case 'text': return <div className="tw-assistant-text"><Markdown text={block.text} /></div>
    case 'reasoning': return <Reasoning text={block.text} />
    case 'tool_call': return <ToolCall name={block.name} args={block.arguments} result={results.get(block.callId)} />
    case 'image':
    case 'file': return <div className="tw-chip-row"><BlockChip run={run} entry={entry} block={block} index={index} /></div>
    case 'unsupported': return <Unsupported block={block} />
  }
}

function Unsupported({ block }: { block: Extract<TranscriptBlock, { kind: 'unsupported' }> }) {
  const t = useT()
  return <div className="tw-transcript-note"><IconInfoOutlineRegular size={14} /><span>{t.run.unsupported(block.type)}</span></div>
}

function Reasoning({ text }: { text: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <div className="tw-disclosure">
      <button type="button" className="tw-disclosure-row tw-muted-text" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        <IconThinkOutlineRegular size={14} /><span>{t.run.thought}</span>
        {open ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronRightOutlineRegular size={12} />}
      </button>
      {open && <div className="tw-disclosure-body tw-reasoning"><Markdown text={text} compact /></div>}
    </div>
  )
}

/** Short argument summary: the first string value, or compact JSON.
 * @param args - tool call arguments JSON text.
 * @returns one-line summary.
 */
export function argumentSummary(args: string): string {
  try {
    const value: unknown = JSON.parse(args)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const questions = (value as Record<string, unknown>)['questions']
      const question: unknown = Array.isArray(questions) ? questions[0] : undefined
      if (typeof question === 'object' && question !== null && typeof (question as Record<string,
        unknown>)['question'] === 'string') return String((question as Record<string, unknown>)['question'])
      for (const key of ['command', 'path', 'file_path', 'query', 'url', 'pattern']) {
        const item = (value as Record<string, unknown>)[key]
        if (typeof item === 'string') return item
      }
      const first = Object.values(value).find(item => typeof item === 'string')
      if (typeof first === 'string') return first
    }
    return JSON.stringify(value)
  } catch {
    return args // Streaming tool calls may store partial argument text.
  }
}

function ToolCall({ name, args, result }: { name: string; args: string; result: ToolResult | undefined }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const error = result?.entry.isError === true
  const output = blockText(result?.entry, 'text')
  const pretty = prettyArguments(args)
  return (
    <div className="tw-disclosure">
      <button type="button" className="tw-disclosure-row" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        {result === undefined ? <Spinner /> : <IconCodeOutlineRegular size={14} />}
        <span className={error ? 'tw-tool-name tw-danger-text' : 'tw-tool-name'}>{name}</span>
        <span className="tw-tool-summary">{argumentSummary(args)}</span>
        {error && <Tag tone="danger">{t.run.toolError}</Tag>}
        {open ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronRightOutlineRegular size={12} />}
      </button>
      {open && (
        <div className="tw-disclosure-body">
          <span className="tw-muted-small">{t.run.toolArguments}</span>
          <pre className="tw-code-block">{pretty}</pre>
          {result !== undefined && <>
            <span className="tw-muted-small">{t.run.toolOutput}</span>
            <pre className={error ? 'tw-code-block tw-danger-text' : 'tw-code-block'}>{output === '' ? '—' : output}</pre>
          </>}
        </div>
      )}
    </div>
  )
}

/** Download chip of an image or file block; other blocks render nothing.
 * @param props.run - execution that owns the stored message.
 * @param props.entry - stored message carrying the block.
 * @param props.block - the block.
 * @param props.index - position of the block within the message.
 * @returns chip that downloads the attachment.
 */
export function BlockChip({ run, entry, block, index }: { run: Pick<Run, 'id'>; entry: TranscriptEntry; block: TranscriptBlock; index: number }) {
  const { connection, toast } = useApp()
  const t = useT()
  if (block.kind !== 'image' && block.kind !== 'file') return null
  const download = () => {
    connection.guard(() => connection.client.downloadSessionAttachment(run.id, entry.sequence, index))
      .then((blob) => { saveBlob(blob, block.name) }, () => { toast(t.run.files.downloadFailed, 'error') })
  }
  return <FileChip name={block.name} detail={bytes(block.bytes)} onClick={download} label={t.run.files.download(block.name)} />
}

/** Compact file chip.
 * @returns chip button.
 */
export function FileChip({ name, detail, onClick, label }: { name: string; detail: ReactNode; onClick?: () => void; label?: string }) {
  const extension = name.includes('.') ? (name.split('.').pop() ?? '').slice(0, 4).toUpperCase() : 'FILE'
  return (
    <button type="button" className="tw-file-chip" onClick={onClick} aria-label={label}>
      <span className="tw-file-kind" aria-hidden="true">{extension}</span>
      <span className="tw-file-text"><span className="tw-file-name">{name}</span><span className="tw-muted-small">{detail}</span></span>
    </button>
  )
}
