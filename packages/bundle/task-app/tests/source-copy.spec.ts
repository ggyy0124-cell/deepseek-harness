/** Unchanged copied files must match upstream; approved Task additions pin both source generations. */
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const pairs = [
  ['packages/core/agent-loop/src', 'packages/task/task-agent-loop/src'],
  ['packages/preset/agent-presets/src', 'packages/task/task-agent-presets/src'],
  ['packages/preset/agent-presets/presets', 'packages/task/task-agent-presets/presets'],
] as const

async function inventory(root: string, path = ''): Promise<string[]> {
  const entries = await readdir(join(repository, root, path), { withFileTypes: true })
  return (await Promise.all(entries.map(async entry => entry.isDirectory()
    ? inventory(root, join(path, entry.name)) : [join(path, entry.name).replaceAll('\\', '/')]))).flat().sort()
}
async function hash(root: string, path: string): Promise<string | null> {
  try {
    const text = await readFile(join(repository, root, path), 'utf8')
    return createHash('sha256').update(text.replaceAll('@module @deepseek-ai/dsh-task-', '@module @deepseek-ai/dsh-')).digest('hex')
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

it('requires every copied file to match its original or the reviewed pair of source digests', async () => {
  const deltas = []
  for (const [original, copy] of pairs) {
    const paths = [...new Set([...await inventory(original), ...await inventory(copy)])].sort()
    for (const path of paths) {
      const originalSha256 = await hash(original, path)
      const copySha256 = await hash(copy, path)
      if (originalSha256 !== copySha256) deltas.push({ original, copy, path, originalSha256, copySha256 })
    }
  }
  const expected: unknown = JSON.parse(await readFile(new URL('./expected/provider-deltas.json', import.meta.url), 'utf8'))
  expect(deltas).toEqual(expected)
})
