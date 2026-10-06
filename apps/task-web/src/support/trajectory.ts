/** Trajectory of a Run: every stored message and input as one record, grouped by turn and step,
 * with the time, tokens and request each took. */
import { blockText, inputLines } from './timeline.ts'
import type { RunInput, TranscriptBlock, TranscriptEntry, TranscriptRequest, TranscriptTool } from './types.ts'

/** Token counts of one model request. */
export type Usage = NonNullable<TranscriptEntry['usage']>

/** One tool call block of an assistant message. */
export type ToolCallBlock = Extract<TranscriptBlock, { kind: 'tool_call' }>

/** Token counters summed over model requests; a counter is absent until a request reports it. */
export interface TokenTotals {
  readonly input?: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
  readonly output?: number
  readonly reasoning?: number
}

/** When the operation behind a record ran, as epoch milliseconds taken from stored times. */
export interface Timing {
  /** Start of the operation; null when no stored time says so. */
  readonly startedAt: number | null
  /** End of the operation; null for an instant and while the operation still runs. */
  readonly endedAt: number | null
}

interface RecordBase extends Timing {
  /** Stable identity: the sequence of the stored message, or the revision of the input. */
  readonly id: string
  /** One-based position in the display order of the Run, shown as `#N`. */
  readonly index: number
}

/** A user-role message: the instruction the Task sent (`user`) or context the Session injected (`context`). */
export interface MessageRecord extends RecordBase {
  readonly kind: 'user' | 'context'
  readonly turn: number
  /** Step in force when the message was stored; null before the first step of the turn. */
  readonly step: number | null
  readonly entry: TranscriptEntry
}

/** A supplemental input or business-wait reply, which sits between turns. */
export interface InputRecord extends RecordBase {
  readonly kind: 'input'
  readonly input: RunInput
}

/** A tool call block with the id of the record that shows the call. */
export interface CallRef {
  readonly id: string
  readonly block: ToolCallBlock
}

/** One model request. */
export interface AssistantRecord extends RecordBase {
  readonly kind: 'assistant'
  readonly turn: number
  readonly step: number
  readonly entry: TranscriptEntry
  readonly calls: readonly CallRef[]
  /** One-based position among the model requests of the Run. */
  readonly request: number
  /** Request header in force when the request was sent; undefined when the Session logged none. */
  readonly header: TranscriptRequest | undefined
  /** Arrival of the first streamed token; null when the stream recorded none. */
  readonly firstTokenAt: number | null
  /** Tokens of this request; undefined when the provider reported none. */
  readonly usage: TokenTotals | undefined
  /** Tokens of every request up to and including this one. */
  readonly cumulative: TokenTotals
}

/** One tool call the Agent requested. */
export interface ToolRecord extends RecordBase {
  readonly kind: 'tool'
  readonly turn: number
  readonly step: number | null
  /** The call block; undefined for a stored result whose call is not part of the stored messages. */
  readonly call: ToolCallBlock | undefined
  /** The stored result; undefined while the tool has not answered. */
  readonly result: TranscriptEntry | undefined
  readonly failed: boolean
  /** Declaration the model saw for this tool in the request that asked for the call. */
  readonly schema: TranscriptTool | undefined
  /** One-based number of the request that asked for the call. */
  readonly request: number | undefined
  /** Id of the assistant record that asked for the call. */
  readonly parent: string | undefined
}

/** One row of the trajectory ledger. */
export type TrajectoryRecord = MessageRecord | InputRecord | AssistantRecord | ToolRecord

/** A record that belongs to a turn. */
export type TurnRecord = Exclude<TrajectoryRecord, InputRecord>

/** The messages of a turn that share a step, or the messages stored before the first step. */
export interface TrajectoryGroup {
  readonly id: string
  /** Step number; null for the messages stored before the first step. */
  readonly step: number | null
  readonly records: readonly TurnRecord[]
  /** Milliseconds from the first request or tool start to the last end of the group; null when no stored time says so. */
  readonly spanMs: number | null
}

/** One loop turn with the requests and tool calls it caused. */
export interface TrajectoryTurn {
  readonly kind: 'turn'
  /** Identity of the turn's first record; stable while later messages arrive. */
  readonly key: string
  /** Turn number the loop logged. */
  readonly turn: number
  readonly groups: readonly TrajectoryGroup[]
  readonly records: readonly TurnRecord[]
  readonly steps: number
  readonly toolCalls: number
  readonly failed: number
  readonly promptTokens: number
  readonly outputTokens: number
}

/** One position of the trajectory ledger. */
export type TrajectoryItem = TrajectoryTurn | InputRecord

/** Records of a Run in display order, with totals. */
export interface Trajectory {
  readonly items: readonly TrajectoryItem[]
  /** Every record in display order, inputs included. */
  readonly records: readonly TrajectoryRecord[]
  /** Model requests in order; request N is element N − 1. */
  readonly requests: readonly AssistantRecord[]
  readonly steps: number
  readonly toolCalls: number
  readonly failed: number
  /** Milliseconds from the first stored time to the last; 0 without records. */
  readonly spanMs: number
  readonly promptTokens: number
  readonly outputTokens: number
}

/** Tokens the model read: uncached input plus cached input.
 * @param usage - counters of one request or a sum of requests; a counter that was not reported counts as zero.
 * @returns prompt size.
 */
export function promptTokens(usage: TokenTotals): number {
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
}

/** Length of the operation behind a record.
 * @param timing - start and end of the operation.
 * @returns milliseconds, or null for an instant, a running operation and a missing start.
 */
export function durationOf(timing: Timing): number | null {
  return timing.startedAt === null || timing.endedAt === null ? null : Math.max(0, timing.endedAt - timing.startedAt)
}

/** First non-empty line of a text, bounded for one table cell.
 * @param text - any text.
 * @returns the line without surrounding blanks, or an empty string.
 */
export function firstLine(text: string): string {
  const line = text.split('\n').map(item => item.trim()).find(item => item !== '')
  return line === undefined ? '' : line.slice(0, 240)
}

const stamp = (iso: string | null): number | null => (iso === null ? null : Date.parse(iso))

const COUNTERS = ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'] as const

function tokensOf(usage: Usage | null): TokenTotals | undefined {
  if (usage === null) return undefined
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    ...(usage.cacheReadTokens === null ? {} : { cacheRead: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === null ? {} : { cacheWrite: usage.cacheWriteTokens }),
    ...(usage.reasoningTokens === null ? {} : { reasoning: usage.reasoningTokens }),
  }
}

function addTokens(total: TokenTotals, usage: TokenTotals): TokenTotals {
  const next: { -readonly [Counter in keyof TokenTotals]: number } = {}
  for (const counter of COUNTERS) {
    const left = total[counter]
    const right = usage[counter]
    if (left !== undefined || right !== undefined) next[counter] = (left ?? 0) + (right ?? 0)
  }
  return next
}

/** Turn of each message: the number the loop logged, or for a message stored before its turn started, the number of the turn after it. */
function assignTurns(entries: readonly TranscriptEntry[]): readonly number[] {
  let following = 1 + entries.reduce((highest, entry) => Math.max(highest, entry.turn ?? 0), 0)
  const turns: number[] = []
  for (let position = entries.length - 1; position >= 0; position--) {
    following = entries[position]?.turn ?? following
    turns.push(following)
  }
  return turns.reverse()
}

/** Messages `[from, to)` that share one turn number. */
interface TurnSpan {
  readonly turn: number
  readonly from: number
  readonly to: number
}

/** A run of consecutive messages with one turn number; a number that comes back later opens a new span. */
function splitTurns(turns: readonly number[]): readonly TurnSpan[] {
  const spans: TurnSpan[] = []
  turns.forEach((turn, position) => {
    const last = spans.at(-1)
    if (last !== undefined && last.turn === turn) spans[spans.length - 1] = { turn, from: last.from, to: position + 1 }
    else spans.push({ turn, from: position, to: position + 1 })
  })
  return spans
}

type Slot = { readonly kind: 'input'; readonly input: RunInput } | { readonly kind: 'turn'; readonly span: TurnSpan }

/** Put each input before the first turn that started no earlier than it; an input arriving at the same millisecond precedes the turn. */
function placeInputs(entries: readonly TranscriptEntry[], spans: readonly TurnSpan[], inputs: readonly RunInput[]): readonly Slot[] {
  const waiting = [...inputs].sort((left, right) => left.revision - right.revision)
  const slots: Slot[] = []
  let next = 0
  for (const span of spans) {
    const started = Date.parse(entries[span.from]?.at ?? '')
    for (let input = waiting[next]; input !== undefined && Date.parse(input.at) <= started; input = waiting[++next]) {
      slots.push({ kind: 'input', input })
    }
    slots.push({ kind: 'turn', span })
  }
  for (const input of waiting.slice(next)) slots.push({ kind: 'input', input })
  return slots
}

interface Pairing {
  /** Stored result of each call block, keyed `<assistant sequence>:<block position>`. */
  readonly results: ReadonlyMap<string, TranscriptEntry>
  /** Sequences of the results a call block claimed. */
  readonly claimed: ReadonlySet<number>
}

/** Match every call block with the first stored result of its call id that follows the request. */
function pairResults(entries: readonly TranscriptEntry[]): Pairing {
  const waiting = new Map<string, TranscriptEntry[]>()
  for (const entry of entries) {
    if (entry.role !== 'tool' || entry.callId === null) continue
    waiting.set(entry.callId, [...waiting.get(entry.callId) ?? [], entry])
  }
  const results = new Map<string, TranscriptEntry>()
  const claimed = new Set<number>()
  for (const entry of entries) {
    if (entry.role !== 'assistant') continue
    entry.blocks.forEach((block, position) => {
      if (block.kind !== 'tool_call') return
      const queue = waiting.get(block.callId) ?? []
      const found = queue.findIndex(result => result.sequence > entry.sequence)
      const result = queue[found]
      if (result === undefined) return
      queue.splice(found, 1)
      results.set(`${entry.sequence}:${position}`, result)
      claimed.add(result.sequence)
    })
  }
  return { results, claimed }
}

/** Running counters while records are numbered in display order. */
interface Counter {
  index: number
  request: number
  header: TranscriptRequest | undefined
  /** Position of the next request header not yet in force. */
  cursor: number
  cumulative: TokenTotals
}

/** Message of the session that the Task or a person wrote, as opposed to context the Session injected. */
function isInstruction(entry: TranscriptEntry): boolean {
  const kind = entry.source?.['kind']
  return kind === 'user' || kind === 'task'
}

/** Milliseconds from the earliest to the latest of the given times; null without any. */
function spanOf(times: readonly (number | null)[]): number | null {
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const time of times) {
    if (time === null) continue
    first = Math.min(first, time)
    last = Math.max(last, time)
  }
  return first > last ? null : last - first
}

function groupRecords(records: readonly TurnRecord[], turn: number): readonly TrajectoryGroup[] {
  const drafts: { step: number | null; records: TurnRecord[] }[] = []
  for (const record of records) {
    const step = record.step
    const last = drafts.at(-1)
    if (last !== undefined && last.step === step) last.records.push(record)
    else drafts.push({ step, records: [record] })
  }
  return drafts.map(({ step, records: members }) => ({
    id: `${turn}:${step ?? 'messages'}`,
    step,
    records: members,
    spanMs: step === null ? null : spanOf(members.flatMap(member => (member.kind === 'user' || member.kind === 'context'
      ? [] : [member.startedAt, member.endedAt]))),
  }))
}

function buildTurn(entries: readonly TranscriptEntry[], span: TurnSpan, pairing: Pairing, requests: readonly TranscriptRequest[],
  counter: Counter): TrajectoryTurn {
  const { turn } = span
  const records: TurnRecord[] = []
  let step: number | null = null
  for (const entry of entries.slice(span.from, span.to)) {
    const at = Date.parse(entry.at)
    if (entry.role === 'user') {
      records.push({ kind: isInstruction(entry) ? 'user' : 'context', id: `m${entry.sequence}`, index: ++counter.index, startedAt: at,
        endedAt: null, turn, step: entry.step, entry })
    } else if (entry.role === 'tool') {
      if (pairing.claimed.has(entry.sequence)) continue
      records.push({ kind: 'tool', id: `m${entry.sequence}`, index: ++counter.index, startedAt: stamp(entry.startedAt) ?? at, endedAt: at,
        turn, step: entry.step ?? step, call: undefined, result: entry, failed: entry.isError, schema: undefined, request: undefined,
        parent: undefined })
    } else {
      step = entry.step ?? (step ?? 0) + 1
      counter.request += 1
      for (let next = requests[counter.cursor]; next !== undefined && next.sequence < entry.sequence; next = requests[++counter.cursor]) {
        counter.header = next
      }
      const usage = tokensOf(entry.usage)
      if (usage !== undefined) counter.cumulative = addTokens(counter.cumulative, usage)
      const id = `m${entry.sequence}`
      const calls = entry.blocks.flatMap((block, position) => (block.kind === 'tool_call' ? [{ id: `${id}:${position}`, block, position }] : []))
      records.push({ kind: 'assistant', id, index: ++counter.index, startedAt: stamp(entry.startedAt), endedAt: at, turn, step, entry,
        calls: calls.map(({ id: callId, block }) => ({ id: callId, block })), request: counter.request, header: counter.header,
        firstTokenAt: stamp(entry.firstTokenAt), usage, cumulative: counter.cumulative })
      for (const { id: callId, block, position } of calls) {
        const result = pairing.results.get(`${entry.sequence}:${position}`)
        records.push({ kind: 'tool', id: callId, index: ++counter.index, startedAt: stamp(result?.startedAt ?? null) ?? at,
          endedAt: result === undefined ? null : Date.parse(result.at), turn, step, call: block, result, failed: result?.isError === true,
          schema: counter.header?.tools.find(tool => tool.name === block.name), request: counter.request, parent: id })
      }
    }
  }
  const requestRecords = records.filter((record): record is AssistantRecord => record.kind === 'assistant')
  const tools = records.filter((record): record is ToolRecord => record.kind === 'tool')
  return {
    kind: 'turn',
    key: records[0]?.id ?? String(turn),
    turn,
    groups: groupRecords(records, turn),
    records,
    steps: requestRecords.length,
    toolCalls: tools.length,
    failed: tools.filter(tool => tool.failed).length,
    promptTokens: requestRecords.reduce((sum, record) => sum + (record.usage === undefined ? 0 : promptTokens(record.usage)), 0),
    outputTokens: requestRecords.reduce((sum, record) => sum + (record.usage?.output ?? 0), 0),
  }
}

/** Group stored messages and inputs into trajectory records.
 * @param entries - stored messages in sequence order.
 * @param inputs - inputs people gave the Run.
 * @param requests - request headers in sequence order; each applies to the requests stored after it.
 * @returns turns with their records and the totals of the Run. A request lasts from the start of its step to its message, and a
 * tool call from its start to its result; both are null when the log lacks the start.
 */
export function buildTrajectory(entries: readonly TranscriptEntry[], inputs: readonly RunInput[],
  requests: readonly TranscriptRequest[]): Trajectory {
  const pairing = pairResults(entries)
  const counter: Counter = { index: 0, request: 0, header: undefined, cursor: 0, cumulative: {} }
  const items: TrajectoryItem[] = []
  for (const slot of placeInputs(entries, splitTurns(assignTurns(entries)), inputs)) {
    if (slot.kind === 'turn') {
      items.push(buildTurn(entries, slot.span, pairing, requests, counter))
    } else {
      const { input } = slot
      items.push({ kind: 'input', id: `i${input.revision}`, index: ++counter.index, startedAt: Date.parse(input.at), endedAt: null, input })
    }
  }
  const records = items.flatMap((item): readonly TrajectoryRecord[] => (item.kind === 'input' ? [item] : item.records))
  const sum = (pick: (turn: TrajectoryTurn) => number) => items.reduce((total, item) => total + (item.kind === 'turn' ? pick(item) : 0), 0)
  return {
    items,
    records,
    requests: records.filter((record): record is AssistantRecord => record.kind === 'assistant'),
    steps: sum(turn => turn.steps),
    toolCalls: sum(turn => turn.toolCalls),
    failed: sum(turn => turn.failed),
    spanMs: spanOf(records.flatMap(record => [record.startedAt, record.endedAt])) ?? 0,
    promptTokens: sum(turn => turn.promptTokens),
    outputTokens: sum(turn => turn.outputTokens),
  }
}

/** All text of a record that a search can match.
 * @param record - table row.
 * @returns text, newline separated.
 */
export function recordText(record: TrajectoryRecord): string {
  switch (record.kind) {
    case 'user':
    case 'context': return blockText(record.entry, 'text')
    case 'input': return typeof record.input.value === 'boolean' ? String(record.input.value)
      : inputLines(record.input.value).map(line => `${line.label ?? ''} ${line.text}`).join('\n')
    case 'assistant': return [blockText(record.entry, 'text'), blockText(record.entry, 'reasoning'),
      ...record.calls.map(call => `${call.block.name} ${call.block.arguments}`)].join('\n')
    case 'tool': return [record.call?.name ?? '', record.call?.arguments ?? '', blockText(record.result, 'text')].join('\n')
  }
}

/** Whether a record contains a search text.
 * @param record - table row.
 * @param needle - lower-case search text; empty matches every record.
 * @returns true when the record's text contains the needle.
 */
export function matchesRecord(record: TrajectoryRecord, needle: string): boolean {
  return needle === '' || recordText(record).toLowerCase().includes(needle)
}
