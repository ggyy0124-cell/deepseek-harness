/** Labels, inspector tabs and timing facts of trajectory records, shared by the ledger, the timeline and the inspector. */
import type { Messages } from '../i18n/index.ts'
import { formatMillis } from './format.ts'
import { inputDisplayLines } from './timeline.ts'
import { promptTokens, type AssistantRecord, type InputRecord, type TokenTotals, type Trajectory, type TrajectoryRecord } from './trajectory.ts'
import type { TranscriptEntry } from './types.ts'

/** Tabs of the inspector; which of them a selection offers depends on the record. */
export type DetailTab = 'overview' | 'rendered' | 'raw' | 'source' | 'input' | 'output' | 'schema' | 'timing' | 'options' | 'usage'

/** What the inspector shows: a trajectory record, or the model request behind an assistant message. */
export type Subject =
  | { readonly kind: 'record'; readonly record: TrajectoryRecord }
  | { readonly kind: 'request'; readonly record: AssistantRecord }

/** Identity under which the inspector selects the model request of an assistant message.
 * @param request - one-based request number.
 * @returns selection id.
 */
export function requestId(request: number): string {
  return `q${request}`
}

/** Resolve a selection id.
 * @param trajectory - records of the Run.
 * @param id - record id or request id.
 * @returns what the id selects, or undefined when a refresh removed it.
 */
export function findSubject(trajectory: Trajectory, id: string): Subject | undefined {
  if (/^q\d+$/.test(id)) {
    const record = trajectory.requests[Number(id.slice(1)) - 1]
    return record === undefined ? undefined : { kind: 'request', record }
  }
  const record = trajectory.records.find(candidate => candidate.id === id)
  return record === undefined ? undefined : { kind: 'record', record }
}

/** Tabs a selection offers, in display order.
 * @param subject - selected record or request.
 * @returns tab ids; messages offer overview, preview, raw content and, when stored, source; tool calls offer overview, arguments,
 * result, schema and timing; requests offer overview, options, usage and timing.
 */
export function tabsOf(subject: Subject): readonly DetailTab[] {
  if (subject.kind === 'request') return ['overview', 'options', 'usage', 'timing']
  const { record } = subject
  switch (record.kind) {
    case 'user':
    case 'context': return record.entry.source === null ? ['overview', 'rendered', 'raw'] : ['overview', 'rendered', 'raw', 'source']
    case 'assistant': return ['overview', 'rendered', 'raw']
    case 'input': return ['overview', 'raw']
    case 'tool': return ['overview', ...record.call === undefined ? [] : ['input' as const],
      ...record.result === undefined ? [] : ['output' as const], 'schema', 'timing']
  }
}

/** Short name of a record's kind.
 * @param record - table row.
 * @param t - copy.
 * @returns the kind as shown in tags and tooltips.
 */
export function kindLabel(record: TrajectoryRecord, t: Messages): string {
  const copy = t.run.trajectory.kind
  switch (record.kind) {
    case 'user': return copy.user
    case 'context': return copy.context
    case 'assistant': return copy.assistant
    case 'tool': return copy.tool
    case 'input': return record.input.kind === 'response' ? copy.reply : copy.supplement
  }
}

/** Turn and step that hold a record.
 * @param record - table row.
 * @param t - copy.
 * @returns text such as "Turn 2 · Step 3", "Turn 2 · Messages", or "Between turns" for inputs.
 */
export function locationOf(record: TrajectoryRecord, t: Messages): string {
  const copy = t.run.trajectory
  if (record.kind === 'input') return copy.betweenTurns
  return `${copy.turn(record.turn)} · ${record.step === null ? copy.group.message : copy.group.step(record.step)}`
}

/** Progress of a record.
 * @param record - table row.
 * @param live - the Run can still produce results.
 * @returns `failed` for a failed tool call, `pending` for a call that waits for its result in a live Run, `interrupted` for a
 * call whose Run ended before the result, otherwise `completed`.
 */
export function statusOf(record: TrajectoryRecord, live: boolean): 'failed' | 'pending' | 'interrupted' | 'completed' {
  if (record.kind !== 'tool') return 'completed'
  if (record.failed) return 'failed'
  if (record.result !== undefined) return 'completed'
  return live ? 'pending' : 'interrupted'
}

/** Time to the first streamed token and the generation time that follows it.
 * @param record - model request.
 * @returns both lengths in milliseconds, or undefined unless the start, first token and end are stored in that order.
 */
export function tokenTimings(record: AssistantRecord): { readonly ttftMs: number; readonly decodingMs: number } | undefined {
  const { startedAt, firstTokenAt, endedAt } = record
  if (startedAt === null || firstTokenAt === null || endedAt === null) return undefined
  if (firstTokenAt < startedAt || endedAt < firstTokenAt) return undefined
  return { ttftMs: firstTokenAt - startedAt, decodingMs: endedAt - firstTokenAt }
}

/** Name the origin of a user-role message.
 * @param source - stored `source` object of the message.
 * @param t - copy.
 * @returns a localized name for known origins, otherwise the capitalized origin kind.
 */
export function sourceLabel(source: TranscriptEntry['source'], t: Messages): string {
  const copy = t.run.trajectory.detail.sourceName
  const kind = source?.['kind']
  if (kind === 'user') return copy.user
  if (kind === 'task') return copy.task
  if (kind === 'goal') {
    const round = source?.['round']
    return typeof round === 'number' && round > 0 ? copy.goalRound(round) : copy.goal
  }
  if (typeof kind !== 'string' || kind === '') return copy.unknown
  return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`
}

/** The value of an input record as one line of text.
 * @param record - supplemental input or reply.
 * @param t - copy.
 * @returns the fields joined by a middle dot, each with its label.
 */
export function inputText(record: InputRecord, t: Messages): string {
  return inputDisplayLines(record.input.value, t).map(line => (line.label === undefined ? line.text : `${line.label} ${line.text}`)).join(' · ')
}

/** Token counters of a request as hover text.
 * @param usage - counters of one request.
 * @param t - copy.
 * @returns the input total, cache reads and writes, output and reasoning tokens that were reported.
 */
export function usageTitle(usage: TokenTotals, t: Messages): string {
  const copy = t.run.trajectory
  const count = (value: number) => copy.unit.tokens(value.toLocaleString())
  return [
    `${copy.usage.input} ${count(promptTokens(usage))}`,
    usage.cacheRead === undefined ? null : `${copy.usage.cached} ${count(usage.cacheRead)}`,
    usage.cacheWrite === undefined ? null : `${copy.usage.cacheCreated} ${count(usage.cacheWrite)}`,
    usage.output === undefined ? null : `${copy.usage.output} ${count(usage.output)}`,
    usage.reasoning === undefined ? null : `${copy.usage.reasoning} ${count(usage.reasoning)}`,
  ].filter(part => part !== null).join(' · ')
}

/** Parse text that holds a JSON object or array.
 * @param text - arguments or result text of a tool call.
 * @returns the object or array, or undefined for other JSON values and for text that is not JSON.
 */
export function parseContainer(text: string): object | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? value : undefined
  } catch {
    return undefined // Tool text is often plain prose; callers show it as text.
  }
}

/** Timing facts of a model request, each as display text.
 * @param record - model request.
 * @param t - copy.
 * @returns total duration, delay to the first token, generation time and output throughput; a fact the log cannot give names why.
 */
export function assistantTimings(record: AssistantRecord, t: Messages): {
  total: string
  ttft: string
  generation: string
  throughput: string
} {
  const copy = t.run.trajectory.timing
  const { startedAt, firstTokenAt, endedAt, usage } = record
  const recorded = startedAt !== null || firstTokenAt !== null
  const pending = t.run.trajectory.status.pending
  const span = (from: number | null, to: number | null, missing: string) => (
    from === null ? missing : to === null ? pending : formatMillis(Math.max(0, to - from), t)
  )
  const throughput = (): string => {
    if (usage === undefined) return copy.usageUnavailable
    if (usage.output === undefined) return copy.outputTokensUnavailable
    if (!recorded || firstTokenAt === null) return copy.firstTokenUnavailable
    if (endedAt === null) return pending
    const seconds = (endedAt - firstTokenAt) / 1000
    return seconds <= 0 ? copy.durationTooShort : t.run.trajectory.unit.tokensPerSecond((usage.output / seconds).toFixed(1))
  }
  return {
    total: recorded ? span(startedAt, endedAt, copy.stepStartUnavailable) : copy.notRecorded,
    ttft: !recorded ? copy.notRecorded : startedAt === null ? copy.stepStartUnavailable
      : firstTokenAt === null ? copy.firstTokenUnavailable : formatMillis(Math.max(0, firstTokenAt - startedAt), t),
    generation: recorded ? span(firstTokenAt, endedAt, copy.firstTokenUnavailable) : copy.firstTokenUnavailable,
    throughput: throughput(),
  }
}
