/** Bounded read-only windows of a Run's stored Session events, unprojected, for diagnosis in Task Web. */
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError, type SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { TaskService } from '@deepseek-ai/dsh-task'
import type { sessionLogEntrySchema } from '@deepseek-ai/dsh-task-api-protocol'
import { HttpProblem } from './http.ts'
import { fingerprint, resolveSessionWindow } from './transcript.ts'

const cursorSchema = z.strictObject({
  version: z.literal(1),
  session: z.string(),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  anchor: z.string(),
})
const eventSchema = z.record(z.string(), z.json())
type Entry = z.infer<typeof sessionLogEntrySchema>

function entry(event: SessionEvent): Entry {
  return { sequence: event.seq, at: new Date(event.time).toISOString(), type: event.type, event: eventSchema.parse(event) }
}

/** Read a bounded window of stored Session events without preparing a Session or activating an Agent.
 * @param tasks - Task ownership lookup; arbitrary Session identities are never accepted.
 * @param persistence - existing read-only Session storage access.
 * @param runId - execution selected by the authenticated owner.
 * @param raw - validated pagination fields.
 * @param limits - `pageSize`, the default maximum events per window, and `maxBytes`, the event JSON bytes after which a window ends;
 * one larger event forms a window alone.
 * @param signal - caller lifetime, including gateway disposal.
 * @returns the events in position order and a continuation usable for later appends, including after an empty page.
 */
export async function readSessionLog(
  tasks: Pick<TaskService, 'getRun'>,
  persistence: Pick<SessionPersistence, 'open'>,
  runId: string,
  raw: Record<string, string>,
  limits: { readonly pageSize: number; readonly maxBytes: number },
  signal: AbortSignal,
): Promise<unknown> {
  const { run, limit, cursor } = resolveSessionWindow(tasks, runId, raw, cursorSchema, 'Session log', signal)
  const offset = cursor?.offset ?? 0
  const anchor = cursor?.anchor ?? ''
  try {
    await using handle = await persistence.open(run.sessionId, 'read', { signal })
    if (offset > 0) {
      const previous = (await handle.read(offset - 1, 1, { signal })).events[0]
      if (previous === undefined || fingerprint(previous) !== anchor)
        throw new HttpProblem(409, 'cursor_stale', 'Session history changed; restart Session log loading')
    }
    const size = limit ?? limits.pageSize
    const read = await handle.read(offset, size + 1, { signal })
    signal.throwIfAborted()
    const items: Entry[] = []
    let bytes = 0
    let last: SessionEvent | undefined
    for (const event of read.events.slice(0, size)) {
      const item = entry(event)
      const length = Buffer.byteLength(JSON.stringify(item))
      if (items.length > 0 && bytes + length > limits.maxBytes) break
      bytes += length
      items.push(item)
      last = event
    }
    const nextCursor = Buffer.from(JSON.stringify({
      version: 1,
      session: run.sessionId,
      offset: last === undefined ? offset : last.seq + 1,
      anchor: last === undefined ? anchor : fingerprint(last),
    })).toString('base64url')
    return { runId: run.id, sessionId: run.sessionId, items, nextCursor, hasMore: read.events.length > items.length }
  } catch (error) {
    if (error instanceof SessionPersistenceNotFoundError)
      throw new HttpProblem(409, 'session_unavailable', 'Task Session is not available yet')
    throw error
  }
}
