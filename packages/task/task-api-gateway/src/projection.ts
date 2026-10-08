/** Explicit Task DTO projection; private run fields never cross the HTTP API. */
import type { TaskDefinitionView, TaskInputRecord, TaskInteraction, TaskRetirement, TaskRun } from '@deepseek-ai/dsh-task'
import { waitContentSchema } from '@deepseek-ai/dsh-task/schema'
import {
  availabilitySchema, definitionSchema, interactionSchema, runInputSchema, runSchema, diagnosticsSchema, retirementSchema,
} from '@deepseek-ai/dsh-task-api-protocol'
import type { z } from 'zod'

function time(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}
/** Project an execution without its input, checkpoint, config, or operation receipts.
 * @param run - durable execution.
 * @returns validated public fields.
 */
export function projectRun(run: TaskRun): z.infer<typeof runSchema> {
  return runSchema.strict().parse({
    id: run.id,
    sessionId: run.sessionId,
    definitionId: run.definitionId,
    kind: run.kind,
    parentRunId: run.parentRunId,
    restartedFrom: run.restartedFrom,
    businessKey: run.businessKey,
    codeVersion: run.codeVersion,
    configRevision: run.configRevision,
    revision: run.revision,
    status: run.status,
    reason: run.reason,
    outcome: run.outcome,
    occurrence: run.occurrence === null ? null : {
      scheduledAt: time(run.occurrence.scheduledAt),
      missed: run.occurrence.missed === null ? null : {
        from: time(run.occurrence.missed.from), through: time(run.occurrence.missed.through), count: run.occurrence.missed.count,
      },
    },
    cleanup: run.cleanup,
    result: run.result,
    createdAt: time(run.createdAt),
    updatedAt: time(run.updatedAt),
    terminalAt: time(run.terminalAt),
    retryAt: time(run.retryAt),
    supplementalInputSchema: run.forms?.supplement ?? null,
  })
}
/** Expose one input a person gave the execution.
 * @param value - durable input record.
 * @returns validated public fields with a UTC arrival time.
 */
export function projectInput(value: TaskInputRecord): z.infer<typeof runInputSchema> {
  return runInputSchema.parse({ ...value, at: new Date(value.at).toISOString() })
}
/** Derive a definition's admission state from its record and latest retirement.
 * @param definition - installed or retained definition.
 * @param retirement - latest retirement of the definition, if one was requested.
 * @returns the public availability value.
 */
function availability(definition: TaskDefinitionView, retirement: TaskRetirement | undefined): z.infer<typeof availabilitySchema> {
  if (retirement?.state === 'pending') return 'retiring'
  if (retirement?.state === 'blocked') return 'retirement_blocked'
  if (!definition.installed) return retirement === undefined ? 'unavailable' : 'retired'
  if (definition.enabled) return 'active'
  return definition.blockedReason === null ? 'paused' : 'blocked'
}
/** Expose a definition; one without declared forms uses schema version zero and a generic JSON editor.
 * @param definition - installed or retained definition.
 * @param retirement - latest retirement of the definition, if one was requested.
 * @returns the generic configuration DTO; schema zero does not claim plugin-declared form validation.
 */
export function projectDefinition(
  definition: TaskDefinitionView,
  retirement: TaskRetirement | undefined,
): z.infer<typeof definitionSchema> {
  return definitionSchema.strict().parse({
    id: definition.id,
    title: definition.title,
    codeVersion: definition.codeVersion,
    revision: definition.revision,
    installed: definition.installed,
    enabled: definition.enabled,
    availability: availability(definition, retirement),
    reason: definition.blockedReason,
    config: definition.config,
    nextDueAt: time(definition.nextDueAt),
    configSchemaVersion: definition.forms?.version ?? 0,
    businessConfigSchema: definition.forms?.business ?? {},
    manualInputSchema: definition.config.schedule.kind === 'manual' ? (definition.forms?.input ?? {}) : null,
    supplementalInputSchema: definition.forms?.supplement ?? null,
  })
}
/** Project the engine's persisted business wait; runtime approvals use {@link projectRuntimeInteraction}.
 * @param run - execution with an optional business wait.
 * @returns zero or one version-bound business interaction; structured content supplies its body and attachments.
 */
export function projectInteractions(run: TaskRun): z.infer<typeof interactionSchema>[] {
  if (run.wait === null || run.terminalAt !== null) return []
  const prompt = run.wait.prompt
  const parsed = waitContentSchema.safeParse(prompt)
  const content = typeof prompt === 'string' ? { title: prompt } : parsed.success ? parsed.data : null
  return [
    interactionSchema.strict().parse({
      id: run.wait.id,
      runId: run.id,
      revision: run.wait.revision,
      source: 'business',
      title: content?.title ?? run.definitionId,
      description: content === null ? JSON.stringify(prompt) : content.body ?? '',
      schema: run.wait.schema ?? {},
      callId: null,
      questions: null,
      attachments: content?.attachments ?? [],
      createdAt: time(run.wait.createdAt ?? run.updatedAt),
      expiresAt: time(run.wait.expiresAt ?? null),
    }),
  ]
}
/** Project one waiting tool approval or Agent question.
 * @param value - persisted runtime request.
 * @returns version-bound interaction carrying its tool call or structured questions.
 */
export function projectRuntimeInteraction(value: TaskInteraction): z.infer<typeof interactionSchema> {
  return interactionSchema.strict().parse({
    id: value.id,
    runId: value.runId,
    revision: value.revision,
    source: value.source,
    title: value.title,
    description: value.description,
    schema: value.schema,
    callId: value.callId,
    questions: value.questions,
    attachments: [],
    createdAt: time(value.createdAt),
    expiresAt: time(value.expiresAt),
  })
}

/** Convert diagnostic timestamps while retaining explicit unavailable storage.
 * @param value - provider observations.
 * @returns public diagnostics with UTC times.
 */
export function projectDiagnostics(value: import('@deepseek-ai/dsh-task').TaskDiagnostics): z.infer<typeof diagnosticsSchema> {
  return diagnosticsSchema.parse({ ...value, oldestQueuedAt: time(value.oldestQueuedAt), oldestOutboxAt: time(value.oldestOutboxAt),
    retirements: value.retirements.map(projectRetirement) })
}

/** Convert retirement lifecycle times to the public UTC representation.
 * @param value - durable retirement intent or completion.
 * @returns public lifecycle evidence.
 */
export function projectRetirement(value: import('@deepseek-ai/dsh-task').TaskRetirement): z.infer<typeof retirementSchema> {
  return retirementSchema.parse({ ...value, requestedAt: new Date(value.requestedAt).toISOString(), completedAt: time(value.completedAt) })
}
