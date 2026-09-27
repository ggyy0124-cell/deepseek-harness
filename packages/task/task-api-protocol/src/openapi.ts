/** OpenAPI generation from the executable JSON route declarations. */
import { z } from 'zod'
import { addTransportOperations } from './transport.ts'
import { problemSchema } from './schemas.ts'
import { taskJsonRoutes, type TaskJsonRoute } from './routes.ts'

/** Generate the version 1 JSON API document; duplicate operations fail before publication.
 * @param routes - operations actually mounted by the JSON dispatcher.
 * @returns an OpenAPI 3.1 document with bearer and browser-session authentication.
 */
export function createTaskOpenApi(
  routes: readonly TaskJsonRoute[] = taskJsonRoutes,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  const ids = new Set<string>()
  for (const route of routes) {
    const path = (paths[route.path] ??= {})
    if (ids.has(route.operationId) || path[route.method] !== undefined)
      throw new Error('Duplicate Task API operation')
    ids.add(route.operationId)
    const parameters: Record<string, unknown>[] = []
    for (const [location, schema] of [
      ['path', route.params],
      ['query', route.query],
    ] as const) {
      if (schema === undefined) continue
      const json = z.toJSONSchema(schema)
      for (const [name, value] of Object.entries(json.properties ?? {})) {
        parameters.push({
          name,
          in: location,
          required: location === 'path' || json.required?.includes(name) === true,
          schema: value,
        })
      }
    }
    if (route.method !== 'get') {
      parameters.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', minLength: 1, maxLength: 256 },
      })
      parameters.push({
        name: 'X-CSRF-Token',
        in: 'header',
        required: false,
        description: 'Required for browser cookie authentication.',
        schema: { type: 'string' },
      })
    }
    path[route.method] = {
      operationId: route.operationId,
      security: [{ bearerAuth: [] }, { browserSession: [] }],
      parameters,
      ...(route.body === undefined
        ? {}
        : {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: z.toJSONSchema(route.body) } },
          },
        }),
      responses: {
        [route.status]: {
          description: 'Accepted resource result',
          content: { 'application/json': { schema: z.toJSONSchema(route.response) } },
        },
        default: {
          description: 'Task API failure',
          content: { 'application/problem+json': { schema: z.toJSONSchema(problemSchema) } },
        },
      },
    }
  }
  return addTransportOperations({
    openapi: '3.1.0',
    info: { title: 'DSH Task JSON API', version: '1.0.0' },
    servers: [{ url: '/api/task/v1' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        browserSession: { type: 'apiKey', in: 'cookie', name: 'dsh_task_session' },
      },
    },
  })
}
