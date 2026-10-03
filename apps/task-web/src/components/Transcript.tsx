/** Read-only rendering of a Run's stored Session messages. */
import { useState, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconInfoOutlineRegular, IconThinkOutlineRegular,
  IconCodeOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { useApp } from '../app/context.tsx'
import { bytes, elapsed, formatTime } from '../lib/format.ts'
import { saveBlob } from '../lib/download.ts'
import type { Run, TranscriptBlock, TranscriptEntry } from '../lib/types.ts'
import { Markdown } from './markdown.tsx'
import { Spinner } from './ui.tsx'

/** Tool result paired with its call. */
interface ToolResult { readonly entry: TranscriptEntry }

/** Transcript of a Run.
 * @param props.run - execution, used for start and end markers.
 * @param props.entries - stored messages in sequence order.
 * @param props.working - show the Agent activity line.
 * @returns message column.
 */
export function Transcript({ run, entries, working,
  startLabel }: { run: Run; entries: readonly TranscriptEntry[]; working: boolean; startLabel: string }) {
  const t = useT()
  const results = new Map<string, ToolResult>()
  for (const entry of entries) if (entry.role === 'tool' && entry.callId !== null) results.set(entry.callId, { entry })
  const callIds = new Set(entries.flatMap(entry => entry.blocks.flatMap(block => (block.kind === 'tool_call' ? [block.callId] : []))))
  return (
    <div className="tw-transcript">
      <MetaLine text={startLabel} />
      {entries.length === 0 && !working && <p className="tw-muted-line tw-center">{t.run.emptyTranscript}</p>}
      {entries.map((entry) => {
        if (entry.role === 'tool' && entry.callId !== null && callIds.has(entry.callId)) return null
        return <Message key={entry.sequence} run={run} entry={entry} results={results} />
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

function Message({ run, entry, results }: { run: Run; entry: TranscriptEntry; results: ReadonlyMap<string, ToolResult> }) {
  const t = useT()
  if (entry.role === 'user') {
    const text = entry.blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n\n')
    const files = entry.blocks.map((block, index) => ({ block, index })).filter(item => item.block.kind === 'image'
      || item.block.kind === 'file')
    return (
      <div className="tw-user-message">
        <span className="tw-muted-small">{t.run.userLabel} · {formatTime(entry.at)}</span>
        {text !== '' && <div className="tw-bubble"><Markdown text={text} compact /></div>}
        {files.length > 0 && <div className="tw-chip-row">{files.map(item => <BlockChip key={item.index} run={run} entry={entry}
          block={item.block} index={item.index} />)}</div>}
        {entry.blocks.filter(block => block.kind === 'unsupported').map((block, index) => <Unsupported key={index} block={block} />)}
      </div>
    )
  }
  return (
    <div className="tw-assistant-message">
      {entry.blocks.map((block, index) => <Block key={index} run={run} entry={entry} block={block} index={index} results={results} />)}
    </div>
  )
}

function Block({ run, entry, block, index,
  results }: { run: Run; entry: TranscriptEntry; block: TranscriptBlock; index: number; results: ReadonlyMap<string, ToolResult> }) {
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
  const output = result?.entry.blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n') ?? ''
  let pretty = args
  try { pretty = JSON.stringify(JSON.parse(args), null, 2) } catch { /* Partial arguments are shown verbatim. */ }
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

function BlockChip({ run, entry, block, index }: { run: Run; entry: TranscriptEntry; block: TranscriptBlock; index: number }) {
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
