/** Validators at configuration and durable JSON ingress. */
import { z } from 'zod'
import { executionConfigSchema } from '@deepseek-ai/dsh-task/schema'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  TaskRetirement, TaskConfig, TaskDefinitionId, TaskDefinitionView, TaskDispatchReceipt, TaskOutcome, TaskRun, TaskRunId, TaskWaitId,
} from '@deepseek-ai/dsh-task'

/** Non-secret configuration shares the pure Task schema with wire validation. */
export const taskConfigSchema: z.ZodType<TaskConfig> = executionConfigSchema
  .transform(({ model, ...rest }) => (model === undefined ? rest : { ...rest, model }))
const formsSchema = z.object({
  version: z.number().int().positive(), business: z.record(z.string(), z.json()), input: z.record(z.string(), z.json()),
  supplement: z.record(z.string(), z.json()).optional(),
}).transform(({ supplement, ...rest }) => (supplement === undefined ? rest : { ...rest, supplement })).optional()
const identity = z.string().min(1)
/** Full durable definition record; brands are applied after field validation. */
export const definitionSchema = z
  .object({
    id: identity,
    title: identity,
    codeVersion: identity,
    revision: z.number().int().positive(),
    enabled: z.boolean(),
    installed: z.boolean(),
    forms: formsSchema,
    config: taskConfigSchema,
    nextDueAt: z.number().nullable(),
    // Records written before scheduler block reasons existed have no reason.
    blockedReason: z.string().nullable().default(null),
  })
  .transform(value => value as TaskDefinitionView)
/** Full durable execution record. */
export const runSchema = z
  .object({
    id: identity,
    sessionId: identity,
    definitionId: identity,
    kind: z.enum(['polling', 'scheduled', 'manual', 'ordinary']),
    parentRunId: identity.nullable(),
    // Records written before restarts existed restarted nothing.
    restartedFrom: identity.nullable().default(null),
    businessKey: identity.nullable(),
    codeVersion: identity,
    configRevision: z.number().int().positive(),
    config: taskConfigSchema,
    forms: formsSchema,
    input: z.json(),
    checkpoint: z.json(),
    revision: z.number().int().nonnegative(),
    inputRevision: z.number().int().nonnegative(),
    status: z.enum([
      'provisioning',
      'queued',
      'running',
      'waiting_input',
      'waiting_retry',
      'blocked',
      'recovering',
      'cancelling',
      'succeeded',
      'failed',
      'cancelled',
    ]),
    wait: z
      .object({
        id: identity,
        revision: z.number().int().nonnegative(),
        prompt: z.json(),
        schema: z.json().optional(),
        expiresAt: z.number().optional(),
        createdAt: z.number().optional(),
      })
      .nullable(),
    retryAt: z.number().nullable(),
    result: z.json(),
    reason: z.string().nullable(),
    // Records written before these fields existed: an ended run's outcome is its status.
    outcome: z.enum(['succeeded', 'failed', 'cancelled']).nullable().optional(),
    occurrence: z.object({
      scheduledAt: z.number(),
      missed: z.object({ from: z.number(), through: z.number(), count: z.number().int().positive() }).nullable(),
    }).nullable().default(null),
    createdAt: z.number(),
    updatedAt: z.number(),
    terminalAt: z.number().nullable(),
    cleanup: z.enum(['pending', 'blocked', 'complete']),
    resources: z.array(identity),
  })
  .transform(({ id, sessionId, definitionId, parentRunId, restartedFrom, forms, wait, outcome, ...rest }): TaskRun => ({
    ...rest,
    ...forms === undefined ? {} : { forms },
    outcome: outcome ?? (rest.terminalAt === null ? null : rest.status as TaskOutcome),
    id: brandString<TaskRunId>(id),
    sessionId: brandString<SessionId>(sessionId),
    definitionId: brandString<TaskDefinitionId>(definitionId),
    parentRunId: parentRunId === null ? null : brandString<TaskRunId>(parentRunId),
    restartedFrom: restartedFrom === null ? null : brandString<TaskRunId>(restartedFrom),
    wait: wait === null ? null : {
      id: brandString<TaskWaitId>(wait.id), revision: wait.revision, prompt: wait.prompt,
      ...wait.schema === undefined ? {} : { schema: wait.schema },
      ...wait.expiresAt === undefined ? {} : { expiresAt: wait.expiresAt },
      ...wait.createdAt === undefined ? {} : { createdAt: wait.createdAt },
    },
  }))

/** Recorded dispatch result replayed for a repeated dispatch request. */
export const dispatchReceiptSchema = z.object({
  outcome: z.enum(['created', 'associated']),
  runId: identity,
  sessionId: identity,
  changed: z.boolean(),
}).transform(({ runId, sessionId, ...rest }): TaskDispatchReceipt => ({
  ...rest, runId: brandString<TaskRunId>(runId), sessionId: brandString<SessionId>(sessionId),
}))

/** Durable retirement identity and lifecycle validation. */
export const retirementRecordSchema = z.object({
  id: z.uuid(), definitionId: z.string().min(1), codeVersion: z.string().min(1),
  state: z.enum(['pending', 'blocked', 'complete']), requestedAt: z.number(), completedAt: z.number().nullable(),
}).transform(value => value as TaskRetirement)
