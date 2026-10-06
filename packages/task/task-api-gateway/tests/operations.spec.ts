/** REST operation projection retains persisted interaction identity and time semantics. */
import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TaskDefinitionId, TaskPrincipalId, TaskRequestId, TaskRun, TaskRunId, TaskService, TaskWaitId } from '@deepseek-ai/dsh-task'
import { executeOperation } from '../src/operations.ts'
import { stub } from '../../task-local/tests/stub.ts'

const runId = brandString<TaskRunId>('interaction-run')
const run: TaskRun = {
  id: runId, sessionId: SessionId('interaction-session'), definitionId: brandString<TaskDefinitionId>('interaction'),
  kind: 'manual', parentRunId: null, businessKey: null, codeVersion: '1', configRevision: 1,
  config: { schedule: { kind: 'manual' }, concurrency: 1, preset: 'task', permissionPreset: 'task', workspacePath: '/', business: null },
  input: null, checkpoint: null, revision: 1, inputRevision: 0, status: 'waiting_input', wait: null,
  retryAt: null, result: null, reason: null, outcome: null, occurrence: null, createdAt: 0, updatedAt: 0, terminalAt: null,
  cleanup: 'pending', resources: [],
}
const principal = brandString<TaskPrincipalId>('principal')
const requestId = brandString<TaskRequestId>('request')

describe('Task REST operations', () => {
  it('projects runtime interactions with nullable and concrete expiry times', () => {
    const getRun = vi.fn(() => run)
    const interactions = vi.fn(() => [
      { id: brandString<TaskWaitId>('approval'), runId, revision: 2, source: 'tool_approval' as const,
        title: 'Approve', description: 'Tool call', schema: { type: 'boolean' }, callId: 'call', questions: null,
        createdAt: 1, expiresAt: null, state: 'waiting' as const, answer: null },
      { id: brandString<TaskWaitId>('question'), runId, revision: 3, source: 'agent_question' as const,
        title: 'Question', description: 'Answer', schema: {}, callId: null, questions: [], createdAt: 2, expiresAt: 3,
        state: 'waiting' as const, answer: null },
    ])
    const tasks = stub<TaskService>({ getRun, interactions })
    const value = executeOperation(
      tasks, 'listInteractions', { runId }, {}, undefined,
      brandString<TaskPrincipalId>('principal'), brandString<TaskRequestId>('request'), 20,
    )
    expect(value).toEqual({ items: [
      expect.objectContaining({ id: 'approval', createdAt: '1970-01-01T00:00:00.001Z', expiresAt: null }),
      expect.objectContaining({ id: 'question', createdAt: '1970-01-01T00:00:00.002Z', expiresAt: '1970-01-01T00:00:00.003Z' }),
    ] })
    expect(getRun).toHaveBeenCalledWith(runId)
    expect(interactions).toHaveBeenCalledWith(runId)
  })

  it('lists the inputs people gave an execution with UTC arrival times and rejects unknown executions', () => {
    const inputs = vi.fn(() => [{ revision: 1, kind: 'response' as const, value: { decision: 'approve' }, at: 1, consumed: true }])
    const getRun = vi.fn<TaskService['getRun']>().mockReturnValueOnce(run).mockReturnValueOnce(undefined)
    const tasks = stub<TaskService>({ getRun, inputs })
    expect(executeOperation(tasks, 'listInputs', { runId }, {}, undefined, principal, requestId, 20)).toEqual({ items: [
      { revision: 1, kind: 'response', value: { decision: 'approve' }, at: '1970-01-01T00:00:00.001Z', consumed: true },
    ] })
    expect(() => executeOperation(tasks, 'listInputs', { runId }, {}, undefined, principal, requestId, 20))
      .toThrow(expect.objectContaining({ status: 404 }))
    expect(inputs).toHaveBeenCalledOnce()
  })

  it('collects business waits from every page and runtime requests across runs in creation order', () => {
    const wait = (id: string, createdAt: number): TaskRun => ({ ...run, id: brandString<TaskRunId>(id),
      wait: { id: brandString<TaskWaitId>(`${id}-wait`), revision: 0, prompt: id, createdAt } })
    const queryRuns = vi.fn<TaskService['queryRuns']>()
      .mockReturnValueOnce({ items: [wait('newest', 30)], head: brandString<TaskRunId>('newest'), hasMore: true })
      .mockReturnValueOnce({ items: [wait('oldest', 10)], head: brandString<TaskRunId>('newest'), hasMore: false })
    const waitingInteractions = vi.fn(() => [{ id: brandString<TaskWaitId>('approval'), runId, revision: 0,
      source: 'tool_approval' as const, title: 'publish', description: '', schema: {}, callId: 'call', questions: null,
      createdAt: 20, expiresAt: null, state: 'waiting' as const, answer: null }])
    const value = executeOperation(stub<TaskService>({ queryRuns, waitingInteractions }), 'listWaitingInteractions', {}, {},
      undefined, principal, requestId, 20) as { items: { id: string }[] }
    expect(value.items.map(item => item.id)).toEqual(['oldest-wait', 'approval', 'newest-wait'])
    expect(queryRuns).toHaveBeenNthCalledWith(1, { limit: 200, status: ['waiting_input'] })
    expect(queryRuns).toHaveBeenNthCalledWith(2, { limit: 200, status: ['waiting_input'], head: 'newest', after: 'newest' })
  })

  it('passes run status lists and dispatch lineage filters to the history query', () => {
    const queryRuns = vi.fn<TaskService['queryRuns']>(() => ({ items: [], head: null, hasMore: false }))
    executeOperation(stub<TaskService>({ queryRuns }), 'listRuns', {},
      { status: 'running,waiting_input', parentRunId: 'parent-run' }, undefined, principal, requestId, 20)
    expect(queryRuns).toHaveBeenCalledWith({ limit: 20, status: ['running', 'waiting_input'], parentRunId: 'parent-run' })
  })

  it('admits a cleanup retry as a cancellation receipt', () => {
    const command = vi.fn<TaskService['command']>(() => ({ kind: 'cancellation', runId, status: 'cancelling' }))
    expect(executeOperation(stub<TaskService>({ command }), 'retryCleanup', { runId }, {}, undefined, principal, requestId, 20))
      .toEqual({ runId, status: 'cancelling' })
    expect(command).toHaveBeenCalledWith(principal, requestId, { kind: 'cleanup', runId })
  })
})
