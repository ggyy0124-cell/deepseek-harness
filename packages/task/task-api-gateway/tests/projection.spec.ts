/** Public Task projections omit private execution state and normalize optional fields. */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  TaskDefinitionId,
  TaskDefinitionView,
  TaskDiagnostics,
  TaskRetirementId,
  TaskRun,
  TaskRunId,
  TaskWaitId,
} from '@deepseek-ai/dsh-task'
import { projectDefinition, projectDiagnostics, projectInteractions, projectRetirement, projectRun } from '../src/projection.ts'

const definitionId = brandString<TaskDefinitionId>('projection')
const runId = brandString<TaskRunId>('projection-run')
const config = {
  schedule: { kind: 'manual' as const }, concurrency: 1, preset: 'task', permissionPreset: 'task',
  workspacePath: '/workspace', business: { secret: 'configuration' },
}
const run: TaskRun = {
  id: runId, sessionId: SessionId('projection-session'), definitionId, kind: 'manual', parentRunId: null,
  businessKey: null, codeVersion: '1', configRevision: 2, config, input: { private: 'input' },
  checkpoint: { private: 'checkpoint' }, revision: 3, inputRevision: 1, status: 'waiting_input',
  wait: null, retryAt: null, result: null, reason: null, createdAt: 0, updatedAt: 1,
  terminalAt: null, cleanup: 'pending', resources: ['private-resource'],
}

describe('Task API projections', () => {
  it('projects nullable run times without private execution fields', () => {
    const projected = projectRun(run)
    expect(projected).toMatchObject({
      id: runId, createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.001Z',
      terminalAt: null, retryAt: null,
    })
    expect(projected).not.toHaveProperty('input')
    expect(projected).not.toHaveProperty('checkpoint')
    expect(projected).not.toHaveProperty('config')
    expect(projected).not.toHaveProperty('resources')
    expect(projectRun({ ...run, terminalAt: 2, retryAt: 3 })).toMatchObject({
      terminalAt: '1970-01-01T00:00:00.002Z', retryAt: '1970-01-01T00:00:00.003Z',
    })
  })

  it('projects generic and plugin-declared definition forms', () => {
    const manual: TaskDefinitionView = {
      id: definitionId, title: 'Projection', codeVersion: '1', revision: 1, enabled: true, installed: true,
      config, nextDueAt: null,
    }
    expect(projectDefinition(manual)).toMatchObject({
      configSchemaVersion: 0, businessConfigSchema: {}, manualInputSchema: {}, nextDueAt: null,
    })
    expect(projectDefinition({
      ...manual,
      config: { ...config, schedule: { kind: 'scheduled', cron: '0 0 * * *', timezone: 'UTC', misfire: 'coalesce', overlap: 'queue' } },
      nextDueAt: 4,
      forms: { version: 7, business: { type: 'object' }, input: { type: 'string' } },
    })).toMatchObject({
      configSchemaVersion: 7, businessConfigSchema: { type: 'object' }, manualInputSchema: null,
      nextDueAt: '1970-01-01T00:00:00.004Z',
    })
  })

  it('projects only active business waits and normalizes prompt metadata', () => {
    expect(projectInteractions(run)).toEqual([])
    const waiting: TaskRun = {
      ...run,
      wait: { id: brandString<TaskWaitId>('wait'), revision: 4, prompt: { confirm: true } },
    }
    expect(projectInteractions(waiting)).toEqual([expect.objectContaining({
      title: definitionId, description: '{"confirm":true}', schema: {}, expiresAt: null,
      createdAt: '1970-01-01T00:00:00.001Z',
    })])
    expect(projectInteractions({
      ...waiting,
      wait: { ...waiting.wait!, prompt: 'Confirm', schema: { type: 'boolean' }, expiresAt: 5 },
    })).toEqual([expect.objectContaining({
      title: 'Confirm', description: '', schema: { type: 'boolean' }, expiresAt: '1970-01-01T00:00:00.005Z',
    })])
    expect(projectInteractions({ ...waiting, terminalAt: 6 })).toEqual([])
  })

  it('normalizes diagnostic and retirement timestamps', () => {
    const retirement = {
      id: brandString<TaskRetirementId>('retirement'), definitionId, codeVersion: '1' as const,
      state: 'complete' as const, requestedAt: 6, completedAt: 7,
    }
    expect(projectRetirement(retirement)).toMatchObject({
      requestedAt: '1970-01-01T00:00:00.006Z', completedAt: '1970-01-01T00:00:00.007Z',
    })
    const diagnostics: TaskDiagnostics = {
      scheduler: 'running', concurrency: 2, activePermits: 1, totalRuns: 3, activeRuns: 1,
      completedRuns: 2, queuedRuns: 1, oldestQueuedAt: 8, pendingInputs: 0, recoveryErrors: 0,
      cleanupFailures: 0, outboxPending: 1, oldestOutboxAt: null, resources: [], retirements: [retirement],
      storage: null,
    }
    expect(projectDiagnostics(diagnostics)).toMatchObject({
      oldestQueuedAt: '1970-01-01T00:00:00.008Z', oldestOutboxAt: null,
      retirements: [{ completedAt: '1970-01-01T00:00:00.007Z' }],
    })
    expect(projectRetirement({ ...retirement, completedAt: null }).completedAt).toBeNull()
  })
})
