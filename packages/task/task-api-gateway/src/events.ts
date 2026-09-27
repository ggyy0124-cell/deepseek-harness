/** Durable Task event replay with bounded batches and socket backpressure. */
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import type { ServerResponse } from 'node:http'
import type { TaskService } from '@deepseek-ai/dsh-task'
import { taskCursorSchema, taskStreamEventSchema } from '@deepseek-ai/dsh-task-api-protocol'
import type { z } from 'zod'
import { HttpProblem, validate } from './http.ts'

/** Resolved SSE resource limits. */
export interface StreamOptions {
  readonly eventPollMs: number
  readonly eventHeartbeatMs: number
  readonly eventBatchSize: number
  readonly eventBufferBytes: number
  readonly eventDrainTimeoutMs: number
}
/** Hold one authenticated SSE connection until disconnect, revocation or backpressure failure.
 * @param tasks - durable journal owner.
 * @param response - exclusively owned SSE response.
 * @param cursor - optional last delivered event id.
 * @param authorize - rereads current authorization for each replay batch.
 * @param options - explicit stream limits.
 * @returns completion after the connection closes and timers/listeners are removed.
 */
export async function streamTaskEvents(
  tasks: Pick<TaskService, 'journalHead' | 'journalPage'>,
  response: ServerResponse,
  cursor: string | undefined,
  authorize: () => Promise<void>,
  options: StreamOptions,
): Promise<void> {
  if (response.destroyed) return
  const head = tasks.journalHead()
  let after = head.sequence
  if (cursor !== undefined) {
    validate(taskCursorSchema, cursor)
    const [store, position] = cursor.split(':')
    after = Number(position)
    if (store !== head.storeId || !Number.isSafeInteger(after) || after > head.sequence) {
      throw new HttpProblem(409, 'cursor_stale', 'Task event cursor requires a new baseline')
    }
  }
  const closed = new AbortController()
  const close = () => {
    closed.abort()
  }
  response.once('close', close)
  const write = async (frame: string) => {
    closed.signal.throwIfAborted()
    if (response.writableLength + Buffer.byteLength(frame) > options.eventBufferBytes)
      throw new Error('Task event buffer exceeded')
    if (!response.write(frame)) {
      await once(response, 'drain', {
        signal: AbortSignal.any([closed.signal, AbortSignal.timeout(options.eventDrainTimeoutMs)]),
      })
    }
  }
  const publish = (event: z.input<typeof taskStreamEventSchema>) => {
    const value = taskStreamEventSchema.parse(event)
    return write(`id: ${value.cursor}\nevent: ${value.kind}\ndata: ${JSON.stringify(value)}\n\n`)
  }
  try {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    })
    response.flushHeaders()
    await publish({ kind: 'ready', cursor: `${head.storeId}:${after}` })
    let lastHeartbeat = Date.now()
    while (!closed.signal.aborted) {
      await authorize()
      closed.signal.throwIfAborted()
      const current = tasks.journalHead()
      if (current.storeId !== head.storeId || current.sequence < after)
        throw new Error('Task event store changed')
      const entries = tasks.journalPage(after, options.eventBatchSize)
      for (const entry of entries) {
        await publish({
          kind: 'task',
          cursor: `${head.storeId}:${entry.sequence}`,
          event: entry.event,
          runId: entry.runId,
          at: new Date(entry.at).toISOString(),
        })
        after = entry.sequence
      }
      if (Date.now() - lastHeartbeat >= options.eventHeartbeatMs) {
        await write(': heartbeat\n\n')
        lastHeartbeat = Date.now()
      }
      if (entries.length < options.eventBatchSize)
        await delay(options.eventPollMs, undefined, { signal: closed.signal })
    }
  } catch (error) {
    if (!closed.signal.aborted) throw error
  } finally {
    close()
    response.off('close', close)
    response.destroy()
  }
}
