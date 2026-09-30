/** Offline copies preserve exact bytes and refuse active or corrupted sources. */
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, TaskDatabase } from '../src/database.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TaskRunId } from '@deepseek-ai/dsh-task'
import { backupTaskStore, restoreTaskStore } from '../src/maintenance.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'task-backup-')); roots.push(root)
  const tasks = join(root, 'tasks'); await mkdir(tasks)
  const db = new TaskDatabase(join(tasks, 'tasks.sqlite')); db.close()
  await mkdir(join(tasks, 'sessions')); await writeFile(join(tasks, 'sessions', 'retained.v1.jsonl'), 'retained bytes\n')
  return { tasks, copy: join(root, 'backup'), restored: join(root, 'restored') }
}
describe('Task maintenance', () => {
  it('propagates destination inspection errors without publishing a backup', async () => {
    const f = await fixture()
    await writeFile(f.copy, 'not a directory')
    await expect(backupTaskStore(f.tasks, join(f.copy, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    expect(await readFile(f.copy, 'utf8')).toBe('not a directory')
  })
  it.skipIf(process.platform === 'win32')('rejects Unix sockets in backup inventories', async () => {
    const f = await fixture()
    const server = createServer()
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(join(f.tasks, 'socket'), resolve)
      })
      await expect(backupTaskStore(f.tasks, f.copy)).rejects.toThrow('regular files')
    } finally { await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) }) }
  })
  it.skipIf(process.platform === 'win32')('rejects filenames that would become separators on another host', async () => {
    const f = await fixture()
    await writeFile(join(f.tasks, 'unsafe\\name'), 'bytes')
    await backupTaskStore(f.tasks, f.copy)
    await expect(restoreTaskStore(f.copy, f.restored)).rejects.toThrow('invalid file path')
  })
  it('refuses a byte-valid backup whose SQLite constraints fail integrity checks', async () => {
    const f = await fixture()
    const raw = new DatabaseSync(join(f.tasks, 'tasks.sqlite'))
    try { raw.exec('CREATE TABLE constrained(value INTEGER CHECK(value > 0)); PRAGMA ignore_check_constraints=ON; INSERT INTO constrained VALUES(-1)') }
    finally { raw.close() }
    await backupTaskStore(f.tasks, f.copy)
    await expect(restoreTaskStore(f.copy, f.restored)).rejects.toThrow('integrity check failed')
    await expect(readFile(join(f.restored, 'tasks.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('restores a first-generation store before newer metadata and resources exist', async () => {
    const f = await fixture()
    await rm(join(f.tasks, 'tasks.sqlite'))
    const raw = new DatabaseSync(join(f.tasks, 'tasks.sqlite'))
    try { raw.exec('CREATE TABLE operations(run_id TEXT, id TEXT, value TEXT); PRAGMA user_version=1') }
    finally { raw.close() }
    await backupTaskStore(f.tasks, f.copy)
    await restoreTaskStore(f.copy, f.restored)
    const restored = new DatabaseSync(join(f.restored, 'tasks.sqlite'))
    try { expect(restored.prepare('PRAGMA user_version').get()?.['user_version']).toBe(1) }
    finally { restored.close() }
  })
  it('restores recorded preset revisions and external operation receipts unchanged', async () => {
    const f = await fixture()
    const runId = brandString<TaskRunId>('preset-owner')
    const revision = { preset: 'standard', plugins: '- name: ./fixture.mjs\n', baseUrl: 'file:///presets/', digest: 'a'.repeat(64) }
    const source = new TaskDatabase(join(f.tasks, 'tasks.sqlite'))
    try {
      source.putOperation(runId, '@preset:config', 'confirmed', revision)
      source.putOperation(runId, 'external', 'confirmed', { id: 'operation1' })
    } finally { source.close() }
    await backupTaskStore(f.tasks, f.copy)
    await restoreTaskStore(f.copy, f.restored)
    const restored = new TaskDatabase(join(f.restored, 'tasks.sqlite'))
    try {
      expect(restored.operation(runId, '@preset:config')).toMatchObject({ state: 'confirmed', value: revision })
      expect(restored.operation(runId, 'external')).toMatchObject({ state: 'confirmed', value: { id: 'operation1' } })
    } finally { restored.close() }
  })
  it('refuses unsupported database and manifest generations', async () => {
    const f = await fixture()
    await backupTaskStore(f.tasks, f.copy)
    const path = join(f.copy, 'manifest.json')
    const manifest = JSON.parse(await readFile(path, 'utf8')) as { schemaVersion: number }
    await writeFile(path, JSON.stringify({ ...manifest, schemaVersion: SCHEMA_VERSION + 1 }))
    await expect(restoreTaskStore(f.copy, f.restored)).rejects.toThrow('newer')
    const database = new DatabaseSync(join(f.tasks, 'tasks.sqlite'))
    try { database.exec(`PRAGMA user_version=${SCHEMA_VERSION + 1}`) } finally { database.close() }
    await expect(backupTaskStore(f.tasks, f.restored)).rejects.toThrow('newer')
  })
  it.each(['missing-database', 'duplicate', 'extra-file'] as const)('rejects a %s manifest before publishing restored data', async (mode) => {
    const f = await fixture()
    await backupTaskStore(f.tasks, f.copy)
    const path = join(f.copy, 'manifest.json')
    const manifest = JSON.parse(await readFile(path, 'utf8')) as { files: { path: string }[] }
    if (mode === 'missing-database') manifest.files = manifest.files.filter(file => file.path !== 'tasks.sqlite')
    else if (mode === 'duplicate') manifest.files.push(manifest.files[0]!)
    else await writeFile(join(f.copy, 'unexpected'), 'extra')
    await writeFile(path, JSON.stringify(manifest))
    await expect(restoreTaskStore(f.copy, f.restored)).rejects.toThrow(mode === 'extra-file' ? 'inventory differs' : 'incomplete')
    await expect(readFile(join(f.restored, 'tasks.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects overlapping paths, existing backups and redirected restore destinations', async () => {
    const f = await fixture()
    await backupTaskStore(f.tasks, f.copy)
    await expect(backupTaskStore(f.tasks, f.copy)).rejects.toThrow('must not exist')
    await expect(backupTaskStore(f.tasks, join(f.tasks, '..'))).rejects.toThrow('disjoint')
    await expect(restoreTaskStore(f.copy, join(f.copy, 'inside'))).rejects.toThrow('disjoint')
    await expect(restoreTaskStore(f.copy, join(f.copy, '..'))).rejects.toThrow('disjoint')
    const empty = join(f.tasks, 'empty'); await mkdir(empty)
    await symlink(empty, f.restored, 'dir')
    await expect(restoreTaskStore(f.copy, f.restored)).rejects.toThrow('empty destination')
  })
  it('refuses symbolic links in source inventories', async () => {
    const f = await fixture()
    await symlink(join(f.tasks, 'sessions'), join(f.tasks, 'redirect'), 'dir')
    await expect(backupTaskStore(f.tasks, f.copy)).rejects.toThrow('symbolic links')
    await expect(readFile(join(f.copy, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('backs up SQLite and immutable Session bytes, then restores with a fresh stream identity', async () => {
    const f = await fixture()
    const runId = brandString<TaskRunId>('restored-resource')
    const source = new TaskDatabase(join(f.tasks, 'tasks.sqlite'))
    try {
      source.putResource({ runId, key: 'work', type: 'task.directory', request: {},
        value: { path: join(f.tasks, 'resources', 'old') }, state: 'ready' })
      source.putResource({ runId, key: 'finished', type: 'task.directory', request: {}, value: null, state: 'released' })
    } finally { source.close() }
    await backupTaskStore(f.tasks, f.copy)
    await restoreTaskStore(f.copy, f.restored)
    expect(await readFile(join(f.restored, 'sessions', 'retained.v1.jsonl'), 'utf8')).toBe('retained bytes\n')
    const original = new TaskDatabase(join(f.tasks, 'tasks.sqlite'))
    const restored = new TaskDatabase(join(f.restored, 'tasks.sqlite'))
    try {
      expect(restored.id).not.toBe(original.id)
      expect(restored.managedResources(runId).map(record => record.state)).toEqual(['prepared', 'released'])
      expect(original.managedResources(runId)[0]?.state).toBe('ready')
    } finally { original.close(); restored.close() }
  })
  it('refuses an active host, nested output, corrupted bytes and nonempty restore destinations', async () => {
    const f = await fixture()
    const active = new TaskDatabase(join(f.tasks, 'tasks.sqlite'))
    try { await expect(backupTaskStore(f.tasks, f.copy)).rejects.toThrow() } finally { active.close() }
    await expect(backupTaskStore(f.tasks, join(f.tasks, 'backup'))).rejects.toThrow('disjoint')
    await backupTaskStore(f.tasks, f.copy)
    await expect(restoreTaskStore(f.copy, f.tasks)).rejects.toThrow('empty')
    await writeFile(join(f.copy, 'sessions', 'retained.v1.jsonl'), 'changed')
    await expect(restoreTaskStore(f.copy, f.restored)).rejects.toThrow('checksum')
  })
})
