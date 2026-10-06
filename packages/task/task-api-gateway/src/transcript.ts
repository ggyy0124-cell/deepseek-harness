/** Bounded read-only Task transcript windows over the existing Session persistence provider. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { assistantStreamFirstTokenTime, type ContentBlock, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { isAppendSurfaceEvent, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  SessionPersistenceNotFoundError,
  type SessionPersistence,
} from '@deepseek-ai/dsh-session-persistence'
import type { TaskRunId, TaskService } from '@deepseek-ai/dsh-task'
import {
  pageQuerySchema,
  type transcriptBlockSchema,
  type transcriptEntrySchema,
  type transcriptRequestSchema,
} from '@deepseek-ai/dsh-task-api-protocol'
import { HttpProblem, validate } from './http.ts'

/** A cursor remembers at most this many tool calls without a result, dropping the oldest, which keeps it under the 2048-character limit. */
const PENDING_CALL_LIMIT = 4
/** A call whose id is longer is not remembered; its result reports no start time. */
const CALL_ID_LIMIT = 128
/** Loop position that events after a window boundary depend on: the cursor carries it from one window to the next. */
const lifecycleSchema = z.strictObject({
  turn: z.number().int().nonnegative().nullable(),
  /** Step entered last in `turn` and the time of its `step/start` event; null before the first step of the turn. */
  step: z.strictObject({ number: z.number().int().nonnegative(), at: z.number().nonnegative() }).nullable(),
  /** Call id and time of each `tool/call` event whose result has not been read yet, oldest first. */
  calls: z.array(z.tuple([z.string().max(CALL_ID_LIMIT), z.number().nonnegative()])).max(PENDING_CALL_LIMIT),
})
type Lifecycle = z.infer<typeof lifecycleSchema>
const BETWEEN_TURNS: Lifecycle = { turn: null, step: null, calls: [] }
const cursorSchema = z.strictObject({
  version: z.literal(1),
  session: z.string(),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  anchor: z.string(),
  lifecycle: lifecycleSchema,
})
const jsonObject = z.record(z.string(), z.json())
type Block = z.infer<typeof transcriptBlockSchema>
type Entry = z.infer<typeof transcriptEntrySchema>
type Request = z.infer<typeof transcriptRequestSchema>

function blocks(content: readonly ContentBlock[]): Block[] {
  return content.flatMap((block): Block[] => {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        return [{ kind: block.type, text: block.text }]
      case 'tool-call':
        return [{ kind: 'tool_call', callId: block.id, name: block.name, arguments: block.arguments }]
      case 'image':
        return [{ kind: 'image', name: block.attachment.name ?? block.attachment.attachmentId,
          bytes: block.attachment.bytes, mediaType: block.attachment.mediaType }]
      case 'file':
        return [{ kind: 'file', name: block.attachment.name, bytes: block.attachment.bytes, mediaType: 'application/octet-stream' }]
      // Extension blocks are merge-extensible and remain opaque.
      default:
        return [{ kind: 'unsupported', type: block.type }]
    }
  })
}

/** Read only original, visible message content from an existing Session event.
 * @param event - validated durable event.
 * @returns message blocks or an empty list for internal and replacement events.
 */
export function taskTranscriptContent(event: SessionEvent): readonly ContentBlock[] {
  if (!isAppendSurfaceEvent(event)) return []
  switch (event.type) {
    case 'user/message': return event.data.content
    case 'assistant/message': return event.data.message.content
    case 'tool/result': return event.data.message.content
    default: return []
  }
}
function usage(value: TokenUsage | undefined): Entry['usage'] {
  if (value === undefined) return null
  return {
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    cacheReadTokens: value.cacheReadTokens ?? null,
    cacheWriteTokens: value.cacheWriteTokens ?? null,
    reasoningTokens: value.reasoningTokens ?? null,
  }
}
function iso(time: number): string {
  return new Date(time).toISOString()
}
/** Loop position after one event. */
function advance(state: Lifecycle, event: SessionEvent): Lifecycle {
  switch (event.type) {
    case 'turn/start': return { turn: event.data.turn, step: null, calls: [] }
    case 'turn/end': return BETWEEN_TURNS
    case 'step/start': return { ...state, turn: event.data.turn, step: { number: event.data.step, at: event.time } }
    case 'tool/call': {
      if (event.data.callId.length > CALL_ID_LIMIT) return state
      const call: [string, number] = [event.data.callId, event.time]
      return { ...state, calls: [...state.calls, call].slice(-PENDING_CALL_LIMIT) }
    }
    case 'tool/result':
      return { ...state, calls: state.calls.filter(([callId]) => callId !== event.data.message.toolCallId) }
    default: return state
  }
}
function request(event: SessionEvent<'request/header'>): Request {
  const { reason, header } = event.data
  return {
    sequence: event.seq,
    at: iso(event.time),
    reason,
    config: jsonObject.parse(header.config),
    tools: (header.tools ?? []).map(tool => ({
      name: tool.name, description: tool.description, parameters: jsonObject.parse(tool.parameters),
    })),
  }
}
/** Public message of one event; `state` is the loop position before the event. */
function project(event: SessionEvent, state: Lifecycle): Entry | undefined {
  const common = {
    sequence: event.seq,
    at: iso(event.time),
    callId: null,
    isError: false,
    model: null,
    usage: null,
    turn: state.turn,
    step: state.step?.number ?? null,
    source: null,
    startedAt: null,
    firstTokenAt: null,
  }
  switch (event.type) {
    case 'user/message':
      return isAppendSurfaceEvent(event)
        ? { ...common, role: 'user', blocks: blocks(event.data.content), source: jsonObject.parse(event.data.source) }
        : undefined
    case 'assistant/message': {
      if (!isAppendSurfaceEvent(event)) return undefined
      const firstToken = assistantStreamFirstTokenTime(event.data.stream)
      return {
        ...common,
        role: 'assistant',
        turn: event.data.turn,
        step: event.data.step,
        blocks: blocks(event.data.message.content),
        model: event.data.message.source.model,
        usage: usage(event.data.usage),
        startedAt: state.step === null ? null : iso(state.step.at),
        firstTokenAt: firstToken === undefined ? null : iso(firstToken),
      }
    }
    case 'tool/result': {
      if (!isAppendSurfaceEvent(event)) return undefined
      const result = event.data.message
      const call = state.calls.find(([callId]) => callId === result.toolCallId)
      return {
        ...common,
        role: 'tool',
        turn: event.data.turn,
        step: event.data.step,
        callId: result.toolCallId,
        isError: result.isError === true,
        blocks: blocks(result.content),
        startedAt: call === undefined ? null : iso(call[1]),
      }
    }
    // Session events are merge-extensible; only original transcript messages are public here.
    default:
      return undefined
  }
}
function fingerprint(event: SessionEvent): string {
  return createHash('sha256').update(JSON.stringify(event)).digest('base64url')
}
interface Window {
  readonly events: readonly SessionEvent[]
  readonly items: Entry[]
  readonly requests: Request[]
  /** Loop position after the last retained event. */
  readonly lifecycle: Lifecycle
}
/** Keep the leading events whose projected messages and request headers fit one byte budget.
 * @param events - candidate window in position order.
 * @param maxBytes - JSON bytes of messages and headers after which the window ends.
 * @param start - loop position before the first event.
 * @returns the retained events, their public records and the loop position after them; the first public record is kept even when it
 * alone exceeds the budget.
 */
function fitWindow(events: readonly SessionEvent[], maxBytes: number, start: Lifecycle): Window {
  const items: Entry[] = []
  const requests: Request[] = []
  let state = start
  let bytes = 0
  for (const [index, event] of events.entries()) {
    const record = event.type === 'request/header' ? request(event) : project(event, state)
    if (record !== undefined) {
      const length = Buffer.byteLength(JSON.stringify(record))
      if (items.length + requests.length > 0 && bytes + length > maxBytes) {
        return { events: events.slice(0, index), items, requests, lifecycle: state }
      }
      bytes += length
      if ('role' in record) items.push(record)
      else requests.push(record)
    }
    state = advance(state, event)
  }
  return { events, items, requests, lifecycle: state }
}

/** Read a bounded Session event window without preparing a Session or activating an Agent.
 * @param tasks - Task ownership lookup; arbitrary Session identities are never accepted.
 * @param persistence - existing read-only Session storage access.
 * @param runId - execution selected by the authenticated owner.
 * @param raw - validated pagination fields.
 * @param pageSize - default maximum source events per window.
 * @param maxBytes - JSON bytes of messages and request headers after which a window ends; one larger record forms a window alone.
 * @param signal - caller lifetime, including gateway disposal.
 * @returns projected messages, the request headers logged in the window and a continuation usable for later appends, including after an
 * empty page. The continuation carries the loop position so that turn, step and tool timing stay exact across windows.
 */
export async function readTaskTranscript(
  tasks: Pick<TaskService, 'getRun'>,
  persistence: Pick<SessionPersistence, 'open'>,
  runId: string,
  raw: Record<string, string>,
  pageSize: number,
  maxBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted()
  const run = tasks.getRun(brandString<TaskRunId>(runId))
  if (run === undefined) throw new HttpProblem(404, 'not_found', 'Task execution not found')
  const query = validate(pageQuerySchema, raw)
  let offset = 0
  let anchor = ''
  let lifecycle = BETWEEN_TURNS
  if (query.cursor !== undefined) {
    let decoded: unknown
    try {
      decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))
    } catch {
      throw new HttpProblem(400, 'invalid_cursor', 'Invalid transcript cursor')
    }
    const cursor = validate(cursorSchema, decoded)
    if (cursor.session !== run.sessionId || (cursor.offset === 0 && cursor.anchor !== '')) {
      throw new HttpProblem(400, 'invalid_cursor', 'Transcript cursor does not match this execution')
    }
    offset = cursor.offset
    anchor = cursor.anchor
    lifecycle = cursor.lifecycle
  }
  try {
    await using handle = await persistence.open(run.sessionId, 'read', { signal })
    if (offset > 0) {
      const previous = await handle.read(offset - 1, 1, { signal })
      const previousEvent = previous.events[0]
      if (previousEvent === undefined || fingerprint(previousEvent) !== anchor) {
        throw new HttpProblem(409, 'cursor_stale', 'Session history changed; restart transcript loading')
      }
    }
    const size = query.limit === undefined ? pageSize : Number(query.limit)
    const read = await handle.read(offset, size + 1, { signal })
    signal.throwIfAborted()
    const window = fitWindow(read.events.slice(0, size), maxBytes, lifecycle)
    const last = window.events.at(-1)
    const nextCursor = Buffer.from(
      JSON.stringify({
        version: 1,
        session: run.sessionId,
        offset: last === undefined ? offset : last.seq + 1,
        anchor: last === undefined ? anchor : fingerprint(last),
        lifecycle: window.lifecycle,
      }),
    ).toString('base64url')
    return {
      runId: run.id,
      sessionId: run.sessionId,
      items: window.items,
      requests: window.requests,
      nextCursor,
      hasMore: read.events.length > window.events.length,
    }
  } catch (error) {
    if (error instanceof SessionPersistenceNotFoundError)
      throw new HttpProblem(409, 'session_unavailable', 'Task Session is not available yet')
    throw error
  }
}
