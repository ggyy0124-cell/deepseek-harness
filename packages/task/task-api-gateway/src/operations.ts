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
  type taskJsonRoutes,
} from '@deepseek-ai/dsh-task-api-protocol'
import { z } from 'zod'
import { HttpProblem, validate } from './http.ts'
import { projectRetirement, projectDefinition, projectInteractions, projectRun } from './projection.ts'

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
function result(value: TaskCommandResult): unknown {
  switch (value.kind) {
    case 'retirement': return projectRetirement(value.retirement)
    case 'definition':
      return projectDefinition(value.definition)
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
      return result(tasks.command(principal, requestId, { kind: 'retire', definitionId, ...validate(z.object({ revision: revisionSchema }), body) }))
    case 'listDefinitions':
      return { items: tasks.listDefinitions().map(projectDefinition) }
    case 'getDefinition': {
      const definition = tasks.listDefinitions().find(value => value.id === definitionId)
      if (definition === undefined) throw new HttpProblem(404, 'not_found', 'Task definition not found')
      return projectDefinition(definition)
    }
    case 'getRun':
      return projectRun(run())
    case 'listInteractions':
      return {
        items: [
          ...projectInteractions(run()),
          ...tasks.interactions(runId).map(value => ({
            id: value.id,
            revision: value.revision,
            source: value.source,
            title: value.title,
            description: value.description,
            schema: value.schema,
            createdAt: new Date(value.createdAt).toISOString(),
            expiresAt: value.expiresAt === null ? null : new Date(value.expiresAt).toISOString(),
          })),
        ],
      }
    case 'listRuns':
      return listRuns(tasks, query, pageSize)
    case 'configureDefinition': {
      const input = validate(configureSchema, body)
      const { model, ...config } = input.config
      const value: TaskConfig = model === undefined ? config : { ...config, model }
      return result(
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
      return result(tasks.command(principal, requestId, { kind: 'enable', definitionId, ...input }))
    }
    case 'triggerManual':
      return result(
        tasks.command(principal, requestId, {
          kind: 'trigger',
          definitionId,
          ...validate(inputSchema, body),
        }),
      )
    case 'sendInput':
      return result(
        tasks.command(principal, requestId, { kind: 'input', runId, ...validate(inputSchema, body) }),
      )
    case 'respond':
      return result(
        tasks.command(principal, requestId, {
          kind: 'respond',
          runId,
          waitId: brandString<TaskWaitId>(params['waitId'] as string),
          ...validate(responseSchema, body),
        }),
      )
    case 'cancelRun':
      return result(tasks.command(principal, requestId, { kind: 'cancel', runId }))
    /* v8 ignore next -- Operation is derived from the closed protocol route union. */
    default:
      return assertNever(operation)
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
    try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown }
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
    ...(filter.status === undefined ? {} : { status: filter.status }),
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
