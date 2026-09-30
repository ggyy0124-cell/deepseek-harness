/** Independent Task and Session persistence observations must agree. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TaskDefinitionId, TaskRun, TaskRunId, TaskService } from '../src/index.ts'
import * as TaskInvariant from '../src/invariant.ts'
import { stub } from '../../task-local/tests/stub.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

const run: TaskRun = {
  id: brandString<TaskRunId>('run'), sessionId: SessionId('session'), definitionId: brandString<TaskDefinitionId>('business'),
  kind: 'manual', parentRunId: null, businessKey: null, codeVersion: '1', configRevision: 1,
  config: { schedule: { kind: 'manual' }, concurrency: 1, preset: 'test', permissionPreset: 'test', workspacePath: '/', business: null },
  input: null, checkpoint: null, revision: 2, inputRevision: 1, status: 'waiting_input', wait: null, retryAt: null,
  result: null, reason: null, createdAt: 0, updatedAt: 0, terminalAt: null, cleanup: 'pending', resources: [],
}

async function setup(options: { owner?: TaskRun; persisted?: boolean } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(InvariantRegistry)
  const owner = options.owner === undefined ? run : options.owner
  const persisted = options.persisted ?? true
  ctx.provide('tasks', stub<TaskService>({
    listRuns: () => [run],
    forSession: () => owner,
  }))
  // The invariant reads only whether a header exists for the owned Session.
  const persistence: unknown = {
    stat: async () => persisted ? { header: { id: run.sessionId } } : undefined,
  }
  ctx.provide('sessionPersistence', persistence as Context['sessionPersistence'])
  return ctx
}

describe('task Session invariants', () => {
  it('accepts a Task execution linked to a persisted Session', async () => {
    const ctx = await setup()
    await expect(ctx.plugin(TaskInvariant).then(() => undefined)).resolves.toBeUndefined()
  })

  it('rejects a Session linked to a different Task execution', async () => {
    const ctx = await setup({ owner: { ...run, id: brandString<TaskRunId>('other') } })
    await expect(ctx.plugin(TaskInvariant).then(() => undefined)).rejects.toThrow('does not own its recorded Session')
  })

  it('rejects a Task execution without persisted Session data', async () => {
    const ctx = await setup({ persisted: false })
    await expect(ctx.plugin(TaskInvariant).then(() => undefined)).rejects.toThrow('has no persisted Session')
  })
})
