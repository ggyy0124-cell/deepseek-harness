/** Foreground child Agents are optional inside any model-driven Task execution. */
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { TaskDefinition, TaskDefinitionId, TaskRequestId } from '@deepseek-ai/dsh-task'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as Fork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { taskHost } from './host-fixture.ts'

const closes: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close() })

const id = brandString<TaskDefinitionId>('child-business')
const request = (value: string) => brandString<TaskRequestId>(value)

async function fixture(script: ConstructorParameters<typeof MockAdapter>[0], childConcurrency = 4, specialUsesModel = false) {
  const host = await taskHost(async (ctx) => {
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
    ], 4, true)
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
    const { ctx, directory } = await fixture([textResponse('parent complete')], 4, specialUsesModel)
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
    ], 1)
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
})
