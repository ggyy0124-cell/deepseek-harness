/** Built-in resource adapters restrict deletion to marked Task-owned directories and preserve worktrees. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, lstat, realpath, readdir, readFile, readlink, open, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { TaskResourceHandler, TaskResourceRecord } from '@deepseek-ai/dsh-task'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

const worktreeRequest = z.strictObject({ repository: z.string().min(1), ref: z.string().min(1).refine(value => !value.startsWith('-') && !value.includes('\0')) })
const directoryRequest = z.strictObject({})
interface OwnedLocation { base: string; data: string; owner: string; identity: string }
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
async function durableWrite(path: string, value: string | Uint8Array): Promise<void> {
  const file = await open(path, 'wx', 0o600)
  try { await file.writeFile(value); await file.sync() } finally { await file.close() }
}

/** Own only private directories; repository metadata and shared login state remain external. */
export class OwnedTaskFiles {
  private root: Promise<string> | undefined
  constructor(private readonly path: string, private readonly subprocess: SubprocessRuntime,
    private readonly graceMs: number, private readonly outputLimitBytes: number) {}

  /** Built-in resource names cannot be overridden by business plugins.
   * @returns directory and Git worktree adapters with durable cleanup.
   */
  handlers(): Readonly<Record<string, TaskResourceHandler>> {
    const adapter = (worktree: boolean): TaskResourceHandler => ({
      acquire: (record, signal) => this.acquire(record, worktree, signal),
      reconcile: (record, signal) => this.acquire(record, worktree, signal),
      cleanup: (record, signal) => this.cleanup(record, worktree, signal),
    })
    return { 'task.directory': adapter(false), 'task.worktree': adapter(true) }
  }

  private async canonicalRoot(): Promise<string> {
    this.root ??= (async () => {
      await mkdir(this.path, { recursive: true, mode: 0o700 })
      if ((await lstat(this.path)).isSymbolicLink()) throw new Error('Task resource root must not be a symlink')
      return realpath(this.path)
    })()
    const root = await this.root
    if ((await lstat(this.path)).isSymbolicLink() || await realpath(this.path) !== root)
      throw new Error('Task resource root changed')
    return root
  }

  private async location(record: TaskResourceRecord): Promise<OwnedLocation> {
    const root = await this.canonicalRoot()
    const identity = JSON.stringify({ runId: record.runId, key: record.key, type: record.type })
    const base = join(root, createHash('sha256').update(identity).digest('hex'))
    if (await exists(base) && ((await lstat(base)).isSymbolicLink() || await realpath(base) !== base))
      throw new Error('Task resource directory changed ownership')
    return { base, data: join(base, 'data'), owner: join(base, 'owner.json'), identity }
  }

  private checkOwner(record: TaskResourceRecord, create: true): Promise<OwnedLocation>
  private checkOwner(record: TaskResourceRecord, create: false): Promise<OwnedLocation | undefined>
  private async checkOwner(record: TaskResourceRecord, create: boolean): Promise<OwnedLocation | undefined> {
    const location = await this.location(record)
    if (!await exists(location.base)) {
      if (!create) return undefined
      await mkdir(location.base, { mode: 0o700 })
    }
    if (!await exists(location.owner)) {
      if ((await readdir(location.base)).length !== 0) throw new Error('Task resource ownership marker is missing')
      // An empty directory may remain between mkdir and marker publication after a crash.
      await durableWrite(location.owner, location.identity)
    }
    if ((await lstat(location.owner)).isSymbolicLink() || await readFile(location.owner, 'utf8') !== location.identity)
      throw new Error('Task resource ownership marker does not match')
    if (await exists(location.data) && ((await lstat(location.data)).isSymbolicLink() || await realpath(location.data) !== location.data))
      throw new Error('Task resource data must not redirect outside its owned directory')
    return location
  }

  private async acquire(record: TaskResourceRecord, worktree: boolean, signal: AbortSignal) {
    signal.throwIfAborted()
    const request = worktree ? worktreeRequest.parse(record.request) : (directoryRequest.parse(record.request), undefined)
    const location = await this.checkOwner(record, true)
    if (request === undefined) await mkdir(location.data, { recursive: true, mode: 0o700 })
    else {
      const repository = await realpath(resolve(request.repository))
      if (!await exists(location.data)) await this.git(repository, ['worktree', 'add', '--detach', '--', location.data, request.ref], signal)
      await this.checkWorktree(repository, location.data, signal)
    }
    return { path: location.data }
  }

  private async cleanup(record: TaskResourceRecord, worktree: boolean, signal: AbortSignal): Promise<void> {
    const location = await this.checkOwner(record, false)
    if (location === undefined) return
    signal.throwIfAborted()
    if (worktree && await exists(location.data)) {
      const request = worktreeRequest.parse(record.request)
      const repository = await realpath(resolve(request.repository))
      await this.checkWorktree(repository, location.data, signal)
      await this.preserve(location.base, location.data, signal)
      await this.git(repository, ['worktree', 'remove', '--force', '--', location.data], signal)
    } else await rm(location.data, { recursive: true, force: true })
    signal.throwIfAborted()
    // Preserved work is retained beside its ownership marker, so backups retain the recovery files.
  }

  private async checkWorktree(repository: string, data: string, signal: AbortSignal): Promise<void> {
    const expected = await this.git(repository, ['rev-parse', '--path-format=absolute', '--git-common-dir'], signal)
    const actual = await this.git(data, ['rev-parse', '--path-format=absolute', '--git-common-dir'], signal)
    if (actual !== expected) throw new Error('Task worktree belongs to a different repository')
    const gitDirectory = await this.git(data, ['rev-parse', '--path-format=absolute', '--git-dir'], signal)
    const backlink = (await readFile(join(gitDirectory, 'gitdir'), 'utf8')).trim()
    if (await realpath(backlink) !== await realpath(join(data, '.git')))
      throw new Error('Task worktree was moved; repository registration must be reconciled before use')
  }

  private async preserve(base: string, data: string, signal: AbortSignal): Promise<void> {
    const identity = randomUUID()
    const destination = join(base, `preserved-${identity}`)
    const staging = join(base, `preserving-${identity}`)
    await mkdir(staging, { mode: 0o700 })
    const links: Record<string, string> = {}
    const walk = async (directory: string) => {
      signal.throwIfAborted()
      for (const entry of await readdir(join(data, directory), { withFileTypes: true })) {
        if (directory === '' && entry.name === '.git') continue
        const relative = join(directory, entry.name)
        if (entry.isSymbolicLink()) links[relative] = await readlink(join(data, relative))
        else if (entry.isDirectory()) { await mkdir(join(staging, relative), { mode: 0o700 }); await walk(relative) }
        else if (entry.isFile()) await durableWrite(join(staging, relative), await readFile(join(data, relative)))
        else throw new Error('Task worktree contains an unsupported filesystem entry')
      }
    }
    await walk('')
    await durableWrite(join(base, `preserved-${identity}.links.json`), JSON.stringify(links))
    signal.throwIfAborted()
    await rename(staging, destination)
    const directory = await open(base, 'r')
    try { await directory.sync() } finally { await directory.close() }
  }

  private async git(cwd: string, arguments_: string[], signal: AbortSignal): Promise<string> {
    const executable = await this.subprocess.resolveExecutable('git', undefined, signal)
    const process = this.subprocess.spawn({ argv: [executable, ...arguments_], cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: this.outputLimitBytes }, stderr: { maxBytes: this.outputLimitBytes } }, graceMs: this.graceMs, signal })
    try {
      const outcome = await process.done
      if (outcome.exitCode !== 0) throw new Error('Task worktree operation failed')
      const output = process.collected.stdout?.readFrom(0)
      if (output === undefined || output.lossy) throw new Error('Task worktree output is unavailable or exceeds its configured limit')
      return output.text.trim()
    } finally { process.terminate(); await process.waitForExit() }
  }
}
