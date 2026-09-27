/** Test business installed through the shipped Task Profile's Loader. */
import { writeFileSync, appendFileSync } from 'node:fs'

export const inject = ['tasks']

export function apply(ctx, config) {
  if (config.output !== undefined) {
    ctx.logger.exporter({ export: message => {
      for (const value of message.args) {
        if (typeof value === 'string' && value.startsWith('task.notification ')) {
          appendFileSync(config.output + '.notifications', value.slice('task.notification '.length) + '\n', { mode: 0o600 })
        }
      }
    } })
  }
  const id = config.id ?? 'profile-smoke'
  const unregister = ctx.tasks.register(ctx, {
    id, title: config.title ?? 'Profile smoke', codeVersion: '1',
    config: {
      schedule: { kind: 'manual' }, concurrency: 2, preset: 'standard',
      permissionPreset: 'read-only', workspacePath: config.workspace, business: null,
    },
    parseInput: value => value, parseCheckpoint: value => value,
    runSpecial: async stage => {
      await stage.dispatch('business-one', { id: 'one' })
      return { kind: 'succeed', result: 'dispatched' }
    },
    runOrdinary: async stage => stage.inputs.some(input => input.kind === 'response')
      ? { kind: 'succeed', result: 'approved after restart' }
      : { kind: 'wait', checkpoint: 'review', prompt: 'Review business work' },
    businessKey: input => input.id, compareUpdate: () => 'ignore',
    priority: () => 0, resources: () => [],
    classifyError: (error, run) => ({ kind: 'block', checkpoint: run.checkpoint, reason: String(error) }),
    cleanup: async () => {},
  })
  if (config.removeAfterMs !== undefined) {
    const timer = setTimeout(() => {
      void unregister().then(() => {
        if (config.removedOutput !== undefined) writeFileSync(config.removedOutput, 'removed')
      })
    }, config.removeAfterMs)
    ctx.effect(() => () => clearTimeout(timer), 'task-smoke.removal')
  }
  if (config.output === undefined) return
  const initial = ctx.tasks.command('profile-owner', 'initial', { kind: 'trigger', definitionId: id, input: null })
  if (initial.kind !== 'run' || initial.run.status !== 'provisioning') throw new Error('command receipt did not retain admission')
  ctx.effect(() => {
    let previous = ''
    const timer = setInterval(() => {
      const runs = ctx.tasks.listRuns()
      if (config.resume) {
        for (const run of runs) {
          if (run.wait !== null) ctx.tasks.command('profile-owner', `approval:${run.id}`, {
            kind: 'respond', runId: run.id, waitId: run.wait.id, revision: run.wait.revision, response: 'approved',
          })
        }
      }
      const value = JSON.stringify(runs)
      if (value !== previous) {
        writeFileSync(config.output, value)
        previous = value
      }
    }, 20)
    return () => clearInterval(timer)
  }, 'task-smoke.observation')
}
