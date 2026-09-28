/** Task Session replacement authorization behavior. */
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import TaskSessionStore, { taskSessionStore } from '@deepseek-ai/dsh-task-session'
import { describe, expect, it } from 'vitest'

describe('TaskSessionStore', () => {
  it('checks owned mutations and removes an effect-scoped policy', async () => {
    const ctx = new Context()
    await ctx.plugin(TaskSessionStore)
    let allowed = false
    const remove = taskSessionStore(ctx).guardMutations(
      id => id.startsWith('owned-'),
      () => { if (!allowed) throw new Error('owner required') },
    )

    expect(() => ctx.sessions.create(SessionId('free'))).not.toThrow()
    expect(ctx.sessions.create().id).toBeTruthy()
    expect(ctx.sessions.prepare().id).toBeTruthy()
    expect(() => ctx.sessions.create(SessionId('owned-create'))).toThrow('owner required')
    expect(() => ctx.sessions.prepare(SessionId('owned-prepare'))).toThrow('owner required')
    expect(() => ctx.sessions.enter(Session.create(SessionId('owned-enter')))).toThrow('owner required')
    expect(() => ctx.sessions.fork(Session.create(SessionId('owned-source')))).toThrow('owner required')
    expect(() => ctx.sessions.fork(Session.create(SessionId('free-source')), undefined, SessionId('owned-child')))
      .toThrow('owner required')

    allowed = true
    expect(ctx.sessions.create(SessionId('owned-allowed')).id).toBe('owned-allowed')
    expect(ctx.sessions.fork(SessionId('owned-allowed')).id).not.toBe('owned-allowed')
    remove()
    allowed = false
    expect(ctx.sessions.create(SessionId('owned-after-remove')).id).toBe('owned-after-remove')
    await ctx.fiber.dispose()
  })

  it('rejects a composition that retained the ordinary provider', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    expect(() => taskSessionStore(ctx)).toThrow('requires @deepseek-ai/dsh-task-session')
    await ctx.fiber.dispose()
  })
})
