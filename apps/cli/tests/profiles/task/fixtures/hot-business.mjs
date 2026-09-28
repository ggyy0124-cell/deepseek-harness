/** Exercises Loader-owned Task registration without external business systems. */
import { existsSync, writeFileSync } from 'node:fs'
export const inject = ['tasks']
export function apply(ctx, config) {
  ctx.tasks.register(ctx, {
    id: 'hot-business', title: config.title, codeVersion: '1',
    config: { schedule: { kind: 'manual' }, concurrency: 1, preset: 'standard', permissionPreset: 'read-only', workspacePath: config.workspace, business: null },
    parseInput: value => value, parseCheckpoint: value => value,
    runSpecial: async stage => {
      await stage.resource('files', 'task.directory', {})
      return { kind: 'wait', checkpoint: 'retained-stage', prompt: 'Continue work' }
    },
    priority: () => 0, resources: () => ['hot-business-resource'],
    classifyError: (_error, run) => ({ kind: 'block', checkpoint: run.checkpoint, reason: 'needs repair' }),
    cleanup: async () => {
      if (config.cleanupBlock && existsSync(config.cleanupBlock)) throw new Error('Cleanup resource is unavailable')
    },
  })
  if (config.disposed) ctx.effect(() => () => { writeFileSync(config.disposed, 'disposed') })
}
