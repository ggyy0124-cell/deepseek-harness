/** Business stages derive model inputs from the selected canonical Session fixture. */
import { readFileSync } from 'node:fs'
export const inject = ['tasks']
export function apply(ctx, config) {
  const prompts = readFileSync(config.fixture, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    .filter(event => event.type === 'user/message' && event.data.source.plugin === 'task-local')
    .map(event => event.data.content.filter(block => block.type === 'text').map(block => block.text).join(''))
  ctx.tasks.register(ctx, {
    id: 'model-wait', title: 'Model wait', codeVersion: '1',
    config: { schedule: { kind: 'manual' }, concurrency: 1, preset: 'standard', permissionPreset: 'read-only',
      model: { provider: 'task-snapshot', model: 'task-model' }, workspacePath: config.workspace, business: null },
    parseInput: value => value, parseCheckpoint: value => value,
    runSpecial: async stage => stage.run.checkpoint === null
      ? { kind: 'wait', checkpoint: await stage.model('analysis', prompts[0]), prompt: 'Confirm the analysis' }
      : { kind: 'succeed', result: await stage.model('completion', prompts[1]) },
    priority: () => 0, resources: () => [],
    classifyError: (error, run) => ({ kind: 'block', checkpoint: run.checkpoint, reason: String(error) }),
    cleanup: async () => {},
  })
}
