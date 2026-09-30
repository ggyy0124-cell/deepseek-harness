/** Task Agent replacement creation authorization behavior. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import TaskAgentRegistry, { taskAgentRegistry } from '@deepseek-ai/dsh-task-agent'
import { describe, expect, it } from 'vitest'

function agent(id: string, ctx = new Context()): Agent {
  return {
    ctx,
    id: SessionId(id),
    options: {},
    session: Session.create(SessionId(id)),
    inbox: { nextTurn: [], nextStep: [] } as never,
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel: () => {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

describe('TaskAgentRegistry', () => {
  it('checks create, resume, and enter against the causal initiator and parent', async () => {
    const ctx = new Context()
    await ctx.plugin(TaskAgentRegistry)
    const initiator = agent('initiator')
    const parent = agent('parent')
    const observations: string[] = []
    const remove = taskAgentRegistry(ctx).guardCreation((current, owner) => {
      observations.push(`${current?.id ?? '-'}:${owner?.id ?? '-'}`)
      throw new Error('dispatch required')
    })

    await expect(ctx.agents.create({ sessionId: SessionId('create'), parentAgent: parent }))
      .rejects.toThrow('dispatch required')
    await expect(ctx.agents.resume({ resumeSessionId: SessionId('resume'), parentAgent: parent }))
      .rejects.toThrow('dispatch required')
    expect(() => ctx.agents.withInitiator(initiator, () => ctx.agents.enter(agent('entered'), parent)))
      .toThrow('dispatch required')
    expect(observations).toEqual(['-:parent', '-:parent', 'initiator:parent'])

    remove()
    expect(() => ctx.agents.enter(agent('accepted'), undefined)).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('reports a creation that fails after its guards admitted it', async () => {
    const ctx = new Context()
    await ctx.plugin(TaskAgentRegistry)
    const failed: string[] = []
    const remove = taskAgentRegistry(ctx).guardCreation(() => {}, (id) => { failed.push(id) })
    // No agent-loop plugin registers a factory, so creation fails after the guards run.
    await expect(ctx.agents.create({ sessionId: SessionId('failed') })).rejects.toThrow('no agent factory registered')
    expect(failed).toEqual(['failed'])

    remove()
    await expect(ctx.agents.create({ sessionId: SessionId('unobserved') })).rejects.toThrow('no agent factory registered')
    expect(failed).toEqual(['failed'])
    await ctx.fiber.dispose()
  })

  it('rejects a composition that retained the ordinary registry', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    expect(() => taskAgentRegistry(ctx)).toThrow('requires @deepseek-ai/dsh-task-agent')
    await ctx.fiber.dispose()
  })
})
