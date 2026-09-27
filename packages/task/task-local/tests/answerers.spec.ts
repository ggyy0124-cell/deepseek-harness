/** Task answerers preserve ordinary-agent delegation and validate persisted reply forms. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TaskRun, TaskService } from '@deepseek-ai/dsh-task'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { installTaskAnswerers } from '../src/answerers.ts'
import type { RuntimeInteractions } from '../src/interactions.ts'
import { validateForm } from '../src/forms.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose() })
function fixture(answer: JsonValue) {
  const ctx = new Context()
  contexts.push(ctx)
  // Answerers only inspect Agent identity and the owning Run id.
  const agent = { id: SessionId('owned') } as Agent
  const ordinary = { id: SessionId('ordinary') } as Agent
  const lookup: Pick<TaskService, 'forSession'> = { forSession: id => id === agent.id ? { id: 'run' } as TaskRun : undefined }
  const ask = vi.fn<RuntimeInteractions['ask']>(async () => answer)
  installTaskAnswerers(ctx, lookup as TaskService, { ask } as unknown as RuntimeInteractions)
  return { ctx, agent, ordinary, ask }
}

describe('Task interaction answerers', () => {
  it('delegates approvals and questions outside Task ownership', async () => {
    const { ctx, ordinary, ask } = fixture(null)
    const approval = vi.fn(async () => 'rejected' as const)
    const questions = vi.fn(async () => ({ answers: [] }))
    expect(await ctx.waterfall('approval/request', { agent: ordinary, toolName: 'external' }, approval)).toBe('rejected')
    expect(await ctx.waterfall('user-questions/request', { agent: ordinary, questions: [] }, questions)).toEqual({ answers: [] })
    expect(await ctx.waterfall('user-questions/request', { questions: [] }, questions)).toEqual({ answers: [] })
    expect(approval).toHaveBeenCalledOnce()
    expect(questions).toHaveBeenCalledTimes(2)
    expect(ask).not.toHaveBeenCalled()
  })

  it('binds approvals to caller cancellation and the provider lifetime', async () => {
    const { ctx, agent, ask } = fixture('allowed-once')
    const control = new AbortController()
    const next = vi.fn(async () => 'unavailable' as const)
    expect(await ctx.waterfall('approval/request', { agent, toolName: 'publish', reason: 'Review', signal: control.signal }, next))
      .toBe('allowed-once')
    expect(ask.mock.calls[0]?.[1]).toMatchObject({ source: 'tool_approval', title: 'publish', description: 'Review' })
    const explicit = ask.mock.calls[0]![2]
    control.abort(); expect(explicit.aborted).toBe(true)
    await ctx.waterfall('approval/request', { agent, toolName: 'publish' }, next)
    const lifetime = ask.mock.calls[1]![2]
    expect(lifetime.aborted).toBe(false)
    expect(ask.mock.calls[1]?.[1].description).toBe('')
    await ctx.fiber.dispose()
    expect(lifetime.aborted).toBe(true)
    expect(next).not.toHaveBeenCalled()
  })

  it('retains question identities, allowed choices, selection counts and free text', async () => {
    const answer = { answers: [{ id: 'choice', selected: ['A', 'B'] }, { id: 'text', selected: [], custom: 'detail' }] }
    const { ctx, agent, ask } = fixture(answer)
    const questions = [
      { id: 'choice', question: 'Choose', detail: 'More', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] },
      { id: 'text', question: 'Explain' },
    ]
    expect(await ctx.waterfall('user-questions/request', { agent, questions }, async () => ({ answers: [] }))).toEqual(answer)
    const captured = ask.mock.calls[0]![1]
    expect(captured).toMatchObject({ source: 'agent_question', title: 'Choose\nExplain', description: 'More' })
    expect(() => { validateForm(captured.schema, answer) }).not.toThrow()
    expect(() => { validateForm(captured.schema, { answers: [{ id: 'choice', selected: ['unknown'] }, answer.answers[1]!] }) }).toThrow()
    const single = fixture({ answers: [{ id: 'one', selected: ['A'] }] })
    const control = new AbortController()
    await single.ctx.waterfall('user-questions/request', { agent: single.agent, signal: control.signal,
      questions: [{ id: 'one', question: 'Pick one', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }] }, async () => ({ answers: [] }))
    expect(() => { validateForm(single.ask.mock.calls[0]![1].schema, { answers: [{ id: 'one', selected: ['A', 'B'] }] }) }).toThrow()
    control.abort()
    expect(single.ask.mock.calls[0]![2].aborted).toBe(true)
  })
})
