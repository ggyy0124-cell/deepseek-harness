/** Shipped Task Profile boot, independent dispatch, and graceful restart. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { taskProfileLaunch } from './launch.ts'
import { describe, expect, it } from 'vitest'
import type { TaskRun } from '@deepseek-ai/dsh-task'

const repository = fileURLToPath(new URL('../../../../../', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/business.mjs', import.meta.url))

describe('shipped Task Profile', () => {
  it.each(['src', 'lib'] as const)('%s: keeps a dispatched Session and its pending confirmation across process restart', async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-task-profile-'))
    const output = join(directory, 'observation.json')
    const removedOutput = join(directory, 'secondary-removed')
    const patch = join(directory, 'smoke.patch.yml')
    let child: (Pick<ReturnType<typeof execa>, 'kill'> & PromiseLike<{ exitCode?: number | undefined }>) | undefined
    let diagnostics = ''
    const start = async (resume: boolean): Promise<void> => {
      await writeFile(patch, JSON.stringify([
        { id: 'task-local', config: { path: join(directory, 'tasks.sqlite'), resourceRoot: join(directory, 'resources'), concurrency: 2, tickMs: 20, catchupLimit: 100 } },
        { insert: [{ id: 'task-smoke-secondary', name: fixture, config: { id: 'profile-secondary', title: 'Secondary', workspace: directory, removeAfterMs: 50, removedOutput } }] },
        { insert: [{ id: 'task-smoke', name: fixture, config: { workspace: directory, output, resume } }] },
      ]))
      const launch = taskProfileLaunch(['--patch', patch, '--host', '127.0.0.1', '--port', '0'], mode)
      const process = execa(launch.command, launch.args, {
        cwd: repository,
        env: { ...launch.env, DSH_HOME: join(directory, '.dsh'), DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'keyless-no-model-call' },
        timeout: 45_000, killSignal: 'SIGKILL', reject: false,
      })
      child = process
      process.stdout.on('data', (chunk: Buffer) => { diagnostics += chunk.toString() })
      process.stderr.on('data', (chunk: Buffer) => { diagnostics += chunk.toString() })
    }
    const observe = async (status: TaskRun['status']): Promise<TaskRun[]> => {
      let runs: TaskRun[] = []
      await expect.poll(async () => {
        try { runs = JSON.parse(await readFile(output, 'utf8')) as TaskRun[] }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
        }
        return runs.some(run => run.kind === 'ordinary' && run.status === status)
      }, { timeout: 30_000 }).toBe(true).catch((error: unknown) => { throw new Error(diagnostics, { cause: error }) })
      return runs
    }
    try {
      await start(false)
      const before = await observe('waiting_input')
      await expect.poll(async () => {
        try { return await readFile(removedOutput, 'utf8') }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          return ''
        }
      }).toBe('removed')
      expect(before.find(run => run.kind === 'manual')?.status).toBe('succeeded')
      expect(before.some(run => run.definitionId === 'profile-secondary')).toBe(false)
      await expect.poll(async () => await readFile(removedOutput, 'utf8'), { timeout: 10_000 }).toBe('removed')
      const ordinary = before.find(run => run.kind === 'ordinary')!
      const readNotifications = async () => {
        try {
          return (await readFile(output + '.notifications', 'utf8')).trim().split('\n')
            .map(line => JSON.parse(line) as { store: string; sequence: number; event: string; runId: string })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
          throw error
        }
      }
      await expect.poll(async () => (await readNotifications())
        .some(entry => entry.event === 'stage.waiting' && entry.runId === ordinary.id), { timeout: 10_000 }).toBe(true)
      child!.kill('SIGTERM')
      expect((await child!).exitCode, diagnostics).toBe(0)
      await start(true)
      const after = await observe('succeeded')
      expect(after.find(run => run.kind === 'ordinary')).toMatchObject({
        id: ordinary.id, sessionId: ordinary.sessionId, result: 'approved after restart',
      })
      expect(after).toHaveLength(2)
      const notifications = await readNotifications()
      expect(new Set(notifications.map(entry => `${entry.store}:${entry.sequence}`)).size).toBe(notifications.length)
      child!.kill('SIGTERM')
      expect((await child!).exitCode, diagnostics).toBe(0)
    } finally {
      child?.kill('SIGKILL')
      await child
      await rm(directory, { recursive: true, force: true })
    }
  }, 80_000)
})
