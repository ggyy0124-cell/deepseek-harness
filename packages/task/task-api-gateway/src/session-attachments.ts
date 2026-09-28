/** Session attachment downloads require a visible message in the selected Task-owned Session. */
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ServerResponse } from 'node:http'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { TaskRun } from '@deepseek-ai/dsh-task'
import { SessionPersistenceNotFoundError, type SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { taskTranscriptContent } from './transcript.ts'
import { HttpProblem } from './http.ts'

/** Stream verified bytes referenced by one visible transcript block.
 * @param persistence - read-only Session access.
 * @param attachments - installed immutable attachment provider.
 * @param run - execution already selected through Task ownership.
 * @param sequence - durable message event position.
 * @param index - content block position within that message.
 * @param response - authenticated response, closed by gateway teardown.
 * @returns completion after the download and read handle settle.
 * @throws HTTP 409 while Session persistence is unavailable, or 404 when no visible attachment matches.
 */
export async function downloadSessionAttachment(persistence: Pick<SessionPersistence, 'open'>,
  attachments: Pick<AttachmentStore, 'readImage' | 'readFileStream'>, run: TaskRun, sequence: number, index: number,
  response: ServerResponse): Promise<void> {
  const abort = new AbortController()
  const close = () => { if (!response.writableFinished) abort.abort() }
  response.once('close', close)
  try {
    if (response.destroyed) abort.abort()
    await using handle = await persistence.open(run.sessionId, 'read', { signal: abort.signal })
    const event = (await handle.read(sequence, 1, { signal: abort.signal })).events[0]
    const block = event === undefined ? undefined : taskTranscriptContent(event)[index]
    if (block?.type !== 'image' && block?.type !== 'file')
      throw new HttpProblem(404, 'not_found', 'Task Session attachment not found')
    const name = block.attachment.name ?? block.attachment.attachmentId
    const bytes = block.type === 'image'
      ? Readable.from([(await attachments.readImage(block.attachment, abort.signal)).data])
      : Readable.from(attachments.readFileStream(block.attachment, abort.signal))
    abort.signal.throwIfAborted()
    response.writeHead(200, {
      'Content-Type': block.type === 'image' ? block.attachment.mediaType : 'application/octet-stream',
      'Content-Length': block.attachment.bytes,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    })
    await pipeline(bytes, response, { signal: abort.signal })
  } catch (error) {
    if (error instanceof SessionPersistenceNotFoundError)
      throw new HttpProblem(409, 'session_unavailable', 'Task Session is not available yet')
    throw error
  } finally { response.off('close', close) }
}
