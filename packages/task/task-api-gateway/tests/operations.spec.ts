/** REST operation projection retains persisted interaction identity and time semantics. */
import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TaskDefinitionId, TaskPrincipalId, TaskRequestId, TaskRun, TaskRunId, TaskService, TaskWaitId } from '@deepseek-ai/dsh-task'
import { executeOperation } from '../src/operations.ts'

const runId = brandString<TaskRunId>('interaction-run')
const run: TaskRun = {
  id: runId, sessionId: SessionId('interaction-session'), definitionId: brandString<TaskDefinitionId>('interaction'),
  kind: 'manual', parentRunId: null, businessKey: null, codeVersion: '1', configRevision: 1,
  config: { schedule: { kind: 'manual' }, concurrency: 1, preset: 'task', permissionPreset: 'task', workspacePath: '/', business: null },
  input: null, checkpoint: null, revision: 1, inputRevision: 0, status: 'waiting_input', wait: null,
  retryAt: null, result: null, reason: null, createdAt: 0, updatedAt: 0, terminalAt: null,
  cleanup: 'pending', resources: [],
}

describe('Task REST operations', () => {
  it('projects runtime interactions with nullable and concrete expiry times', () => {
    const getRun = vi.fn(() => run)
    const interactions = vi.fn(() => [
      { id: brandString<TaskWaitId>('approval'), runId, revision: 2, source: 'tool_approval' as const,
        title: 'Approve', description: 'Tool call', schema: { type: 'boolean' }, createdAt: 1, expiresAt: null,
        state: 'waiting' as const, answer: null },
      { id: brandString<TaskWaitId>('question'), runId, revision: 3, source: 'agent_question' as const,
        title: 'Question', description: 'Answer', schema: {}, createdAt: 2, expiresAt: 3,
        state: 'waiting' as const, answer: null },
    ])
    const tasks = { getRun, interactions } as unknown as TaskService
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
})
