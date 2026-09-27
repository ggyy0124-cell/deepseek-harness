/** Scoped tool admission and plugin disposal through the real tool registry. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { TaskService, TaskRun, TaskDispatchReceipt } from '@deepseek-ai/dsh-task'
import * as plugin from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const dispatch = vi.fn(async (): Promise<TaskDispatchReceipt> => ({
    outcome: 'created', runId: 'child' as TaskRun['id'], sessionId: SessionId('child-session'), changed: false,
  }))
  ctx.provide('tasks', {
    forSession: (id: string) => id === 'special' ? { kind: 'manual' } : id === 'ordinary' ? { kind: 'ordinary' } : undefined,
    dispatch,
  } as unknown as TaskService)
  const fiber = await ctx.plugin(plugin)
  const agents: Agent[] = []
  await ctx.plugin({
    name: 'fixture-agents', inject: ['tools'],
    apply(inner: Context) {
      for (const id of ['special', 'ordinary', 'unmanaged']) {
        const agent = { id: SessionId(id) } as Agent
        Object.assign(agent, { ctx: createScope(inner, agent).ctx })
        ctx.emit('agent/created', { agent })
        agents.push(agent)
      }
    },
  })
  return { ctx, dispatch, fiber, agents }
}

describe('task dispatch tool', () => {
  it('registers only in special-task scopes and removes live registrations on unload', async () => {
    const { ctx, fiber, agents } = await setup()
    const [special, ordinary, unmanaged] = agents
    expect(ctx.tools.schemas(special).map(schema => schema.name)).toContain('task_dispatch')
    expect(ctx.tools.schemas(ordinary).map(schema => schema.name)).not.toContain('task_dispatch')
    expect(ctx.tools.schemas(unmanaged).map(schema => schema.name)).not.toContain('task_dispatch')
    await fiber.dispose()
    expect(ctx.tools.schemas(special).map(schema => schema.name)).not.toContain('task_dispatch')
  })
  it('delegates exact-Agent input and rejects calls outside that tool scope', async () => {
    const { ctx, dispatch, agents } = await setup()
    const special = agents[0]!
    const result = await ctx.tools.execute({
      agent: special, signal: new AbortController().signal, name: 'task_dispatch', callId: ToolCallId('dispatch'),
      arguments: { request_id: 'bug-1', input_json: '{"id":1}' },
    })
    expect(result.isError).not.toBe(true)
    expect(dispatch).toHaveBeenCalledWith(special.id, 'bug-1', { id: 1 })
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ outcome: 'created', runId: 'child', sessionId: 'child-session', changed: false }) }])
    expect(ctx.tools.get('task_dispatch', special)?.presentCall?.({ request_id: 'bug-1', input_json: '{}' }))
      .toMatchObject({ card: 'generic', title: 'Dispatch business task', kind: 'other' })
    for (const args of [{ request_id: ' ', input_json: '{}' }, { request_id: 'bug-2', input_json: '{' }]) {
      const malformed = await ctx.tools.execute({ agent: special, signal: new AbortController().signal,
        name: 'task_dispatch', callId: ToolCallId('invalid'), arguments: args })
      expect(malformed.isError).toBe(true)
    }
    const denied = await ctx.tools.execute({
      agent: agents[1]!, signal: new AbortController().signal, name: 'task_dispatch', callId: ToolCallId('denied'),
      arguments: { request_id: 'bug-1', input_json: '{"id":1}' },
    })
    expect(denied.isError).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
  it('retains ownership checks when a registered definition is invoked directly', async () => {
    const { ctx, agents } = await setup()
    const special = agents[0]!
    const definition = ctx.tools.get('task_dispatch', special)
    if (definition === undefined) throw new Error('Expected special-task dispatch tool')
    const execution = {
      signal: new AbortController().signal,
      rootCallId: ToolCallId('direct'), callId: ToolCallId('direct'), name: 'task_dispatch', arguments: {},
      token: Symbol('direct'), deferContext() {}, concludeTurn() {},
    } as unknown as ToolRunContext
    await expect(definition.execute({ request_id: 'request', input_json: '{}' }, execution))
      .rejects.toThrow('requires its owning special Agent')
    await expect(definition.execute({ request_id: 'request', input_json: '{}' }, { ...execution, agent: agents[1]! }))
      .rejects.toThrow('requires its owning special Agent')
  })
})
