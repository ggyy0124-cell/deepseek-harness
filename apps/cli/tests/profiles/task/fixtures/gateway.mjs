/** Local test entry provisions private credentials without printing them. */
import { writeFileSync, appendFileSync, renameSync } from 'node:fs'
export const inject = ['taskGateway', 'webServer', 'tasks']
export async function apply(ctx, config) {
  writeFileSync(config.output + '.log', '', { mode: 0o600 })
  ctx.logger.exporter({ export: message => {
    appendFileSync(config.output + '.log', JSON.stringify(message.args) + '\n')
  } })
  const device = await ctx.taskGateway.createDeviceToken()
  const revoked = await ctx.taskGateway.createDeviceToken()
  await ctx.taskGateway.revokeDeviceToken(revoked.id)
  const { token: launch } = await ctx.taskGateway.createLaunchToken()
  ctx.tasks.register(ctx, {
    id: 'gateway-smoke', title: 'Gateway smoke', codeVersion: '1',
    config: { schedule: { kind: 'manual' }, concurrency: 1, preset: 'standard', permissionPreset: 'read-only', workspacePath: config.workspace, business: null },
    parseInput: value => value, parseCheckpoint: value => value,
    runSpecial: async stage => stage.run.input?.format === 'task-result/v1'
      ? { kind: 'succeed', result: stage.run.input }
      : { kind: 'wait', checkpoint: 'private-checkpoint', prompt: 'Approve work' },
    priority: () => 0, resources: () => [],
    classifyError: (error, run) => (appendFileSync(config.output + '.error', String(error) + '\n'), { kind: 'block', checkpoint: run.checkpoint, reason: 'needs repair' }),
    cleanup: async () => {},
  })
  const ready = ctx.get('appReady')
  if (ready === undefined) throw new Error('Task fixture requires the profile readiness signal')
  ctx.effect(() => ready.onReady(() => {
    writeFileSync(config.output + '.pending', JSON.stringify({ port: ctx.webServer.port, device, revoked, launch }), { mode: 0o600 })
    renameSync(config.output + '.pending', config.output)
  }))
}
