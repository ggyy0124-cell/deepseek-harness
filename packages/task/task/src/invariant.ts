/** Task execution and Session persistence consistency checks. @module @deepseek-ai/dsh-task/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from './index.ts'

/** Cordis companion identity. */
export const name = 'task-invariant'
/** Registry needed before installing task observations. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  return Promise.all(ctx.tasks.listRuns().map(async (run) => {
    if (ctx.tasks.forSession(run.sessionId)?.id !== run.id) {
      fail(`execution ${run.id} does not own its recorded Session ${run.sessionId}`)
    }
    if (await ctx.sessionPersistence.stat(run.sessionId) === undefined) {
      fail(`execution ${run.id} has no persisted Session ${run.sessionId}`)
    }
  })).then(() => undefined)
}, { inject: ['tasks', 'sessionPersistence'] })

/** Register Task/Session consistency checks with the runtime diagnostics owner.
 * @param ctx - companion plugin context.
 * @returns installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-task', install))
