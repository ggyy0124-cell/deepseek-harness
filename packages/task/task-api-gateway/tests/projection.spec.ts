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
import {
  projectDefinition, projectDiagnostics, projectInteractions, projectRetirement, projectRun, projectRuntimeInteraction,
} from '../src/projection.ts'

const definitionId = brandString<TaskDefinitionId>('projection')
const runId = brandString<TaskRunId>('projection-run')
const config = {
  schedule: { kind: 'manual' as const }, concurrency: 1, preset: 'task', permissionPreset: 'task',
  workspacePath: '/workspace', business: { secret: 'configuration' },
}
const run: TaskRun = {
  id: runId, sessionId: SessionId('projection-session'), definitionId, kind: 'manual', parentRunId: null,
  restartedFrom: null, businessKey: null, codeVersion: '1', configRevision: 2, config, input: { private: 'input' },
  checkpoint: { private: 'checkpoint' }, revision: 3, inputRevision: 1, status: 'waiting_input',
  wait: null, retryAt: null, result: null, reason: null, outcome: null, occurrence: null, createdAt: 0, updatedAt: 1,
  terminalAt: null, cleanup: 'pending', resources: ['private-resource'],
}
const retirement = (state: 'pending' | 'blocked' | 'complete') => ({
  id: brandString<TaskRetirementId>('retirement'), definitionId, codeVersion: '1', state, requestedAt: 6, completedAt: state === 'complete' ? 7 : null,
})

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
    expect(projected).toMatchObject({ outcome: null, occurrence: null, supplementalInputSchema: null, restartedFrom: null })
    expect(projectRun({ ...run, kind: 'ordinary', restartedFrom: brandString<TaskRunId>('stopped-run') }).restartedFrom).toBe('stopped-run')
  })

  it('projects recorded outcomes, schedule instants and captured supplemental input schemas', () => {
    const supplement = { type: 'object', properties: { text: { type: 'string' } } }
    expect(projectRun({ ...run, status: 'blocked', cleanup: 'blocked', outcome: 'succeeded',
      occurrence: { scheduledAt: 8, missed: { from: 2, through: 8, count: 4 } },
      forms: { version: 1, business: {}, input: {}, supplement } })).toMatchObject({
      status: 'blocked', cleanup: 'blocked', outcome: 'succeeded', supplementalInputSchema: supplement,
      occurrence: { scheduledAt: '1970-01-01T00:00:00.008Z',
        missed: { from: '1970-01-01T00:00:00.002Z', through: '1970-01-01T00:00:00.008Z', count: 4 } },
    })
    expect(projectRun({ ...run, occurrence: { scheduledAt: 9, missed: null } }).occurrence)
      .toEqual({ scheduledAt: '1970-01-01T00:00:00.009Z', missed: null })
  })

  it('projects generic and plugin-declared definition forms', () => {
    const manual: TaskDefinitionView = {
      id: definitionId, title: 'Projection', codeVersion: '1', revision: 1, enabled: true, installed: true,
      config, nextDueAt: null, blockedReason: null,
    }
    expect(projectDefinition(manual, undefined)).toMatchObject({
      configSchemaVersion: 0, businessConfigSchema: {}, manualInputSchema: {}, nextDueAt: null,
      availability: 'active', reason: null, supplementalInputSchema: null,
    })
    expect(projectDefinition({
      ...manual,
      config: { ...config, schedule: { kind: 'scheduled', cron: '0 0 * * *', timezone: 'UTC', misfire: 'coalesce', overlap: 'queue' } },
      nextDueAt: 4,
      forms: { version: 7, business: { type: 'object' }, input: { type: 'string' }, supplement: { type: 'string' } },
    }, undefined)).toMatchObject({
      configSchemaVersion: 7, businessConfigSchema: { type: 'object' }, manualInputSchema: null,
      supplementalInputSchema: { type: 'string' }, nextDueAt: '1970-01-01T00:00:00.004Z',
    })
  })

  it.each([
    [{ enabled: false }, undefined, 'paused', null],
    [{ enabled: false, blockedReason: 'schedule evaluation failed (Error)' }, undefined, 'blocked', 'schedule evaluation failed (Error)'],
    [{ installed: false, enabled: false }, retirement('pending'), 'retiring', null],
    [{ installed: false, enabled: false }, retirement('blocked'), 'retirement_blocked', null],
    [{ installed: false, enabled: false }, retirement('complete'), 'retired', null],
    [{ installed: false }, undefined, 'unavailable', null],
    [{}, retirement('complete'), 'active', null],
  ] as const)('derives %j availability with retirement %j', (patch, latest, availability, reason) => {
    const definition: TaskDefinitionView = { id: definitionId, title: 'Projection', codeVersion: '1', revision: 1,
      enabled: true, installed: true, config, nextDueAt: null, blockedReason: null, ...patch }
    expect(projectDefinition(definition, latest)).toMatchObject({ availability, reason })
  })

  it('projects only active business waits and normalizes prompt metadata', () => {
    expect(projectInteractions(run)).toEqual([])
    const waiting: TaskRun = {
      ...run,
      wait: { id: brandString<TaskWaitId>('wait'), revision: 4, prompt: { confirm: true } },
    }
    expect(projectInteractions(waiting)).toEqual([expect.objectContaining({
      runId, title: definitionId, description: '{"confirm":true}', schema: {}, expiresAt: null,
      createdAt: '1970-01-01T00:00:00.001Z', callId: null, questions: null, attachments: [],
    })])
    expect(projectInteractions({
      ...waiting,
      wait: { ...waiting.wait!, prompt: 'Confirm', schema: { type: 'boolean' }, expiresAt: 5 },
    })).toEqual([expect.objectContaining({
      title: 'Confirm', description: '', schema: { type: 'boolean' }, expiresAt: '1970-01-01T00:00:00.005Z',
    })])
    expect(projectInteractions({
      ...waiting,
      wait: { ...waiting.wait!, prompt: { title: 'Approve plan', body: '**Changes** below', attachments: ['plan-diff'] }, createdAt: 9 },
    })).toEqual([expect.objectContaining({
      title: 'Approve plan', description: '**Changes** below', attachments: ['plan-diff'], createdAt: '1970-01-01T00:00:00.009Z',
    })])
    expect(projectInteractions({ ...waiting, wait: { ...waiting.wait!, prompt: { title: 'Title only' } } }))
      .toEqual([expect.objectContaining({ title: 'Title only', description: '', attachments: [] })])
    expect(projectInteractions({ ...waiting, terminalAt: 6 })).toEqual([])
  })

  it('projects runtime approvals with their tool call and questions with their choices', () => {
    const base = { id: brandString<TaskWaitId>('runtime'), runId, revision: 2, title: 'publish', description: 'Push',
      schema: { enum: ['allowed-once', 'rejected'] }, createdAt: 10, expiresAt: null, state: 'waiting' as const, answer: null }
    expect(projectRuntimeInteraction({ ...base, source: 'tool_approval', callId: 'call-7', questions: null }))
      .toMatchObject({ source: 'tool_approval', callId: 'call-7', questions: null, attachments: [], createdAt: '1970-01-01T00:00:00.010Z' })
    const questions = [{ id: 'q', question: 'Scope?', detail: null, header: 'Scope', multiSelect: false,
      options: [{ label: 'Android', description: 'Only Android' }] }]
    expect(projectRuntimeInteraction({ ...base, source: 'agent_question', schema: {}, callId: null, questions, expiresAt: 11 }))
      .toMatchObject({ source: 'agent_question', questions, expiresAt: '1970-01-01T00:00:00.011Z' })
  })

  it('normalizes diagnostic and retirement timestamps', () => {
    const complete = retirement('complete')
    expect(projectRetirement(complete)).toMatchObject({
      requestedAt: '1970-01-01T00:00:00.006Z', completedAt: '1970-01-01T00:00:00.007Z',
    })
    const diagnostics: TaskDiagnostics = {
      scheduler: 'running', concurrency: 2, activePermits: 1, totalRuns: 3, activeRuns: 1,
      completedRuns: 2, queuedRuns: 1, oldestQueuedAt: 8, pendingInputs: 0, recoveryErrors: 0,
      cleanupFailures: 0, outboxPending: 1, oldestOutboxAt: null, resources: [], retirements: [complete],
      storage: null,
    }
    expect(projectDiagnostics(diagnostics)).toMatchObject({
      oldestQueuedAt: '1970-01-01T00:00:00.008Z', oldestOutboxAt: null,
      retirements: [{ completedAt: '1970-01-01T00:00:00.007Z' }],
    })
    expect(projectRetirement({ ...complete, completedAt: null }).completedAt).toBeNull()
  })
})
