/** Task preset declarations follow the Web declarations except for the reviewed Task delegation limits. */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

type Row = { id?: string; name?: string; disabled?: unknown; config?: unknown }

const bundle = (dir: string): URL => new URL(`../../${dir}/`, import.meta.url)

async function presetPatches(dir: string): Promise<string[]> {
  const manifest = JSON.parse(await readFile(new URL('package.json', bundle(dir)), 'utf8')) as { dsh: { bundle: { patch: string[] } } }
  return manifest.dsh.bundle.patch.filter(file => file.startsWith('./presets/')).map(file => basename(file))
}

/** The single declaration row one preset patch file inserts. */
async function declaration(dir: string, file: string): Promise<Row & { config: { id: string; plugins: Row[] } }> {
  const patch = load(await readFile(new URL(`presets/${file}`, bundle(dir)), 'utf8'), { schema: entryListSchema }) as [{ insert: [Row & { config: { id: string; plugins: Row[] } }] }]
  expect(patch).toHaveLength(1)
  expect(patch[0].insert).toHaveLength(1)
  return patch[0].insert[0]
}

function rows(plugins: readonly Row[]): Row[] {
  return plugins.flatMap(row => [row, ...Array.isArray(row.config) ? rows(row.config as Row[]) : []])
}

const foreground = { backgroundMode: 'one-shot', enableRunInBackground: false, maxDepth: 1 }

/** The Task delegation limits applied to one Web row; every other row is unchanged. */
function withTaskLimits(row: Row): Row {
  const config = Array.isArray(row.config) ? row.config.map(child => withTaskLimits(child as Row)) : row.config
  if (row.id === 'tool-subagent' || row.id === 'tool-subagent-fork') {
    return { ...row, config: { ...config as object, ...foreground } }
  }
  if (row.id === 'workflow-ptc' || row.id === 'tool-workflow') return { ...row, disabled: true, config }
  return { ...row, config }
}

describe('shipped Task presets', () => {
  it('declare the same presets as the Web bundle', async () => {
    expect(await presetPatches('task-app')).toEqual(await presetPatches('web-app'))
  })

  it('equal their Web declarations with only the Task delegation limits applied', async () => {
    for (const file of await presetPatches('task-app')) {
      const web = await declaration('web-app', file)
      const task = await declaration('task-app', file)
      expect(task, file).toEqual({ ...web, config: { ...web.config, plugins: web.config.plugins.map(withTaskLimits) } })
    }
  })

  it('keep delegation foreground and asynchronous workflow starts disabled', async () => {
    for (const file of await presetPatches('task-app')) {
      for (const row of rows((await declaration('task-app', file)).config.plugins)) {
        if (row.id === 'tool-subagent' || row.id === 'tool-subagent-fork') expect(row.config, `${file}/${row.id}`).toMatchObject(foreground)
        if (row.id === 'workflow-ptc' || row.id === 'tool-workflow' || row.id === 'tool-ralph') expect(row.disabled, `${file}/${row.id}`).toBe(true)
      }
    }
  })
})
