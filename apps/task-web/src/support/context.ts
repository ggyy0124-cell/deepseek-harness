/** Context insight of a Run: the fields of the `dsh-context` plugin's views that the Context view shows, the figures derived
 * from them, and the hook that keeps them current. The views are the plugin's own wire format, so every field is validated here
 * and unknown fields are ignored; a shape this client cannot read is reported instead of guessed.
 */
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useApp } from '../app/context.tsx'
import { describeFailure, isProblem, type RequestFailure } from './connection.ts'
import type { RunContext } from './types.ts'

/** Parts of a request's context, in bar order. */
export const CONTEXT_PARTS = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool'] as const
/** One part of a request's context. */
export type ContextPart = (typeof CONTEXT_PARTS)[number]

const count = z.number().nonnegative()
const optionalCount = count.optional()
const partsShape = {
  system: count, tools: count, user: count, inject: count,
  // Rows folded before the skill category existed carry no `skill` figure.
  skill: count.default(0),
  assistant: count, tool: count, total: count,
}
const partsSchema = z.looseObject(partsShape)
const requestSchema = z.looseObject({
  ...partsShape,
  turn: z.number().int().optional(), step: z.number().int().optional(), time: z.number(), seq: z.number().int(),
  prompt: optionalCount, cacheRead: optionalCount, output: optionalCount, activeMs: optionalCount,
})
const eventSchema = z.looseObject({
  seq: z.number().int(), time: z.number(), kind: z.string(), form: z.string().optional(), tokens: optionalCount,
  count: optionalCount, sub: z.string().optional(), name: z.string().optional(), detail: z.string().optional(),
  from: z.string().optional(), to: z.string().optional(), turn: z.number().int().optional(), step: z.number().int().optional(),
})
const fileOpSchema = z.looseObject({
  seq: z.number().int(), path: z.string(), kind: z.enum(['read', 'write', 'search']), tool: z.string(), time: z.number().optional(),
  err: z.boolean(), added: count, removed: count, pattern: z.literal(true).optional(),
})
const bucketsSchema = z.looseObject({ uncached: count, cacheRead: count, cacheWrite: count, output: count })
const periodsSchema = z.looseObject({ peak: bucketsSchema.optional(), off: bucketsSchema.optional() })
const costSchema = z.record(z.string(), z.record(z.string(), periodsSchema))
const timingSchema = z.looseObject({
  wallMs: count, ttftMs: count, genMs: count, calls: count, toolsMs: count, toolCalls: count,
  tools: z.record(z.string(), z.looseObject({ calls: count, ms: count })),
})
const timelineSchema = z.looseObject({
  unsupported: z.looseObject({ current: z.string(), minimum: z.string() }).optional(),
  model: z.string().optional(), provider: z.string().optional(), contextWindow: optionalCount, maxOutputTokens: optionalCount,
  current: partsSchema,
  toolCalls: optionalCount, humanInputs: optionalCount, answers: optionalCount,
  requests: z.array(requestSchema), events: z.array(eventSchema),
  cost: costSchema.optional(), timing: timingSchema.optional(),
  fileOps: z.array(fileOpSchema).optional(), fileOpsFloor: z.number().int().optional(),
})
const headersSchema = z.looseObject({
  headers: z.array(z.looseObject({
    seq: z.number().int(), time: z.number(), systemTokens: optionalCount,
    tools: z.array(z.looseObject({ name: z.string(), tokens: count, plugin: z.string().optional() })),
  })),
})

/** The `contextTimeline` fields the Context view reads. */
export type ContextTimeline = z.infer<typeof timelineSchema>
/** One answered model request with its context composition. */
export type ContextRequest = ContextTimeline['requests'][number]
/** One change of the context window: compaction, prune, injection, model or mode switch. */
export type ContextEvent = ContextTimeline['events'][number]
/** One executed file operation. */
export type FileOp = NonNullable<ContextTimeline['fileOps']>[number]
/** Tokens of each context part. */
export type ContextParts = z.infer<typeof partsSchema>

/** Context insight of a Run, validated. */
export interface ContextInsight {
  readonly asOfSeq: number
  readonly timeline: ContextTimeline
  /** Tool schemas of the request header in force at the end, with their sources; empty when the header unit is absent. */
  readonly tools: readonly { readonly name: string; readonly tokens: number; readonly plugin?: string | undefined }[]
}

/** Validate the fields this client reads.
 * @param value - response of `GET /runs/{runId}/context`.
 * @returns the insight, or undefined when the plugin's views have a shape this client cannot read.
 */
export function parseContext(value: RunContext): ContextInsight | undefined {
  const timeline = timelineSchema.safeParse(value.timeline)
  if (!timeline.success) return undefined
  const headers = value.headers === null ? undefined : headersSchema.safeParse(value.headers)
  if (headers !== undefined && !headers.success) return undefined
  const tools = headers?.data.headers.at(-1)?.tools ?? []
  return { asOfSeq: value.asOfSeq, timeline: timeline.data, tools }
}

/** Share of a part, as shown next to its tokens.
 * @param part - tokens of the part.
 * @param total - tokens of the whole.
 * @returns whole percentage, `<1` for a non-zero part below one percent, `0` without a whole.
 */
export function sharePercent(part: number, total: number): string {
  if (total <= 0) return '0'
  const percent = (part / total) * 100
  return part > 0 && percent < 1 ? '<1' : String(Math.round(percent))
}

/** Billed tokens of the whole Session, summed over providers, models and pricing periods. */
export interface BilledTokens {
  readonly uncached: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
}

/** Sum the plugin's per-model billing buckets.
 * @param cost - provider → model → pricing period buckets.
 * @returns totals, or null before any request reported usage.
 */
export function billedTokens(cost: ContextTimeline['cost']): BilledTokens | null {
  if (cost === undefined) return null
  const total = { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  for (const models of Object.values(cost)) {
    for (const periods of Object.values(models)) {
      for (const buckets of [periods.peak, periods.off]) {
        if (buckets === undefined) continue
        total.uncached += buckets.uncached
        total.cacheRead += buckets.cacheRead
        total.cacheWrite += buckets.cacheWrite
        total.output += buckets.output
      }
    }
  }
  return total
}

/** Share of billed prompt tokens served from the cache.
 * @param billed - billed totals.
 * @returns whole percentage, or null without prompt tokens.
 */
export function cacheHit(billed: BilledTokens): number | null {
  const prompt = billed.uncached + billed.cacheRead + billed.cacheWrite
  return prompt === 0 ? null : Math.floor((billed.cacheRead / prompt) * 100)
}

/** Number of turns among the retained requests.
 * @param requests - request records.
 * @returns distinct turns; requests without a turn count as none.
 */
export function turnCount(requests: readonly ContextRequest[]): number {
  return new Set(requests.flatMap(request => (request.turn === undefined ? [] : [request.turn]))).size
}

/** Compactions and prunes, the events that shrink the context. */
const SHRINKING = new Set(['compaction', 'prune'])

/** Events that shrank the context, each placed before the first request after it.
 * @param requests - request records in log order.
 * @param events - context events in log order.
 * @returns index of the following request (the request count when none followed) and the event.
 */
export function shrinkMarkers(requests: readonly ContextRequest[], events: readonly ContextEvent[]):
readonly { readonly index: number; readonly event: ContextEvent }[] {
  return events.filter(event => SHRINKING.has(event.kind)).map((event) => {
    const index = requests.findIndex(request => request.seq > event.seq)
    return { index: index === -1 ? requests.length : index, event }
  })
}

/** File operations of one file or search pattern. */
export interface FileActivity {
  readonly path: string
  readonly pattern: boolean
  readonly reads: number
  readonly writes: number
  readonly searches: number
  readonly added: number
  readonly removed: number
  readonly errors: number
  /** Sequence of the newest operation. */
  readonly latest: number
}

/** Group file operations by file, most operations first, then most recent.
 * @param ops - file operations.
 * @returns one row per file or search pattern.
 */
export function fileActivity(ops: readonly FileOp[]): readonly FileActivity[] {
  const rows = new Map<string, { -readonly [K in keyof FileActivity]: FileActivity[K] }>()
  for (const op of ops) {
    const key = `${op.pattern === true ? 'pattern' : 'file'}:${op.path}`
    const row = rows.get(key) ?? { path: op.path, pattern: op.pattern === true, reads: 0, writes: 0, searches: 0, added: 0, removed: 0,
      errors: 0, latest: op.seq }
    if (op.kind === 'read') row.reads++
    else if (op.kind === 'write') row.writes++
    else row.searches++
    row.added += op.added
    row.removed += op.removed
    if (op.err) row.errors++
    row.latest = Math.max(row.latest, op.seq)
    rows.set(key, row)
  }
  const total = (row: FileActivity) => row.reads + row.writes + row.searches
  return [...rows.values()].sort((a, b) => total(b) - total(a) || b.latest - a.latest)
}

/** One tool with its schema price, source and run time. */
export interface ToolRow {
  readonly name: string
  readonly plugin?: string | undefined
  /** Tokens of its schema in the request header; null when the tool is not in the latest header. */
  readonly tokens: number | null
  readonly calls: number
  readonly ms: number
}

/** Join the latest header's tool schemas with the tools' call counts and run times, most expensive schema first.
 * @param insight - context insight.
 * @returns one row per tool in the header or with recorded calls.
 */
export function toolRows(insight: ContextInsight): readonly ToolRow[] {
  const timing = insight.timeline.timing?.tools ?? {}
  const rows = new Map<string, ToolRow>()
  for (const tool of insight.tools) rows.set(tool.name, { name: tool.name, plugin: tool.plugin, tokens: tool.tokens, calls: 0, ms: 0 })
  for (const [name, used] of Object.entries(timing)) {
    const row = rows.get(name)
    rows.set(name, { name, plugin: row?.plugin, tokens: row?.tokens ?? null, calls: used.calls, ms: used.ms })
  }
  return [...rows.values()].sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1) || b.calls - a.calls || a.name.localeCompare(b.name))
}

/** State of the Context view. */
export type ContextState =
  | { readonly status: 'loading' }
  /** The Task host does not compose the `dsh-context` plugin. */
  | { readonly status: 'unavailable' }
  /** The Run's Session is not stored yet. */
  | { readonly status: 'pending' }
  /** The plugin's views have a shape this client cannot read. */
  | { readonly status: 'incompatible' }
  | { readonly status: 'failed'; readonly failure: RequestFailure }
  | { readonly status: 'ready'; readonly insight: ContextInsight }

/** Delay after the last Session change before the insight is read again, so a burst of events costs one read. */
const REFRESH_DELAY_MS = 600

/** Keep a Run's context insight current while the Context view is shown.
 * @param runId - execution.
 * @param version - changes whenever the stored transcript or the Run status changes, which schedules a new read.
 * @param enabled - false while the Context view is not shown.
 * @returns the latest state; a failed refresh keeps the last insight.
 */
export function useRunContext(runId: string, version: string, enabled: boolean): ContextState {
  const { connection } = useApp()
  const [state, setState] = useState<{ readonly runId: string; readonly value: ContextState } | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      connection.call('getRunContext', { params: { runId }, signal: controller.signal }).then((value) => {
        const insight = parseContext(value)
        setState({ runId, value: insight === undefined ? { status: 'incompatible' } : { status: 'ready', insight } })
      }, (error: unknown) => {
        // An abandoned read reports nothing; an expired sign-in was already handed to the sign-in screen by the connection.
        if (controller.signal.aborted) return
        const value: ContextState = isProblem(error, 'context_unavailable') ? { status: 'unavailable' }
          : isProblem(error, 'session_unavailable') ? { status: 'pending' } : { status: 'failed', failure: describeFailure(error) }
        setState(current => (current?.runId === runId && current.value.status === 'ready' && value.status === 'failed' ? current : { runId, value }))
      })
    }, REFRESH_DELAY_MS)
    return () => { clearTimeout(timer); controller.abort() }
  }, [connection, runId, version, enabled])
  return state?.runId === runId ? state.value : { status: 'loading' }
}
