/** Resource recovery retains ownership and preserves code before destructive cleanup. */
import { cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, rename, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TaskRunId, TaskResourceHandler, TaskResourceRecord } from '@deepseek-ai/dsh-task'
import { TaskDatabase } from '../src/database.ts'
import { TaskResources } from '../src/resources.ts'
import { OwnedTaskFiles } from '../src/owned-files.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const runId = brandString<TaskRunId>('resource-test')
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'task-resources-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(SubprocessLocal)
  cleanups.push(async () => { await ctx.fiber.dispose() })
  const db = new TaskDatabase(join(root, 'tasks.sqlite'))
  cleanups.push(async () => { db.close() })
  const files = new OwnedTaskFiles(join(root, 'resources'), ctx.subprocess, 100, 65536)
  const resources = new TaskResources(db, files.handlers(), () => {})
  const signal = new AbortController().signal
  return { root, ctx, db, files, resources, signal }
}

describe('Task owned resources', () => {
  it.each(['missing-marker', 'wrong-marker', 'redirected-base', 'non-directory-base'] as const)('refuses cleanup of %s without touching shared data', async (change) => {
    const { root, resources, signal } = await fixture()
    const value = await resources.acquire(runId, 'directory', 'task.directory', {}, signal) as { path: string }
    const base = join(value.path, '..')
    const shared = join(root, 'shared'); await mkdir(shared); await writeFile(join(shared, 'retain'), 'shared')
    if (change === 'missing-marker') await rm(join(base, 'owner.json'))
    else if (change === 'wrong-marker') await writeFile(join(base, 'owner.json'), 'another owner')
    else {
      await rm(base, { recursive: true })
      if (change === 'redirected-base') await symlink(shared, base, 'junction')
      else await writeFile(base, 'external file')
    }
    await expect(resources.cleanup(runId, signal)).rejects.toThrow()
    expect(await readFile(join(shared, 'retain'), 'utf8')).toBe('shared')
    if (change === 'non-directory-base') expect(await readFile(base, 'utf8')).toBe('external file')
  })

  it('repairs an empty directory left before ownership publication and tolerates absent cleanup', async () => {
    const { root, files, signal } = await fixture()
    const record: TaskResourceRecord = { runId, key: 'interrupted', type: 'task.directory', request: {}, value: null, state: 'prepared' }
    const adapter = files.handlers()['task.directory']!
    await adapter.cleanup(record, signal)
    const identity = JSON.stringify({ runId, key: record.key, type: record.type })
    const base = join(root, 'resources', createHash('sha256').update(identity).digest('hex'))
    await mkdir(base)
    expect(await adapter.acquire(record, signal)).toEqual({ path: join(await realpath(base), 'data') })
    expect(await readFile(join(base, 'owner.json'), 'utf8')).toBe(identity)
    await adapter.cleanup(record, signal)
  })

  it.each(['initial-root', 'replaced-root', 'replaced-ancestor'] as const)('rejects a redirected %s', async (change) => {
    const { root, ctx, signal } = await fixture()
    const original = join(root, 'original'); const external = join(root, 'external')
    await mkdir(original); await mkdir(external)
    const path = join(root, 'alias')
    const record: TaskResourceRecord = { runId, key: 'redirect', type: 'task.directory', request: {}, value: null, state: 'prepared' }
    if (change === 'initial-root' || change === 'replaced-ancestor') await symlink(original, path, 'junction')
    const files = new OwnedTaskFiles(change === 'replaced-ancestor' ? join(path, 'resources') : path, ctx.subprocess, 100, 65536)
    const adapter = files.handlers()['task.directory']!
    if (change === 'initial-root') {
      await expect(adapter.acquire(record, signal)).rejects.toThrow('must not be a symlink')
      return
    }
    await adapter.acquire(record, signal)
    if (change === 'replaced-root') await rename(path, join(root, 'retained'))
    else { await rm(path); await mkdir(join(external, 'resources')) }
    await symlink(external, path, 'junction')
    await expect(adapter.cleanup(record, signal)).rejects.toThrow('root changed')
  })

  it('rejects a failed Git operation and option-like references', async () => {
    const { root, ctx, signal } = await fixture()
    const record: TaskResourceRecord = { runId, key: 'invalid', type: 'task.worktree',
      request: { repository: root, ref: 'HEAD' }, value: null, state: 'prepared' }
    const files = new OwnedTaskFiles(join(root, 'failed'), ctx.subprocess, 100, 65536)
    await expect(files.handlers()['task.worktree']!.acquire(record, signal)).rejects.toThrow('worktree operation failed')
    await expect(files.handlers()['task.worktree']!.acquire({ ...record, request: { repository: root, ref: '--help' } }, signal)).rejects.toThrow()
  })

  it('reuses a confirmed acquisition and refuses identities whose retirement has started', async () => {
    const { db, signal } = await fixture()
    const acquire = vi.fn(async () => ({ id: 'one' }))
    const cleanup = vi.fn(async () => {})
    const resources = new TaskResources(db, { browser: { acquire, reconcile: acquire, cleanup } }, () => {})
    await expect(resources.acquire(runId, ' ', 'browser', {}, signal)).rejects.toThrow('must not be empty')
    await expect(resources.acquire(runId, 'one', ' ', {}, signal)).rejects.toThrow('must not be empty')
    const handle = await resources.acquire(runId, 'one', 'browser', {}, signal)
    expect(await resources.acquire(runId, 'one', 'browser', {}, signal)).toEqual(handle)
    expect(acquire).toHaveBeenCalledOnce()
    db.putResource({ ...db.managedResources(runId)[0]!, state: 'cleaning' })
    await expect(resources.acquire(runId, 'one', 'browser', {}, signal)).rejects.toThrow('retired')
    await resources.cleanup(runId, signal)
    await expect(resources.acquire(runId, 'one', 'browser', {}, signal)).rejects.toThrow('retired')
    await resources.cleanup(runId, signal)
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('reconciles an uncertain acquisition and retains progress when a cleanup adapter is missing', async () => {
    const { db, signal } = await fixture()
    const acquire = vi.fn(async () => { throw new Error('lost reply') })
    const reconcile = vi.fn(async () => ({ id: 'existing' }))
    const handler: TaskResourceHandler = { acquire, reconcile, cleanup: vi.fn(async () => {}) }
    const first = new TaskResources(db, { browser: handler }, () => {})
    await expect(first.acquire(runId, 'one', 'browser', {}, signal)).rejects.toThrow('lost reply')
    expect(await new TaskResources(db, { browser: handler }, () => {}).acquire(runId, 'one', 'browser', {}, signal)).toEqual({ id: 'existing' })
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenCalledTimes(1)
    await expect(first.acquire(runId, 'one', 'browser', { changed: true }, signal)).rejects.toThrow('different acquisition')
    await expect(new TaskResources(db, {}, () => {}).cleanup(runId, signal)).rejects.toThrow('unavailable')
    expect(db.managedResources(runId)[0]?.state).toBe('blocked')
    await first.cleanup(runId, signal)
    expect(db.managedResources(runId)[0]?.state).toBe('released')
  })

  it('refuses symlink replacement and leaves shared data untouched', async () => {
    const { root, resources, signal } = await fixture()
    const value = await resources.acquire(runId, 'directory', 'task.directory', {}, signal) as { path: string }
    const shared = join(root, 'shared')
    await mkdir(shared); await writeFile(join(shared, 'login'), 'keep')
    await rm(value.path, { recursive: true }); await symlink(shared, value.path, 'dir')
    await expect(resources.cleanup(runId, signal)).rejects.toThrow('redirect')
    expect(await readFile(join(shared, 'login'), 'utf8')).toBe('keep')
    await rm(value.path); await mkdir(value.path)
    await resources.cleanup(runId, signal)
    await expect(readFile(join(shared, 'login'), 'utf8')).resolves.toBe('keep')
  })

  it('preserves tracked edits, untracked files and symbolic link values before removing a worktree', async () => {
    const { root, ctx, db, resources, signal } = await fixture()
    const repository = join(root, 'repository'); await mkdir(repository)
    const git = async (...args: string[]) => {
      const process = ctx.subprocess.spawn({ argv: ['git', ...args], cwd: repository, graceMs: 100,
        env: { GIT_AUTHOR_NAME: 'Task test', GIT_AUTHOR_EMAIL: 'task@example.test', GIT_COMMITTER_NAME: 'Task test', GIT_COMMITTER_EMAIL: 'task@example.test' },
        stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } } })
      try { expect((await process.done).exitCode).toBe(0) } finally { process.terminate(); await process.waitForExit() }
    }
    await git('init'); await writeFile(join(repository, 'source.txt'), 'original'); await git('add', '.'); await git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture')
    const value = await resources.acquire(runId, 'code', 'task.worktree', { repository, ref: 'HEAD' }, signal) as { path: string }
    const other = join(root, 'other-repository')
    await git('init', other)
    const registration = await readFile(join(value.path, '.git'), 'utf8')
    await writeFile(join(value.path, '.git'), `gitdir: ${join(other, '.git')}\n`)
    await expect(resources.cleanup(runId, signal)).rejects.toThrow('different repository')
    await writeFile(join(value.path, '.git'), registration)
    const limited = new OwnedTaskFiles(join(root, 'resources'), ctx.subprocess, 100, 1)
    await expect(limited.handlers()['task.worktree']!.reconcile(db.managedResources(runId)[0]!, signal)).rejects.toThrow('exceeds its configured limit')
    await writeFile(join(value.path, 'source.txt'), 'uncommitted')
    await writeFile(join(value.path, 'new.txt'), 'untracked')
    await mkdir(join(value.path, 'nested'))
    await writeFile(join(value.path, 'nested', 'retained.txt'), 'nested content')
    await symlink('source.txt', join(value.path, 'link'))
    const restoredRoot = join(root, 'restored-resources')
    await cp(join(root, 'resources'), restoredRoot, { recursive: true, verbatimSymlinks: true })
    const restoredFiles = new OwnedTaskFiles(restoredRoot, ctx.subprocess, 100, 65536)
    db.putResource({ ...db.managedResources(runId)[0]!, state: 'prepared' })
    await expect(new TaskResources(db, restoredFiles.handlers(), () => {}).acquire(runId, 'code', 'task.worktree',
      { repository, ref: 'HEAD' }, signal)).rejects.toThrow('moved')
    if (process.platform !== 'win32') {
      const fifo = join(value.path, 'fifo')
      const process = ctx.subprocess.spawn({ argv: ['mkfifo', fifo], cwd: repository, graceMs: 100,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } } })
      try { expect((await process.done).exitCode).toBe(0) }
      finally { process.terminate(); await process.waitForExit() }
      await expect(resources.cleanup(runId, signal)).rejects.toThrow('unsupported filesystem entry')
      expect(await readFile(join(value.path, 'source.txt'), 'utf8')).toBe('uncommitted')
      await rm(fifo)
    }
    await resources.cleanup(runId, signal)
    const base = join(value.path, '..')
    const saved = (await readdir(base)).find(name => name.startsWith('preserved-') && !name.endsWith('.json'))!
    expect(await readFile(join(base, saved, 'source.txt'), 'utf8')).toBe('uncommitted')
    expect(await readFile(join(base, saved, 'new.txt'), 'utf8')).toBe('untracked')
    expect(await readFile(join(base, saved, 'nested', 'retained.txt'), 'utf8')).toBe('nested content')
    expect(await readFile(join(base, `${saved}.links.json`), 'utf8')).toContain('source.txt')
    expect(await readFile(join(repository, 'source.txt'), 'utf8')).toBe('original')
    await expect(readdir(value.path)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30000)

  it('awaits the real owned process range before confirming resource release', async () => {
    const { ctx, db, signal } = await fixture()
    let process: ReturnType<typeof ctx.subprocess.spawn> | undefined
    const handler: TaskResourceHandler = {
      acquire: async () => {
        process = ctx.subprocess.spawn({ argv: [globalThis.process.execPath, '-e', 'setInterval(() => {}, 1000)'], cwd: tmpdir(), graceMs: 100,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } } })
        return { owned: true }
      },
      reconcile: async () => { throw new Error('external identity must be reconciled') },
      cleanup: async () => { process!.terminate(); await process!.done; expect(await process!.waitForExit()).toBe(true) },
    }
    const resources = new TaskResources(db, { process: handler }, () => {})
    try {
      await resources.acquire(runId, 'child', 'process', {}, signal)
      await resources.cleanup(runId, signal)
      expect(db.managedResources(runId)[0]?.state).toBe('released')
    } finally { process?.terminate(); await process?.waitForExit() }
  })
})
