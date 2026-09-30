/** Bounded HTTP ingress and value-free error diagnostics. */
import type { IncomingMessage } from 'node:http'
import { z } from 'zod'

/** Gateway-owned HTTP rejection with a stable safe description. */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
/** Validate untrusted fields without exposing submitted values in Zod diagnostics.
 * @param schema - protocol-owned validator.
 * @param value - incoming data.
 * @returns validated data.
 */
export function validate<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value)
  if (!result.success)
    throw new HttpProblem(400, 'invalid_request', 'Request fields do not match the Task API schema')
  return result.data
}
/** Read one bounded JSON document with a deadline that also covers incomplete bodies.
 * @param request - HTTP request stream.
 * @param limit - maximum complete body bytes.
 * @param timeoutMs - body deadline.
 * @returns parsed JSON, or undefined for an empty body.
 */
export async function readJson(request: IncomingMessage, limit: number, timeoutMs: number): Promise<unknown> {
  if (request.headers['content-encoding'] !== undefined)
    throw new HttpProblem(415, 'unsupported_encoding', 'Encoded request bodies are unsupported')
  const bytes = await readBody(request, limit, timeoutMs)
  if (bytes.length === 0) return undefined
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new HttpProblem(415, 'unsupported_media_type', 'Request body must use application/json')
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new HttpProblem(400, 'invalid_json', 'Request body is not valid UTF-8 JSON')
  }
}
/** Read a bounded unencoded request body.
 * @param request - request stream.
 * @param limit - complete byte limit.
 * @param timeoutMs - incomplete-body deadline.
 * @returns collected bytes; a rejection leaves the response available for a safe HTTP error.
 */
export function readBody(request: IncomingMessage, limit: number, timeoutMs: number): Promise<Buffer> {
  if (request.headers['content-encoding'] !== undefined)
    throw new HttpProblem(415, 'unsupported_encoding', 'Encoded request bodies are unsupported')
  return new Promise<Buffer>((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    const cleanup = () => {
      clearTimeout(timer)
      request.off('data', data)
      request.off('end', end)
      request.off('error', error)
      request.off('aborted', aborted)
    }
    const fail = (problem: Error) => {
      cleanup()
      request.pause()
      reject(problem)
    }
    const data = (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        fail(new HttpProblem(413, 'body_too_large', 'Request body exceeds the configured limit'))
        return
      }
      chunks.push(chunk)
    }
    const end = () => {
      cleanup()
      resolve(Buffer.concat(chunks, size))
    }
    const error = () => {
      fail(new HttpProblem(400, 'incomplete_body', 'Request body did not complete'))
    }
    const aborted = error
    const timer = setTimeout(() => {
      fail(new HttpProblem(408, 'body_timeout', 'Request body deadline exceeded'))
    }, timeoutMs)
    request.on('data', data)
    request.once('end', end)
    request.once('error', error)
    request.once('aborted', aborted)
  })
}
/** Read one Task cookie and reject ambiguous duplicate credentials.
 * @param header - raw Cookie header.
 * @returns Task cookie value when present.
 */
export function taskCookie(header: string | undefined): string | undefined {
  const matches = (header ?? '')
    .split(';')
    .map(value => value.trim())
    .filter(value => value.startsWith('dsh_task_session='))
  if (matches.length > 1) throw new HttpProblem(400, 'ambiguous_credentials', 'Duplicate Task cookie')
  return matches[0]?.slice('dsh_task_session='.length)
}
