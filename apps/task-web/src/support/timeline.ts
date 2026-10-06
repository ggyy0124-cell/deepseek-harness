/** Conversation timeline: places people-authored inputs among stored messages and splits each turn into process and answer. */
import type { Messages } from '../i18n/index.ts'
import type { Json, RunInput, TranscriptBlock, TranscriptEntry } from './types.ts'

/** One block of a message with the message that carries it. */
export interface Step {
  readonly entry: TranscriptEntry
  readonly block: TranscriptBlock
  readonly index: number
}

/** One stage instruction or input boundary followed by the Agent messages it caused. */
export interface Turn {
  readonly kind: 'turn'
  /** Sequence of the turn's first message; stable while later messages arrive. */
  readonly key: number
  readonly instruction: TranscriptEntry | undefined
  /** Reasoning, tool calls and the narration between them; folds into one summary row. */
  readonly process: readonly Step[]
  /** Blocks after the last reasoning or tool call; always visible. */
  readonly answer: readonly Step[]
  readonly toolCalls: number
  /** Milliseconds from the turn's first to its last message. */
  readonly spanMs: number
}

/** A supplemental input or business-wait reply a person gave the Run. */
export interface InputItem {
  readonly kind: 'input'
  readonly key: number
  readonly input: RunInput
}

/** One position of the conversation column. */
export type TimelineItem = Turn | InputItem

/** A stage instruction with the stored messages that follow it, before they are split into process and answer. */
export interface TurnDraft {
  readonly kind: 'draft'
  /** Sequence of the first message; stable while later messages arrive. */
  readonly key: number
  readonly instruction: TranscriptEntry | undefined
  /** Assistant and tool-result messages in sequence order; never a user message. */
  readonly entries: readonly TranscriptEntry[]
  /** The instruction, or the first message when no instruction was stored. */
  readonly first: TranscriptEntry
  /** The last message of the turn, or the instruction when nothing followed it. */
  readonly last: TranscriptEntry
}

interface Draft {
  readonly first: TranscriptEntry
  readonly instruction: TranscriptEntry | undefined
  readonly entries: TranscriptEntry[]
  last: TranscriptEntry
}

/** Merge stored messages and inputs by time and group the messages into turns.
 * @param entries - stored messages in sequence order.
 * @param inputs - inputs people gave the Run, in arrival order.
 * @returns turn drafts and input boundaries; an input arriving at the same millisecond as a message precedes it.
 */
export function groupTurns(entries: readonly TranscriptEntry[], inputs: readonly RunInput[]): readonly (TurnDraft | InputItem)[] {
  const waiting = [...inputs].sort((left, right) => left.revision - right.revision)
  const items: (TurnDraft | InputItem)[] = []
  let draft: Draft | undefined
  let next = 0
  const close = () => {
    if (draft !== undefined) items.push(settle(draft))
    draft = undefined
  }
  const place = (until: number) => {
    let input = waiting[next]
    while (input !== undefined && Date.parse(input.at) <= until) {
      close()
      items.push({ kind: 'input', key: input.revision, input })
      input = waiting[++next]
    }
  }
  for (const entry of entries) {
    place(Date.parse(entry.at))
    if (entry.role === 'user') {
      close()
      draft = { first: entry, last: entry, instruction: entry, entries: [] }
    } else {
      draft ??= { first: entry, last: entry, instruction: undefined, entries: [] }
      draft.entries.push(entry)
      draft.last = entry
    }
  }
  close()
  place(Number.POSITIVE_INFINITY)
  return items
}

function settle(draft: Draft): TurnDraft {
  return { kind: 'draft', key: draft.first.sequence, instruction: draft.instruction, entries: draft.entries, first: draft.first,
    last: draft.last }
}

/** Merge stored messages and inputs by time and split the Agent turns.
 * @param entries - stored messages in sequence order.
 * @param inputs - inputs people gave the Run, in arrival order.
 * @returns turns and input boundaries; an input arriving at the same millisecond as a message precedes it.
 */
export function buildTimeline(entries: readonly TranscriptEntry[], inputs: readonly RunInput[]): readonly TimelineItem[] {
  const paired = new Set(entries.flatMap(entry => entry.blocks.flatMap(block => (block.kind === 'tool_call' ? [block.callId] : []))))
  return groupTurns(entries, inputs).map(item => (item.kind === 'input' ? item : finish(item, paired)))
}

function finish(draft: TurnDraft, paired: ReadonlySet<string>): Turn {
  const steps: Step[] = []
  for (const entry of draft.entries) {
    if (entry.role === 'tool' && entry.callId !== null && paired.has(entry.callId)) continue
    entry.blocks.forEach((block, index) => { steps.push({ entry, block, index }) })
  }
  let boundary = -1
  steps.forEach((step, position) => {
    if (step.block.kind === 'reasoning' || step.block.kind === 'tool_call') boundary = position
  })
  return {
    kind: 'turn',
    key: draft.key,
    instruction: draft.instruction,
    process: steps.slice(0, boundary + 1),
    answer: steps.slice(boundary + 1),
    toolCalls: steps.filter(step => step.block.kind === 'tool_call').length,
    spanMs: Math.max(0, Date.parse(draft.last.at) - Date.parse(draft.first.at)),
  }
}

/** One labelled value of an input. */
export interface InputLine {
  readonly label?: string
  readonly text: string
}

/** Split an input value into display lines.
 * @param value - supplemental text or a structured reply.
 * @returns the text itself, or one line per non-empty object field; nested values read as compact JSON.
 */
export function inputLines(value: Json): readonly InputLine[] {
  if (typeof value === 'string') return [{ text: value }]
  if (value === null || typeof value !== 'object') return [{ text: String(value) }]
  if (Array.isArray(value)) return [{ text: JSON.stringify(value) }]
  return Object.entries(value)
    .filter(([, item]) => item !== '' && item !== null)
    .map(([label, item]) => ({ label, text: typeof item === 'string' ? item : JSON.stringify(item) }))
}

/** Display lines of an input a person gave; a confirmation reads as the label of its button.
 * @param value - supplemental text, a structured reply or a confirmation.
 * @param t - copy.
 * @returns lines to show.
 */
export function inputDisplayLines(value: Json, t: Messages): readonly InputLine[] {
  if (typeof value === 'boolean') return [{ text: value ? t.interaction.approve : t.interaction.reject }]
  return inputLines(value)
}

/** Concatenate the blocks of one kind of a stored message.
 * @param entry - stored message; undefined reads as empty.
 * @param kind - block kind to read.
 * @param separator - text between blocks.
 * @returns joined text.
 */
export function blockText(entry: TranscriptEntry | undefined, kind: 'text' | 'reasoning', separator = '\n'): string {
  if (entry === undefined) return ''
  return entry.blocks.flatMap(block => (block.kind === kind ? [block.text] : [])).join(separator)
}

/** Reformat tool call arguments as indented JSON.
 * @param args - arguments JSON text.
 * @returns indented JSON, or the text itself when it is not complete JSON.
 */
export function prettyArguments(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2)
  } catch {
    return args // Streaming tool calls may store partial argument text.
  }
}
