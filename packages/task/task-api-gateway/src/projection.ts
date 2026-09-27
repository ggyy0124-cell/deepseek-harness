/** Explicit Task DTO projection; private run fields never cross the HTTP API. */
import type { TaskDefinitionView, TaskRun } from '@deepseek-ai/dsh-task'
import { definitionSchema, interactionSchema, runSchema, diagnosticsSchema, retirementSchema } from '@deepseek-ai/dsh-task-api-protocol'
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
    businessKey: run.businessKey,
    codeVersion: run.codeVersion,
    configRevision: run.configRevision,
    revision: run.revision,
    status: run.status,
    reason: run.reason,
    cleanup: run.cleanup,
    result: run.result,
    createdAt: time(run.createdAt),
    updatedAt: time(run.updatedAt),
    terminalAt: time(run.terminalAt),
    retryAt: time(run.retryAt),
  })
}
/** Expose the existing JSON configuration as schema version zero.
 * @param definition - installed or retained definition.
 * @returns the generic configuration DTO; schema zero does not claim plugin-declared form validation.
 */
export function projectDefinition(definition: TaskDefinitionView): z.infer<typeof definitionSchema> {
  return definitionSchema.strict().parse({
    id: definition.id,
    title: definition.title,
    codeVersion: definition.codeVersion,
    revision: definition.revision,
    installed: definition.installed,
    enabled: definition.enabled,
    config: definition.config,
    nextDueAt: time(definition.nextDueAt),
    configSchemaVersion: definition.forms?.version ?? 0,
    businessConfigSchema: definition.forms?.business ?? {},
    manualInputSchema: definition.config.schedule.kind === 'manual' ? (definition.forms?.input ?? {}) : null,
  })
}
/** Project the engine's persisted business wait; Agent approvals require a separate adapter.
 * @param run - execution with an optional business wait.
 * @returns zero or one version-bound business interaction.
 */
export function projectInteractions(run: TaskRun): z.infer<typeof interactionSchema>[] {
  if (run.wait === null || run.terminalAt !== null) return []
  return [
    interactionSchema.strict().parse({
      id: run.wait.id,
      revision: run.wait.revision,
      source: 'business',
      title: typeof run.wait.prompt === 'string' ? run.wait.prompt : run.definitionId,
      description: typeof run.wait.prompt === 'string' ? '' : JSON.stringify(run.wait.prompt),
      schema: run.wait.schema ?? {},
      createdAt: time(run.updatedAt),
      expiresAt: time(run.wait.expiresAt ?? null),
    }),
  ]
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
