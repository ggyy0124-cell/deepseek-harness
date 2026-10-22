/** Attachment storage rejects corrupt inventories and ignores uncommitted receipt entries. */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TaskPrincipalId, TaskRun } from '@deepseek-ai/dsh-task'
import { TaskAttachments } from '../src/attachments.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'task-attachments-'))
  roots.push(root)
  const attachments = new TaskAttachments({
    root, fileLimitBytes: 1024, uploadLimitBytes: 2048, uploadTimeoutMs: 1000, uploadFileLimit: 2,
  })
  const run = { id: 'run', sessionId: SessionId('session') } as TaskRun
  return { root, attachments, run }
}

describe('Task attachment inventory', () => {
  it('returns an empty inventory before the first upload', async () => {
    const { attachments, run } = await fixture()
    expect(await attachments.list(run)).toEqual([])
  })

  it('lists only this Run\'s uploads oldest first with the path of their immutable blobs', async () => {
    const { root, attachments, run } = await fixture()
    const records = join(root, 'records')
    await mkdir(records)
    const item = (id: string, runId: string, createdAt: string, digest: string) => ({
      id, runId, sessionId: runId === 'run' ? 'session' : 'other', name: `${id}.png`, mime: 'image/png', size: 4, digest, createdAt,
    })
    const receipt = (items: ReturnType<typeof item>[]) => JSON.stringify({ fingerprint: 'f', items })
    await writeFile(join(records, `${'b'.repeat(64)}.json`), receipt([item('late', 'run', '2026-10-22T10:00:02.000Z', 'c'.repeat(64))]))
    await writeFile(join(records, `${'a'.repeat(64)}.json`), receipt([
      item('early', 'run', '2026-10-22T10:00:01.000Z', 'd'.repeat(64)), item('foreign', 'elsewhere', '2026-10-22T10:00:00.000Z', 'e'.repeat(64)),
    ]))
    const uploads = await attachments.uploads(run, new AbortController().signal)
    expect(uploads).toEqual([
      { id: 'early', name: 'early.png', mime: 'image/png', size: 4, digest: 'd'.repeat(64), createdAt: Date.UTC(2026, 9, 22, 10, 0, 1), path: join(root, 'blobs', 'd'.repeat(64)) },
      { id: 'late', name: 'late.png', mime: 'image/png', size: 4, digest: 'c'.repeat(64), createdAt: Date.UTC(2026, 9, 22, 10, 0, 2), path: join(root, 'blobs', 'c'.repeat(64)) },
    ])
    await expect(attachments.uploads(run, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects an upload whose request omits multipart content type', async () => {
    const { attachments, run } = await fixture()
    const request = Object.assign(Readable.from([Buffer.from('broken')]), { headers: {} }) as IncomingMessage
    await expect(attachments.upload(request, run, brandString<TaskPrincipalId>('principal'), 'request', () => {}))
      .rejects.toMatchObject({ status: 400, code: 'invalid_multipart' })
  })

  it('propagates storage errors other than a missing records directory', async () => {
    const { root, attachments, run } = await fixture()
    await writeFile(join(root, 'records'), 'not a directory')
    await expect(attachments.list(run)).rejects.toMatchObject({ code: 'ENOTDIR' })
  })

  it('rejects corrupt receipts, skips unrelated names and tolerates a concurrently removed receipt', async () => {
    const { root, attachments, run } = await fixture()
    const records = join(root, 'records')
    await mkdir(records)
    await writeFile(join(records, 'unrelated.txt'), 'ignored')
    const name = `${'a'.repeat(64)}.json`
    await symlink('missing-receipt', join(records, name))
    expect(await attachments.list(run)).toEqual([])
    await rm(join(records, name))
    await writeFile(join(records, name), 'invalid json')
    await expect(attachments.list(run)).rejects.toBeInstanceOf(SyntaxError)
  })
})
