/** Local administration uses the shipped Task profile without opening a server or scheduler. */
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { TaskDatabase } from '../../../../../packages/task/task-local/src/database.ts'
const repository = fileURLToPath(new URL('../../../../../', import.meta.url))
describe('Task administration profile', () => {
  it.each(['source', 'built'] as const)('%s: administers credentials and an offline store without scheduling work', async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'task-admin-'))
    const home = join(root, 'home')
    const run = (args: string[], selectedHome = home) => execa(process.execPath, [...(mode === 'source' ? ['--import', 'tsx/esm', join(repository, 'apps/cli/src/bin.ts')] : [join(repository, 'apps/cli/lib/bin.js')]), '--profile', 'task', ...args], {
      cwd: repository, env: { DSH_HOME: selectedHome, DSH_TELEMETRY_DISABLED: '1' }, timeout: 30000, reject: false,
    })
    try {
      const created = await run(['--token-create'])
      expect(created.exitCode, created.stderr).toBe(0)
      const device = JSON.parse(created.stdout.split('\n').find(line => line.startsWith('{"id":')) ?? '{}') as { id: string; token: string }
      expect(/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(device.token)).toBe(true)
      expect((await run(['--token-revoke', device.id])).exitCode).toBe(0)
      await mkdir(join(home, 'tasks'), { recursive: true })
      const db = new TaskDatabase(join(home, 'tasks', 'tasks.sqlite')); db.close()
      const backup = join(root, 'backup')
      const copied = await run([`--backup=${backup}`])
      expect(copied.exitCode, copied.stderr).toBe(0)
      expect(JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'))).toMatchObject({ version: 1 })
      const restored = await run(['--restore', backup], join(root, 'restored'))
      expect(restored.exitCode, restored.stderr).toBe(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
