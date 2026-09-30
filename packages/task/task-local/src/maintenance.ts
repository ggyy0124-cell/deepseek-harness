/** Offline, manifest-verified Task backup and restore under the existing dsh launcher. */
import { DatabaseSync, backup } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, lstat, readFile, writeFile, copyFile, rename, rm, rmdir } from 'node:fs/promises'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { z } from 'zod'
import { SCHEMA_VERSION } from './database.ts'

const manifestSchema = z.strictObject({
  version: z.literal(1),
  schemaVersion: z.number().int().nonnegative(),
  sourceRoot: z.string(),
  files: z.array(
    z.strictObject({
      path: z.string().min(1),
      size: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
})
async function inventory(root: string, directory = ''): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error('Task backups cannot contain symbolic links')
    if (entry.isDirectory()) result.push(...(await inventory(root, path)))
    else if (entry.isFile()) result.push(path)
    else throw new Error('Task backups require regular files')
  }
  return result.sort()
}
async function digest(path: string) {
  const bytes = await readFile(path)
  return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}
function contained(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path))
  return (
    value === '' ||
    (!isAbsolute(value) &&
      value !== '..' &&
      !value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
  )
}
async function absent(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw new Error('Task backup destination must not exist')
}
/** Copy a quiescent Task store using SQLite backup and exact file hashes.
 * @param root - Task-owned data root; credentials outside this root are excluded.
 * @param destination - new backup directory outside the source tree.
 * @returns completion only after the manifest and every file are atomically published.
 */
export async function backupTaskStore(root: string, destination: string): Promise<void> {
  if (contained(root, destination) || contained(destination, root))
    throw new Error('Task backup paths must be disjoint')
  await absent(destination)
  await lstat(join(root, 'tasks.sqlite'))
  const owner = new DatabaseSync(join(root, 'tasks.sqlite.owner'))
  let database: DatabaseSync | undefined
  const staging = `${resolve(destination)}.${randomUUID()}.partial`
  try {
    owner.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE')
    database = new DatabaseSync(join(root, 'tasks.sqlite'), { readOnly: true })
    const version = database.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version.user_version > SCHEMA_VERSION)
      throw new Error('Task backup schema is newer than this application')
    await mkdir(staging, { recursive: true, mode: 0o700 })
    await backup(database, join(staging, 'tasks.sqlite'))
    for (const path of await inventory(root)) {
      if (
        path === 'tasks.sqlite' ||
        path.startsWith('tasks.sqlite-') ||
        path.startsWith('tasks.sqlite.owner')
      )
        continue
      await mkdir(dirname(join(staging, path)), { recursive: true, mode: 0o700 })
      await copyFile(join(root, path), join(staging, path))
    }
    const files = await Promise.all(
      (await inventory(staging)).map(async path => ({ path, ...(await digest(join(staging, path))) })),
    )
    await writeFile(
      join(staging, 'manifest.json'),
      JSON.stringify({ version: 1, schemaVersion: version.user_version, sourceRoot: resolve(root), files }),
      { mode: 0o600, flag: 'wx' },
    )
    await rename(staging, destination)
  } finally {
    database?.close()
    owner.close()
    await rm(staging, { recursive: true, force: true })
  }
}
/** Verify every stored byte before restoring into an empty, inactive Task root.
 * @param source - complete backup directory.
 * @param destination - empty Task root; existing user data is never overwritten.
 */
export async function restoreTaskStore(source: string, destination: string): Promise<void> {
  if (contained(source, destination) || contained(destination, source))
    throw new Error('Task restore paths must be disjoint')
  const manifest = manifestSchema.parse(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')))
  if (manifest.schemaVersion > SCHEMA_VERSION)
    throw new Error('Task restore schema is newer than this application')
  const actual = await inventory(source)
  const paths = manifest.files.map(file => file.path)
  if (new Set(paths).size !== paths.length || !paths.includes('tasks.sqlite'))
    throw new Error('Task backup manifest is incomplete')
  if (actual.filter(path => path !== 'manifest.json').join('\n') !== [...paths].sort().join('\n'))
    throw new Error('Task backup file inventory differs')
  for (const file of manifest.files) {
    if (
      file.path.includes('\\') ||
      file.path.split('/').some(part => part === '' || part === '.' || part === '..') ||
      isAbsolute(file.path)
    )
      throw new Error('Task backup contains an invalid file path')
    const observed = await digest(join(source, file.path))
    if (observed.size !== file.size || observed.sha256 !== file.sha256)
      throw new Error('Task backup checksum mismatch')
  }
  await mkdir(destination, { recursive: true, mode: 0o700 })
  if ((await lstat(destination)).isSymbolicLink() || (await readdir(destination)).length !== 0)
    throw new Error('Task restore requires an empty destination')
  const staging = `${resolve(destination)}.${randomUUID()}.partial`
  try {
    await mkdir(staging, { mode: 0o700 })
    for (const file of manifest.files) {
      await mkdir(dirname(join(staging, file.path)), { recursive: true, mode: 0o700 })
      await copyFile(join(source, file.path), join(staging, file.path))
    }
    const database = new DatabaseSync(join(staging, 'tasks.sqlite'))
    try {
      const integrity = database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
      if (integrity.integrity_check !== 'ok') throw new Error('Task backup database integrity check failed')
      database.exec('BEGIN IMMEDIATE')
      if (manifest.schemaVersion >= 2)
        database.prepare("UPDATE metadata SET value=? WHERE key='store_id'").run(randomUUID())
      if (manifest.schemaVersion >= 6)
        database.exec(`UPDATE managed_resources SET value=json_set(value,'$.state','prepared')
          WHERE value->>'state'='ready'`)
      database.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)')
    } finally {
      database.close()
    }
    await rmdir(destination)
    await rename(staging, destination)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
