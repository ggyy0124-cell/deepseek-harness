/** Bounded read-only Task transcript windows over the existing Session persistence provider. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
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
} from '@deepseek-ai/dsh-task-api-protocol'
import { HttpProblem, validate } from './http.ts'

const cursorSchema = z.strictObject({
  version: z.literal(1),
  session: z.string(),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  anchor: z.string(),
})
type Block = z.infer<typeof transcriptBlockSchema>
type Entry = z.infer<typeof transcriptEntrySchema>

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
function project(event: SessionEvent): Entry | undefined {
  const common = { sequence: event.seq, at: new Date(event.time).toISOString(), callId: null, isError: false }
  switch (event.type) {
    case 'user/message':
      return isAppendSurfaceEvent(event)
        ? { ...common, role: 'user', blocks: blocks(event.data.content) }
        : undefined
    case 'assistant/message':
      return isAppendSurfaceEvent(event)
        ? { ...common, role: 'assistant', blocks: blocks(event.data.message.content) }
        : undefined
    case 'tool/result': {
      if (!isAppendSurfaceEvent(event)) return undefined
      const result = event.data.message
      return {
        ...common,
        role: 'tool',
        callId: result.toolCallId,
        isError: result.isError === true,
        blocks: blocks(result.content),
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

/** Read a bounded Session event window without preparing a Session or activating an Agent.
 * @param tasks - Task ownership lookup; arbitrary Session identities are never accepted.
 * @param persistence - existing read-only Session storage access.
 * @param runId - execution selected by the authenticated owner.
 * @param raw - validated pagination fields.
 * @param pageSize - default maximum source events per window.
 * @param signal - caller lifetime, including gateway disposal.
 * @returns projected messages and a continuation usable for later appends, including after an empty page.
 */
export async function readTaskTranscript(
  tasks: Pick<TaskService, 'getRun'>,
  persistence: Pick<SessionPersistence, 'open'>,
  runId: string,
  raw: Record<string, string>,
  pageSize: number,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted()
  const run = tasks.getRun(brandString<TaskRunId>(runId))
  if (run === undefined) throw new HttpProblem(404, 'not_found', 'Task execution not found')
  const query = validate(pageQuerySchema, raw)
  let offset = 0
  let anchor = ''
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
    const events = read.events.slice(0, size)
    const last = events.at(-1)
    const nextCursor = Buffer.from(
      JSON.stringify({
        version: 1,
        session: run.sessionId,
        offset: last === undefined ? offset : last.seq + 1,
        anchor: last === undefined ? anchor : fingerprint(last),
      }),
    ).toString('base64url')
    return {
      runId: run.id,
      sessionId: run.sessionId,
      items: events.flatMap((event) => {
        const entry = project(event)
        return entry === undefined ? [] : [entry]
      }),
      nextCursor,
      hasMore: read.events.length > size,
    }
  } catch (error) {
    if (error instanceof SessionPersistenceNotFoundError)
      throw new HttpProblem(409, 'session_unavailable', 'Task Session is not available yet')
    throw error
  }
}
