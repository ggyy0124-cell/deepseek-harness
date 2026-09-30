/** Bounded Task SSE decoding for Fetch clients. */
import {
  sessionStreamEventSchema,
  type SessionStreamEvent,
  taskStreamEventSchema,
  type TaskStreamEvent,
} from '@deepseek-ai/dsh-task-api-protocol'

/** Decode complete Task event frames; unknown event names remain forward compatible.
 * @param response - successful text/event-stream response.
 * @param frameLimitBytes - maximum bytes retained for one event.
 * @returns ready and Task events; closing the iterator releases the reader.
 */
export async function* readTaskEvents(
  response: Response,
  frameLimitBytes: number,
): AsyncGenerator<TaskStreamEvent> {
  yield* readEvents(response, frameLimitBytes, ['ready', 'task'], value =>
    taskStreamEventSchema.parse(value),
  )
}

/** Decode Session SSE frames using their independent cursor vocabulary.
 * @param response - successful SSE response.
 * @param frameLimitBytes - complete UTF-8 frame limit.
 * @returns validated Session notifications.
 */
export async function* readSessionEvents(
  response: Response,
  frameLimitBytes: number,
): AsyncGenerator<SessionStreamEvent> {
  yield* readEvents(response, frameLimitBytes, ['session_ready', 'session'], value =>
    sessionStreamEventSchema.parse(value),
  )
}

async function* readEvents<T extends { kind: string; cursor: string }>(
  response: Response,
  frameLimitBytes: number,
  kinds: readonly string[],
  parse: (value: unknown) => T,
): AsyncGenerator<T> {
  if (response.body === null) throw new Error('Task event response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  let pending = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let separator: RegExpExecArray | null
      while ((separator = /\r?\n\r?\n/.exec(pending)) !== null) {
        const frame = pending.slice(0, separator.index)
        if (encoder.encode(frame).byteLength + separator[0].length > frameLimitBytes)
          throw new Error('Task event frame exceeds the configured limit')
        pending = pending.slice(separator.index + separator[0].length)
        const fields = frame
          .replace(/\r\n/g, '\n')
          .split('\n')
          .map((line) => {
            const index = line.indexOf(':')
            const value = index < 0 ? '' : line.slice(index + 1).replace(/^ /, '')
            return { name: index < 0 ? line : line.slice(0, index), value }
          })
        const kind = fields.filter(field => field.name === 'event').at(-1)?.value
        if (kind === undefined || !kinds.includes(kind)) continue
        const id = fields.filter(field => field.name === 'id').at(-1)?.value
        const data = fields
          .filter(field => field.name === 'data')
          .map(field => field.value)
          .join('\n')
        let parsed: unknown
        try {
          parsed = JSON.parse(data)
        } catch {
          throw new Error('Task event contains invalid JSON')
        }
        const event = parse(parsed)
        if (event.kind !== kind || event.cursor !== id)
          throw new Error('Task event identity differs from its frame')
        yield event
      }
      if (encoder.encode(pending).byteLength > frameLimitBytes)
        throw new Error('Task event frame exceeds the configured limit')
      if (done) {
        if (pending !== '') throw new Error('Task event stream ended with an incomplete frame')
        return
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* An aborted or failed network stream may already have rejected its reader. */
    }
    reader.releaseLock()
  }
}
