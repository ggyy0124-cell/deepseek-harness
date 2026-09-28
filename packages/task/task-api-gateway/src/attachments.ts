/** Authenticated, immutable Run attachments with atomic upload receipts and scoped Range downloads. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, link, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TaskRun, TaskPrincipalId } from '@deepseek-ai/dsh-task'
import { attachmentSchema } from '@deepseek-ai/dsh-task-api-protocol'
import { z } from 'zod'
import { HttpProblem, readBody, validate } from './http.ts'
const receiptSchema = z.strictObject({ fingerprint: z.string(), items: z.array(attachmentSchema) })
type Attachment = z.output<typeof attachmentSchema>
/** Deployment limits for complete upload requests and individual files. */
export interface AttachmentOptions {
  readonly root: string
  readonly fileLimitBytes: number
  readonly uploadLimitBytes: number
  readonly uploadTimeoutMs: number
  readonly uploadFileLimit: number
}
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
/** Owns immutable blobs and upload receipts; staging files never appear in attachment listings. */
export class TaskAttachments {
  constructor(private readonly options: AttachmentOptions) {}
  /** Store a bounded multipart upload with a durable principal-scoped retry key.
   * @param request - authenticated upload request.
   * @param run - selected execution identity.
   * @param principal - authenticated owner.
   * @param requestId - stable upload retry identity.
   * @param writable - rechecks execution and gateway lifetime immediately before receipt publication.
   * @returns the original uploaded file identities on a matching retry.
   */
  async upload(
    request: IncomingMessage,
    run: TaskRun,
    principal: TaskPrincipalId,
    requestId: string,
    writable: () => void,
  ): Promise<Attachment[]> {
    const body = await readBody(request, this.options.uploadLimitBytes, this.options.uploadTimeoutMs)
    let form: FormData
    try {
      form = await new Response(new Uint8Array(body), {
        headers: { 'Content-Type': request.headers['content-type'] ?? '' },
      }).formData()
    } catch {
      throw new HttpProblem(400, 'invalid_multipart', 'Invalid multipart upload')
    }
    const files: File[] = []
    for (const [name, value] of form) {
      if (name !== 'files' || typeof value === 'string')
        throw new HttpProblem(400, 'invalid_upload', 'Upload fields must be files')
      if (value.size > this.options.fileLimitBytes)
        throw new HttpProblem(413, 'file_too_large', 'File exceeds the configured limit')
      files.push(value)
    }
    if (files.length === 0 || files.length > this.options.uploadFileLimit)
      throw new HttpProblem(400, 'invalid_upload_count', 'Upload file count exceeds the configured limit')
    const payloads = await Promise.all(
      files.map(async (file) => {
        const bytes = Buffer.from(await file.arrayBuffer())
        return {
          bytes,
          name: file.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200),
          mime: file.type,
          digest: hash(bytes),
        }
      }),
    )
    const fingerprint = hash(
      JSON.stringify({
        runId: run.id,
        files: payloads.map(({ bytes, ...file }) => ({ ...file, size: bytes.length })),
      }),
    )
    const recordPath = join(this.options.root, 'records', hash(`${principal}:${requestId}`) + '.json')
    const previous = await this.receipt(recordPath)
    if (previous !== undefined) return this.replay(previous, fingerprint)
    writable()
    await mkdir(join(this.options.root, 'blobs'), { recursive: true, mode: 0o700 })
    await mkdir(join(this.options.root, 'records'), { recursive: true, mode: 0o700 })
    const items: Attachment[] = []
    for (const file of payloads) {
      await this.publish(join(this.options.root, 'blobs', file.digest), file.bytes)
      items.push(
        attachmentSchema.parse({
          id: randomUUID(),
          runId: run.id,
          sessionId: run.sessionId,
          name: file.name,
          mime: file.mime,
          digest: file.digest,
          size: file.bytes.length,
          createdAt: new Date().toISOString(),
        }),
      )
    }
    writable()
    await this.publish(recordPath, Buffer.from(JSON.stringify({ fingerprint, items })))
    const committed = await this.receipt(recordPath)
    /* v8 ignore next -- Only an external deletion between atomic publication and this read can remove the receipt. */
    if (committed === undefined) throw new Error('Attachment receipt disappeared after publication')
    return this.replay(committed, fingerprint)
  }
  /** List only attachments whose receipt belongs to this Run.
   * @param run - execution identity.
   * @returns public immutable metadata.
   */
  async list(run: TaskRun): Promise<Attachment[]> {
    let names: string[]
    try {
      names = await readdir(join(this.options.root, 'records'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const items: Attachment[] = []
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
      const receipt = await this.receipt(join(this.options.root, 'records', name))
      items.push(
        ...(receipt?.items.filter(
          item => String(item.runId) === run.id && String(item.sessionId) === run.sessionId,
        ) ?? []),
      )
    }
    return items
  }
  /** Download a Run-owned blob; only a single validated byte range is accepted.
   * @param run - execution selected by the authenticated caller.
   * @param id - scoped opaque attachment identity.
   * @param request - download headers and cancellation lifetime.
   * @param response - exclusively owned binary response.
   */
  async download(
    run: TaskRun,
    id: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const item = (await this.list(run)).find(value => value.id === id)
    if (item === undefined) throw new HttpProblem(404, 'not_found', 'Task attachment not found')
    let start = 0
    let end = item.size - 1
    const range = request.headers.range
    if (range !== undefined) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (match === null || (match[1] === '' && match[2] === ''))
        throw new HttpProblem(416, 'invalid_range', 'Unsupported byte range')
      if (match[1] === '') start = Math.max(0, item.size - Number(match[2]))
      else {
        start = Number(match[1])
        if (match[2] !== '') end = Math.min(end, Number(match[2]))
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start > end ||
        start >= item.size
      )
        throw new HttpProblem(416, 'invalid_range', 'Byte range is outside this file')
    }
    response.writeHead(range === undefined ? 200 : 206, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': item.size === 0 ? 0 : end - start + 1,
      ...(range === undefined ? {} : { 'Content-Range': `bytes ${start}-${end}/${item.size}` }),
    })
    if (item.size === 0) {
      response.end()
      return
    }
    await pipeline(createReadStream(join(this.options.root, 'blobs', item.digest), { start, end }), response)
  }
  private async receipt(path: string): Promise<z.output<typeof receiptSchema> | undefined> {
    try {
      return validate(receiptSchema, JSON.parse(await readFile(path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  private replay(receipt: z.output<typeof receiptSchema>, fingerprint: string): Attachment[] {
    if (receipt.fingerprint !== fingerprint)
      throw new HttpProblem(409, 'idempotency_conflict', 'Upload retry content differs')
    return receipt.items
  }
  private async publish(path: string, bytes: Buffer): Promise<void> {
    const temporary = `${path}.${randomUUID()}.partial`
    try {
      await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' })
      try {
        await link(temporary, path)
      } catch (error) {
        /* v8 ignore next -- Portable tests exercise the expected EEXIST race; all other host filesystem faults propagate unchanged. */
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    } finally {
      await rm(temporary, { force: true })
    }
  }
}
