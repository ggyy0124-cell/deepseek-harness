/** Public REST operations over the transactional Task service. */
import { createHash } from 'node:crypto'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  TaskCommandResult,
  TaskConfig,
  TaskDefinitionId,
  TaskPrincipalId,
  TaskRequestId,
  TaskRun,
  TaskRunId,
  TaskService,
  TaskWaitId,
} from '@deepseek-ai/dsh-task'
import {
  revisionSchema,
  configureSchema,
  enableSchema,
  inputSchema,
  responseSchema,
  runsQuerySchema,
  statusSchema,
  type taskJsonRoutes,
} from '@deepseek-ai/dsh-task-api-protocol'
import { z } from 'zod'
import { HttpProblem, validate } from './http.ts'
import { projectInput, projectRetirement, projectDefinition, projectInteractions, projectRun, projectRuntimeInteraction } from './projection.ts'

type Operation = Exclude<
  (typeof taskJsonRoutes)[number]['operationId'],
  'getDiagnostics' | 'getTranscript' | 'checkConfig' | 'getOptions' | 'getCatalog'
>
const cursorSchema = z.strictObject({
  version: z.literal(1),
  head: z.string(),
  after: z.string(),
  filter: z.string(),
})
function result(tasks: TaskService, value: TaskCommandResult): unknown {
  switch (value.kind) {
    case 'retirement': return projectRetirement(value.retirement)
    case 'definition':
      return projectDefinition(value.definition, tasks.getRetirement(value.definition.id))
    case 'run':
      return projectRun(value.run)
    case 'cancellation':
      return { runId: value.runId, status: value.status }
    /* v8 ignore next -- TaskCommandResult is a closed same-process union. */
    default:
      return assertNever(value)
  }
}
/** Execute a validated route and return only its public projection.
 * @param tasks - Task service for the current profile.
 * @param operation - matched operation.
 * @param params - validated path parameters.
 * @param query - validated query fields.
 * @param body - validated body.
 * @param principal - authenticated owner.
 * @param requestId - write retry identity; unused by reads.
 * @param pageSize - configured page size when omitted by the client.
 * @returns operation response before final protocol validation.
 */
export function executeOperation(
  tasks: TaskService,
  operation: Operation,
  params: Record<string, string>,
  query: Record<string, string>,
  body: unknown,
  principal: TaskPrincipalId,
  requestId: TaskRequestId,
  pageSize: number,
): unknown {
  const definitionId = brandString<TaskDefinitionId>(params['definitionId'] ?? '')
  const runId = brandString<TaskRunId>(params['runId'] ?? '')
  const run = () => {
    const value = tasks.getRun(runId)
    if (value === undefined) throw new HttpProblem(404, 'not_found', 'Task execution not found')
    return value
  }
  switch (operation) {
    case 'getRetirement': {
      const value = tasks.getRetirement(definitionId)
      if (value === undefined) throw new HttpProblem(404, 'not_found', 'Task retirement not found')
      return projectRetirement(value)
    }
    case 'retireDefinition':
      return result(tasks, tasks.command(principal, requestId, { kind: 'retire', definitionId, ...validate(z.object({ revision: revisionSchema }), body) }))
    case 'listDefinitions':
      return { items: tasks.listDefinitions().map(value => projectDefinition(value, tasks.getRetirement(value.id))) }
    case 'getDefinition': {
      const definition = tasks.listDefinitions().find(value => value.id === definitionId)
      if (definition === undefined) throw new HttpProblem(404, 'not_found', 'Task definition not found')
      return projectDefinition(definition, tasks.getRetirement(definition.id))
    }
    case 'getRun':
      return projectRun(run())
    case 'listInputs':
      run()
      return { items: tasks.inputs(runId).map(projectInput) }
    case 'listInteractions':
      return { items: [...projectInteractions(run()), ...tasks.interactions(runId).map(projectRuntimeInteraction)] }
    case 'listWaitingInteractions': {
      const items = [...waitingRuns(tasks).flatMap(projectInteractions), ...tasks.waitingInteractions().map(projectRuntimeInteraction)]
      return { items: items.sort((left, right) => left.createdAt.localeCompare(right.createdAt)) }
    }
    case 'listRuns':
      return listRuns(tasks, query, pageSize)
    case 'configureDefinition': {
      const input = validate(configureSchema, body)
      const { model, ...config } = input.config
      const value: TaskConfig = model === undefined ? config : { ...config, model }
      return result(
        tasks,
        tasks.command(principal, requestId, {
          kind: 'configure',
          definitionId,
          revision: input.revision,
          config: value,
          configSchemaVersion: input.configSchemaVersion,
        }),
      )
    }
    case 'enableDefinition': {
      const input = validate(enableSchema, body)
      return result(tasks, tasks.command(principal, requestId, { kind: 'enable', definitionId, ...input }))
    }
    case 'triggerManual':
      return result(
        tasks,
        tasks.command(principal, requestId, {
          kind: 'trigger',
          definitionId,
          ...validate(inputSchema, body),
        }),
      )
    case 'sendInput':
      return result(
        tasks,
        tasks.command(principal, requestId, { kind: 'input', runId, ...validate(inputSchema, body) }),
      )
    case 'respond':
      return result(
        tasks,
        tasks.command(principal, requestId, {
          kind: 'respond',
          runId,
          waitId: brandString<TaskWaitId>(params['waitId'] as string),
          ...validate(responseSchema, body),
        }),
      )
    case 'cancelRun':
      return result(tasks, tasks.command(principal, requestId, { kind: 'cancel', runId }))
    case 'retryCleanup':
      return result(tasks, tasks.command(principal, requestId, { kind: 'cleanup', runId }))
    case 'restartRun':
      return result(tasks, tasks.command(principal, requestId, { kind: 'restart', runId }))
    /* v8 ignore next -- Operation is derived from the closed protocol route union. */
    default:
      return assertNever(operation)
  }
}
/** Read every run waiting for a business reply, across bounded history pages pinned to one head.
 * @param tasks - Task service for the current profile.
 * @returns waiting runs, newest first.
 */
function waitingRuns(tasks: TaskService): TaskRun[] {
  const runs: TaskRun[] = []
  let anchor: { head: TaskRunId; after: TaskRunId } | undefined
  for (;;) {
    const page = tasks.queryRuns({ limit: 200, status: ['waiting_input'], ...anchor })
    runs.push(...page.items)
    const last = page.items.at(-1)
    if (!page.hasMore || page.head === null || last === undefined) return runs
    anchor = { head: page.head, after: last.id }
  }
}
function listRuns(tasks: TaskService, raw: Record<string, string>, pageSize: number): unknown {
  const { cursor, limit, ...filter } = validate(runsQuerySchema, raw)
  if (
    filter.createdFrom !== undefined &&
    filter.createdTo !== undefined &&
    filter.createdFrom > filter.createdTo
  ) {
    throw new HttpProblem(400, 'invalid_interval', 'Creation interval is reversed')
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(filter)).digest('base64url')
  let head: TaskRunId | undefined
  let after: TaskRunId | undefined
  if (cursor !== undefined) {
    let value: unknown
    try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) }
    catch { throw new HttpProblem(400, 'invalid_cursor', 'Invalid Task page cursor') }
    const page = validate(cursorSchema, value)
    head = brandString<TaskRunId>(page.head)
    after = brandString<TaskRunId>(page.after)
    if (tasks.getRun(head) === undefined || page.filter !== fingerprint)
      throw new HttpProblem(400, 'invalid_cursor', 'Task cursor does not match this query')
  }
  const size = limit === undefined ? pageSize : Number(limit)
  const page = tasks.queryRuns({ limit: size,
    ...(head === undefined ? {} : { head }), ...(after === undefined ? {} : { after }),
    ...(filter.definitionId === undefined ? {} : { definitionId: brandString<TaskDefinitionId>(filter.definitionId) }),
    ...(filter.status === undefined ? {} : { status: statusSchema.array().parse(filter.status.split(',')) }),
    ...(filter.parentRunId === undefined ? {} : { parentRunId: brandString<TaskRunId>(filter.parentRunId) }),
    ...(filter.kind === undefined ? {} : { kind: filter.kind }),
    ...(filter.businessKey === undefined ? {} : { businessKey: filter.businessKey }),
    ...(filter.createdFrom === undefined ? {} : { createdFrom: Date.parse(filter.createdFrom) }),
    ...(filter.createdTo === undefined ? {} : { createdTo: Date.parse(filter.createdTo) }),
  })
  const selected = page.items
  const last = selected.at(-1)
  return {
    items: selected.map(projectRun),
    nextCursor:
      page.hasMore && last !== undefined
        ? Buffer.from(JSON.stringify({ version: 1, head: page.head, after: last.id, filter: fingerprint })).toString(
          'base64url',
        )
        : null,
  }
}
