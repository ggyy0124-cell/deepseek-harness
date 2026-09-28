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

  it('rejects an upload whose request omits multipart content type', async () => {
    const { attachments, run } = await fixture()
    const request = Object.assign(Readable.from([Buffer.from('broken')]), { headers: {} }) as unknown as IncomingMessage
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
