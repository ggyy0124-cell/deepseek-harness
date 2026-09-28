/** HTTP route declarations shared by dispatch validation and OpenAPI generation. */
import { z } from 'zod'
import {
  retirementSchema,
  revisionSchema,
  diagnosticsSchema,
  configSchema,
  transcriptPageSchema,
  pageQuerySchema,
  cancellationSchema,
  configureSchema,
  definitionsSchema,
  definitionSchema,
  enableSchema,
  idSchema,
  inputSchema,
  interactionSchema,
  responseSchema,
  runSchema,
  runsPageSchema,
  runsQuerySchema,
} from './schemas.ts'

/** One versioned JSON operation; streaming and multipart operations have separate carriers. */
export interface TaskJsonRoute {
  readonly operationId: string
  readonly method: 'get' | 'post' | 'put'
  readonly path: string
  readonly params?: z.ZodType
  readonly query?: z.ZodType
  readonly body?: z.ZodType
  readonly response: z.ZodType
  readonly status: number
}
const definitionParams = z.strictObject({ definitionId: idSchema })
const runParams = z.strictObject({ runId: idSchema })
/** Versioned JSON resource operations. Write operations require an Idempotency-Key header. */
export const taskJsonRoutes = [
  { operationId: 'getRetirement', method: 'get', path: '/definitions/{definitionId}/retirement', params: definitionParams, response: retirementSchema, status: 200 },
  { operationId: 'retireDefinition', method: 'post', path: '/definitions/{definitionId}/retirement', params: definitionParams,
    body: z.strictObject({ revision: revisionSchema }), response: retirementSchema, status: 202 },
  { operationId: 'getDiagnostics', method: 'get', path: '/diagnostics', response: diagnosticsSchema, status: 200 },
  {
    operationId: 'getCatalog',
    method: 'get',
    path: '/catalog',
    response: z.object({
      models: z.array(z.object({ provider: z.string(), model: z.string(), title: z.string() })),
      presets: z.array(z.object({ id: z.string(), title: z.string() })),
      permissions: z.array(z.object({ id: z.string(), title: z.string() })),
    }),
    status: 200,
  },
  {
    operationId: 'checkConfig',
    method: 'post',
    path: '/definitions/{definitionId}/config/check',
    params: definitionParams,
    body: z.strictObject({ config: configSchema }),
    response: z.object({ messages: z.array(z.string()) }),
    status: 200,
  },
  {
    operationId: 'getOptions',
    method: 'post',
    path: '/definitions/{definitionId}/config/options',
    params: definitionParams,
    body: z.strictObject({ field: z.string().min(1).max(256), config: configSchema }),
    response: z.object({ items: z.array(z.object({ value: z.json(), label: z.string() })) }),
    status: 200,
  },
  {
    operationId: 'listDefinitions',
    method: 'get',
    path: '/definitions',
    response: definitionsSchema,
    status: 200,
  },
  {
    operationId: 'getDefinition',
    method: 'get',
    path: '/definitions/{definitionId}',
    params: definitionParams,
    response: definitionSchema,
    status: 200,
  },
  {
    operationId: 'configureDefinition',
    method: 'put',
    path: '/definitions/{definitionId}/config',
    params: definitionParams,
    body: configureSchema,
    response: definitionSchema,
    status: 200,
  },
  {
    operationId: 'enableDefinition',
    method: 'put',
    path: '/definitions/{definitionId}/enabled',
    params: definitionParams,
    body: enableSchema,
    response: definitionSchema,
    status: 200,
  },
  {
    operationId: 'triggerManual',
    method: 'post',
    path: '/definitions/{definitionId}/runs',
    params: definitionParams,
    body: inputSchema,
    response: runSchema,
    status: 201,
  },
  {
    operationId: 'listRuns',
    method: 'get',
    path: '/runs',
    query: runsQuerySchema,
    response: runsPageSchema,
    status: 200,
  },
  {
    operationId: 'getRun',
    method: 'get',
    path: '/runs/{runId}',
    params: runParams,
    response: runSchema,
    status: 200,
  },
  {
    operationId: 'getTranscript',
    method: 'get',
    path: '/runs/{runId}/transcript',
    params: runParams,
    query: pageQuerySchema,
    response: transcriptPageSchema,
    status: 200,
  },
  {
    operationId: 'sendInput',
    method: 'post',
    path: '/runs/{runId}/inputs',
    params: runParams,
    body: inputSchema,
    response: runSchema,
    status: 200,
  },
  {
    operationId: 'listInteractions',
    method: 'get',
    path: '/runs/{runId}/interactions',
    params: runParams,
    response: z.strictObject({ items: z.array(interactionSchema) }),
    status: 200,
  },
  {
    operationId: 'respond',
    method: 'post',
    path: '/runs/{runId}/interactions/{waitId}/responses',
    params: z.strictObject({ runId: idSchema, waitId: idSchema }),
    body: responseSchema,
    response: runSchema,
    status: 200,
  },
  {
    operationId: 'cancelRun',
    method: 'post',
    path: '/runs/{runId}/cancellation',
    params: runParams,
    response: cancellationSchema,
    status: 202,
  },
] as const satisfies readonly TaskJsonRoute[]
