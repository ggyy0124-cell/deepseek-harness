/** Foreground child Agents are optional inside any model-driven Task execution. */
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { TaskDefinition, TaskDefinitionId, TaskRequestId, TaskRunId } from '@deepseek-ai/dsh-task'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as Fork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { TaskDatabase } from '../src/database.ts'
import { taskHost } from './host-fixture.ts'
import { stub } from './stub.ts'

const closes: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close() })

const id = brandString<TaskDefinitionId>('child-business')
const request = (value: string) => brandString<TaskRequestId>(value)

/** Test-only tool body that runs inside the calling Agent's model turn. */
type Probe = (ctx: Context, agent: Agent) => Promise<void>

interface FixtureOptions {
  readonly childConcurrency?: number
  readonly specialUsesModel?: boolean
  readonly probe?: Probe
  readonly definition?: Partial<TaskDefinition>
  readonly beforeTask?: (ctx: Context, directory: string) => void
}

async function fixture(script: ConstructorParameters<typeof MockAdapter>[0], options: FixtureOptions = {}) {
  const { childConcurrency = 4, specialUsesModel = false, probe } = options
  const host = await taskHost(async (ctx) => {
    options.beforeTask?.(ctx, fileURLToPath(ctx.baseUrl!))
    if (probe !== undefined) ctx.tools.register(defineTool({
      name: 'probe',
      description: 'Run the test probe.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(_args, exec) {
        await probe(ctx, exec.agent!)
        return 'probed'
      },
    }))
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(Spawn, { providerName: 'spawn' })
    await ctx.plugin(Fork, { providerName: 'fork' })
    await ctx.plugin(ToolSubagent, { provider: 'spawn', enableRunInBackground: false, backgroundMode: 'one-shot', maxDepth: 1 })
    await ctx.plugin(ToolSubagent, { provider: 'fork', toolName: 'subagent_fork', enableRunInBackground: false, backgroundMode: 'one-shot', maxDepth: 1 })
  }, { childConcurrency })
  closes.push(host.close)
  const adapter = new MockAdapter(script)
  host.ctx.llm.registerAdapter(['child-mock'], adapter)
  const definition: TaskDefinition = {
    id, title: 'Child business', codeVersion: '1',
    config: { schedule: { kind: 'manual' }, concurrency: 2, preset: 'minimal', permissionPreset: 'default',
      workspacePath: host.directory, business: null, model: { provider: 'child-mock', model: 'mock' } },
    parseInput: value => value as null, parseCheckpoint: value => value as null,
    priority: () => 0, resources: () => [], businessKey: () => 'item', compareUpdate: () => 'ignore',
    runSpecial: async (stage) => {
      if (specialUsesModel) return { kind: 'succeed', result: await stage.model('branches', 'Explore two branches.') }
      await stage.dispatch(request('dispatch'), null)
      return { kind: 'succeed', result: null }
    },
    runOrdinary: async stage => ({ kind: 'succeed', result: await stage.model('branches', 'Explore two branches.') }),
    classifyError: (error, run) => ({ kind: 'block', checkpoint: run.checkpoint, reason: String(error) }),
    cleanup: async () => {},
    ...options.definition,
  }
  await host.ctx.plugin({ name: 'child-business', inject: ['tasks'], apply(ctx) { ctx.tasks.register(ctx, definition) } })
  return { ...host, adapter }
}

function parallelCalls(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId('branch-a'), name: 'subagent',
      argumentsDelta: JSON.stringify({ description: 'Explore A', prompt: 'Check A' }) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('branch-a'), name: 'subagent',
      arguments: JSON.stringify({ description: 'Explore A', prompt: 'Check A' }) } },
    { type: 'block-start', index: 1, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 1, id: ToolCallId('branch-b'), name: 'subagent',
      argumentsDelta: JSON.stringify({ description: 'Explore B', prompt: 'Check B' }) },
    { type: 'block-end', index: 1, block: { type: 'tool-call', id: ToolCallId('branch-b'), name: 'subagent',
      arguments: JSON.stringify({ description: 'Explore B', prompt: 'Check B' }) } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

describe('Task child Agents', () => {
  it('lets a special-task parent decide to create a child', async () => {
    const { ctx, directory } = await fixture([
      toolCallResponse('branch', 'subagent', { description: 'Explore branch', prompt: 'Check branch' }),
      textResponse('branch complete'), textResponse('parent complete'),
    ], { specialUsesModel: true })
    ctx.tasks.triggerManual(id, request('special-child'), null)
    await expect.poll(() => ctx.tasks.listRuns()[0]?.status, { timeout: 4000 }).toBe('succeeded')
    const run = ctx.tasks.listRuns()[0]!
    expect(run.kind).toBe('manual')
    expect(ctx.tasks.listRuns()).toHaveLength(1)
    const db = new DatabaseSync(join(directory, 'tasks.sqlite'))
    const children = db.prepare('SELECT session_id,state FROM task_children WHERE run_id=?').all(run.id) as
      { session_id: string; state: string }[]
    db.close()
    expect(children).toHaveLength(1)
    expect(children[0]!.state).toBe('complete')
  })

  it.each([
    { kind: 'manual', specialUsesModel: true },
    { kind: 'ordinary', specialUsesModel: false },
  ] as const)('does not create a child when the $kind parent answers directly', async ({ kind, specialUsesModel }) => {
    const { ctx, directory } = await fixture([textResponse('parent complete')], { specialUsesModel })
    ctx.tasks.triggerManual(id, request(`${kind}-direct`), null)
    await expect.poll(() => ctx.tasks.listRuns().find(run => run.kind === kind)?.status, { timeout: 4000 }).toBe('succeeded')
    const run = ctx.tasks.listRuns().find(value => value.kind === kind)!
    const db = new DatabaseSync(join(directory, 'tasks.sqlite'))
    const children = db.prepare('SELECT session_id FROM task_children WHERE run_id=?').all(run.id)
    db.close()
    expect(children).toEqual([])
  })

  it('runs a foreground child under an ordinary Run and retains a read-only child Session', async () => {
    const { ctx, directory } = await fixture([
      toolCallResponse('branch', 'subagent', { description: 'Explore branch', prompt: 'Check branch A' }),
      textResponse('branch A complete'), textResponse('parent complete'),
    ])
    ctx.tasks.triggerManual(id, request('start'), null)
    await expect.poll(() => ctx.tasks.listRuns().find(run => run.kind === 'ordinary')?.status, { timeout: 4000 }).toBe('succeeded')
    const ordinary = ctx.tasks.listRuns().find(run => run.kind === 'ordinary')!
    expect(ordinary.result).toBe('parent complete')
    expect(ctx.tasks.listRuns()).toHaveLength(2)
    const db = new DatabaseSync(join(directory, 'tasks.sqlite'))
    const children = db.prepare('SELECT session_id,state FROM task_children WHERE run_id=?').all(ordinary.id) as
      { session_id: string; state: string }[]
    db.close()
    expect(children).toHaveLength(1)
    expect(children[0]!.state).toBe('complete')
    expect(children[0]!.session_id).not.toBe(ordinary.sessionId)
    const reader = await ctx.sessionPersistence.open(children[0]!.session_id as typeof ordinary.sessionId, 'read')
    expect((await reader.read()).events.some(event => event.type === 'assistant/message')).toBe(true)
    await reader.close()
    await expect(ctx.sessionPersistence.open(children[0]!.session_id as typeof ordinary.sessionId, 'write'))
      .rejects.toThrow('task child Session')
  })

  it('joins parallel branches before completing the owning ordinary Run', async () => {
    const { ctx, directory } = await fixture([
      parallelCalls(), textResponse('branch complete'), textResponse('branch complete'), textResponse('parent complete'),
    ])
    ctx.tasks.triggerManual(id, request('parallel'), null)
    await expect.poll(() => ctx.tasks.listRuns().find(run => run.kind === 'ordinary')?.status, { timeout: 4000 }).toBe('succeeded')
    const ordinary = ctx.tasks.listRuns().find(run => run.kind === 'ordinary')!
    const db = new DatabaseSync(join(directory, 'tasks.sqlite'))
    const children = db.prepare('SELECT session_id,state FROM task_children WHERE run_id=?').all(ordinary.id) as
      { session_id: string; state: string }[]
    db.close()
    expect(children).toHaveLength(2)
    expect(children.map(child => child.state)).toEqual(['complete', 'complete'])
    expect(new Set(children.map(child => child.session_id)).size).toBe(2)
  })

  it('joins a foreground forked child in the owning model turn', async () => {
    const { ctx, directory } = await fixture([
      toolCallResponse('branch', 'subagent_fork', { description: 'Explore branch', prompt: 'Review prior context' }),
      textResponse('forked branch complete'), textResponse('parent complete'),
    ])
    ctx.tasks.triggerManual(id, request('fork'), null)
    await expect.poll(() => ctx.tasks.listRuns().find(run => run.kind === 'ordinary')?.status, { timeout: 4000 }).toBe('succeeded')
    const ordinary = ctx.tasks.listRuns().find(run => run.kind === 'ordinary')!
    const db = new DatabaseSync(join(directory, 'tasks.sqlite'))
    const children = db.prepare('SELECT session_id,state FROM task_children WHERE run_id=?').all(ordinary.id) as
      { session_id: string; state: string }[]
    db.close()
    expect(children).toHaveLength(1)
    expect(children[0]!.state).toBe('complete')
  })

  it('rejects another live child when the Run reaches its configured limit', async () => {
    const { ctx, directory } = await fixture([
      parallelCalls(), textResponse('branch complete'), textResponse('parent complete'),
    ], { childConcurrency: 1 })
    ctx.tasks.triggerManual(id, request('limited'), null)
    await expect.poll(() => ctx.tasks.listRuns().find(run => run.kind === 'ordinary')?.status, { timeout: 4000 }).toBe('succeeded')
    const ordinary = ctx.tasks.listRuns().find(run => run.kind === 'ordinary')!
    const db = new DatabaseSync(join(directory, 'tasks.sqlite'))
    const children = db.prepare('SELECT session_id,state FROM task_children WHERE run_id=?').all(ordinary.id) as
      { session_id: string; state: string }[]
    db.close()
    expect(children).toHaveLength(1)
    expect(children[0]!.state).toBe('complete')
  })

  it('cancels a running child before the ordinary Run completes cleanup', async () => {
    const { ctx, directory } = await fixture([
      toolCallResponse('branch', 'subagent', { description: 'Explore branch', prompt: 'Wait in branch' }),
      'hang',
    ])
    ctx.tasks.triggerManual(id, request('cancel'), null)
    const db = new DatabaseSync(join(directory, 'tasks.sqlite'))
    try {
      await expect.poll(() => {
        const run = ctx.tasks.listRuns().find(value => value.kind === 'ordinary')
        if (run === undefined) return 0
        return (db.prepare("SELECT COUNT(*) AS count FROM task_children WHERE run_id=? AND state='active'").get(run.id) as { count: number }).count
      }, { timeout: 4000 }).toBe(1)
      const ordinary = ctx.tasks.listRuns().find(run => run.kind === 'ordinary')!
      await ctx.tasks.cancel(ordinary.id)
      expect(ctx.tasks.getRun(ordinary.id)?.status).toBe('cancelled')
      const child = db.prepare('SELECT session_id,state FROM task_children WHERE run_id=?').get(ordinary.id) as
        { session_id: string; state: string }
      expect(child.state).toBe('complete')
      expect(ctx.agents.get(child.session_id as typeof ordinary.sessionId)).toBeUndefined()
    } finally { db.close() }
  })

  it('rejects entering an unreserved child and resuming a child inside the owning model turn', async () => {
    const rejected: string[] = []
    const { ctx, directory } = await fixture([toolCallResponse('probe', 'probe', {}), textResponse('parent complete')], {
      probe: async (ctx, agent) => {
        const attempts = [
          () => ctx.agents.enter(stub<Agent>({ id: SessionId('unreserved') }), agent),
          () => ctx.agents.resume({ resumeSessionId: SessionId('resumed'), parentAgent: agent }),
          () => ctx.agents.create({ sessionId: SessionId('failed'), parentAgent: agent, setup: () => { throw new Error('setup failed') } }),
        ]
        for (const attempt of attempts) {
          try { await attempt() } catch (error) { rejected.push((error as Error).message) }
        }
      },
    })
    ctx.tasks.triggerManual(id, request('guards'), null)
    await expect.poll(() => ctx.tasks.listRuns().find(run => run.kind === 'ordinary')?.status, { timeout: 4000 }).toBe('succeeded')
    expect(rejected).toEqual([
      'task child Agent has no durable owner',
      'task child Agents cannot resume outside their foreground operation',
      expect.stringContaining('setup failed'),
    ])
    const db = new DatabaseSync(join(directory, 'tasks.sqlite'))
    const failed = db.prepare('SELECT state FROM task_children WHERE session_id=?').get('failed') as { state: string }
    const events = db.prepare("SELECT event FROM journal WHERE event LIKE 'child.%'").all() as { event: string }[]
    db.close()
    expect(failed.state).toBe('complete')
    expect(events.map(row => row.event)).toContain('child.creation-failed')
  })

  it('rejects child Agents outside an admitted model operation', async () => {
    const { ctx } = await fixture(['hang'])
    ctx.tasks.triggerManual(id, request('outside'), null)
    await expect.poll(() => {
      const run = ctx.tasks.listRuns().find(value => value.kind === 'ordinary')
      return run === undefined ? undefined : ctx.agents.get(run.sessionId)
    }, { timeout: 4000 }).toBeDefined()
    const ordinary = ctx.tasks.listRuns().find(run => run.kind === 'ordinary')!
    const parent = ctx.agents.get(ordinary.sessionId)!
    expect(() => ctx.agents.withInitiator(parent, () => ctx.agents.enter(stub<Agent>({ id: SessionId('outside') }), parent)))
      .toThrow('task child Agents require an admitted model operation')
    await ctx.tasks.cancel(ordinary.id)
  })

  it('checks tool calls made by a child against its owning Run', async () => {
    const callers: string[] = []
    const { ctx } = await fixture([
      toolCallResponse('branch', 'subagent', { description: 'Explore branch', prompt: 'Probe branch' }),
      toolCallResponse('probe', 'probe', {}), textResponse('branch complete'), textResponse('parent complete'),
    ], { probe: async (_ctx, agent) => { callers.push(agent.id) } })
    ctx.tasks.triggerManual(id, request('child-tool'), null)
    await expect.poll(() => ctx.tasks.listRuns().find(run => run.kind === 'ordinary')?.status, { timeout: 4000 }).toBe('succeeded')
    const ordinary = ctx.tasks.listRuns().find(run => run.kind === 'ordinary')!
    expect(callers).toHaveLength(1)
    expect(callers[0]).not.toBe(ordinary.sessionId)
  })

  it('blocks a Run whose child is still active after the parent model turn and blocks its cleanup until the child settles', async () => {
    const { ctx } = await fixture([toolCallResponse('probe', 'probe', {}), textResponse('parent complete')], {
      probe: async (ctx, agent) => { await ctx.agents.create({ sessionId: SessionId('leaked'), parentAgent: agent }) },
    })
    ctx.tasks.triggerManual(id, request('leaked'), null)
    await expect.poll(() => ctx.tasks.listRuns().find(run => run.kind === 'ordinary')?.status, { timeout: 4000 }).toBe('blocked')
    const ordinary = ctx.tasks.listRuns().find(run => run.kind === 'ordinary')!
    expect(ordinary.reason).toBe('task child Agent did not settle before the parent model turn')
    await expect(ctx.tasks.cancel(ordinary.id)).rejects.toThrow('task child Agents must settle before Task cleanup')
    expect(ctx.tasks.getRun(ordinary.id)).toMatchObject({ status: 'blocked', cleanup: 'blocked', terminalAt: null })
  })

  it('exposes earlier children to a retried stage', async () => {
    let attempt = 0
    const { ctx } = await fixture([
      toolCallResponse('branch', 'subagent', { description: 'Explore branch', prompt: 'Check branch' }),
      textResponse('branch complete'), textResponse('parent complete'),
    ], { definition: {
      runOrdinary: async (stage) => {
        if (attempt++ === 0) {
          await stage.model('branches', 'Explore one branch.')
          throw new Error('retry after the branch')
        }
        return { kind: 'succeed', result: stage.children.map(child => child.state) }
      },
      classifyError: (error, run) => ({ kind: 'retry', checkpoint: run.checkpoint, at: Date.now() + 20, reason: String(error) }),
    } })
    ctx.tasks.triggerManual(id, request('retry'), null)
    await expect.poll(() => ctx.tasks.listRuns().find(run => run.kind === 'ordinary')?.status, { timeout: 4000 }).toBe('succeeded')
    expect(ctx.tasks.listRuns().find(run => run.kind === 'ordinary')!.result).toEqual(['complete'])
  })

  it('marks children left unsettled by a previous host as interrupted', async () => {
    const { directory } = await fixture([], { beforeTask: (_ctx, directory) => {
      const db = new TaskDatabase(join(directory, 'tasks.sqlite'))
      db.reserveChild({ sessionId: SessionId('orphan'), runId: brandString<TaskRunId>('orphan-run'), modelKey: 'branches', state: 'active' })
      db.close()
    } })
    const db = new DatabaseSync(join(directory, 'tasks.sqlite'))
    const orphan = db.prepare('SELECT state FROM task_children WHERE session_id=?').get('orphan') as { state: string }
    db.close()
    expect(orphan.state).toBe('interrupted')
  })
})
