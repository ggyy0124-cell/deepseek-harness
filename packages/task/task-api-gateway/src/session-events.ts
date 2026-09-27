/** Resumable Session feed over bounded existing transcript reads. */
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import type { ServerResponse } from 'node:http'
import type { TaskService } from '@deepseek-ai/dsh-task'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { transcriptPageSchema } from '@deepseek-ai/dsh-task-api-protocol'
import { readTaskTranscript } from './transcript.ts'
import type { StreamOptions } from './events.ts'

/** Stream stored messages without taking Session ownership or retaining a second transcript.
 * @param tasks - Run identity owner.
 * @param persistence - existing Session storage.
 * @param runId - selected execution.
 * @param response - exclusively owned SSE response.
 * @param cursor - last delivered transcript cursor.
 * @param authorize - credential check before every page.
 * @param options - bounded transport settings.
 */
export async function streamSessionEvents(
  tasks: TaskService,
  persistence: SessionPersistence,
  runId: string,
  response: ServerResponse,
  cursor: string | undefined,
  authorize: () => Promise<void>,
  options: StreamOptions,
): Promise<void> {
  if (response.destroyed) return
  const lifetime = new AbortController()
  const close = () => {
    lifetime.abort()
  }
  response.once('close', close)
  const read = (position: string | undefined) =>
    readTaskTranscript(
      tasks,
      persistence,
      runId,
      position === undefined ? {} : { cursor: position },
      Math.min(options.eventBatchSize, 200),
      lifetime.signal,
    ).then(value => transcriptPageSchema.parse(value))
  const write = async (event: string, id: string, data: unknown) => {
    lifetime.signal.throwIfAborted()
    const frame = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    if (Buffer.byteLength(frame) + response.writableLength > options.eventBufferBytes)
      throw new Error('Session event buffer exceeded')
    if (!response.write(frame))
      await once(response, 'drain', {
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(options.eventDrainTimeoutMs)]),
      })
  }
  try {
    let page = await read(cursor)
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    })
    response.flushHeaders()
    // A fresh feed replays from the beginning; clients deduplicate REST baseline messages by sequence.
    const opening =
      cursor ??
      Buffer.from(JSON.stringify({ version: 1, session: page.sessionId, offset: 0, anchor: '' })).toString(
        'base64url',
      )
    await write('session_ready', opening, { kind: 'session_ready', cursor: opening })
    let lastSent = Date.now()
    while (!lifetime.signal.aborted) {
      await authorize()
      const changed = page.nextCursor !== cursor
      if (changed || Date.now() - lastSent >= options.eventHeartbeatMs) {
        await write('session', page.nextCursor, { kind: 'session', cursor: page.nextCursor, page })
        lastSent = Date.now()
      }
      cursor = page.nextCursor
      if (!page.hasMore) await delay(options.eventPollMs, undefined, { signal: lifetime.signal })
      page = await read(cursor)
    }
  } catch (error) {
    if (!lifetime.signal.aborted) throw error
  } finally {
    close()
    response.off('close', close)
    if (response.headersSent) response.destroy()
  }
}
