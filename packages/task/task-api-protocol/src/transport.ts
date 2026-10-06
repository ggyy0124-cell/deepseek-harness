/** Transport operations that use cookies, event streams or multipart bodies instead of JSON commands. */
import { z } from 'zod'
import { credentialReferencePattern } from '@deepseek-ai/dsh-task/schema'
import {
  idSchema,
  attachmentSchema,
  browserSessionSchema,
  credentialListSchema,
  sessionStreamEventSchema,
  taskCursorSchema,
  taskStreamEventSchema,
} from './schemas.ts'
const exchangeSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
/** Extend the generated JSON API document with the gateway's transport operations.
 * @param document - owned mutable OpenAPI document.
 * @returns the same document with authentication, streaming, files and maintenance reads.
 */
export function addTransportOperations(document: Record<string, unknown>): Record<string, unknown> {
  const paths = document['paths'] as Record<string, unknown>
  paths['/auth/exchange'] = {
    post: {
      operationId: 'exchangeBrowserSession',
      security: [],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: z.toJSONSchema(exchangeSchema) } },
      },
      responses: {
        '200': {
          description: 'Signed HttpOnly cookie, CSRF token and session expiry',
          content: { 'application/json': { schema: z.toJSONSchema(browserSessionSchema) } },
        },
      },
    },
  }
  paths['/auth/session'] = {
    get: {
      operationId: 'getBrowserSession',
      security: [{ browserSession: [] }],
      responses: {
        '200': {
          description: 'Current CSRF token and session expiry',
          content: { 'application/json': { schema: z.toJSONSchema(browserSessionSchema) } },
        },
      },
    },
  }
  paths['/events'] = {
    get: {
      operationId: 'taskEvents',
      security: [{ bearerAuth: [] }, { browserSession: [] }],
      parameters: [
        { name: 'cursor', in: 'query', schema: z.toJSONSchema(taskCursorSchema) },
        { name: 'Last-Event-ID', in: 'header', schema: z.toJSONSchema(taskCursorSchema) },
      ],
      responses: {
        '200': {
          description: 'Ready position followed by durable Task changes; comments are heartbeats',
          content: { 'text/event-stream': { schema: z.toJSONSchema(taskStreamEventSchema) } },
        },
      },
    },
  }
  paths['/runs/{runId}/events'] = {
    get: {
      operationId: 'sessionEvents',
      security: [{ bearerAuth: [] }, { browserSession: [] }],
      parameters: [
        { name: 'runId', in: 'path', required: true, schema: z.toJSONSchema(idSchema) },
        { name: 'cursor', in: 'query', schema: { type: 'string', maxLength: 2048 } },
      ],
      responses: {
        '200': {
          description: 'Independent Session transcript stream',
          content: { 'text/event-stream': { schema: z.toJSONSchema(sessionStreamEventSchema) } },
        },
      },
    },
  }
  paths['/auth/logout'] = {
    post: {
      operationId: 'logoutBrowserSession',
      security: [{ browserSession: [] }],
      parameters: [{ name: 'X-CSRF-Token', in: 'header', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Browser credential revoked' } },
    },
  }
  const auth = [{ bearerAuth: [] }, { browserSession: [] }]
  const runParameter = { name: 'runId', in: 'path', required: true, schema: z.toJSONSchema(idSchema) }
  const fileResult = {
    description: 'Immutable file metadata',
    content: {
      'application/json': { schema: z.toJSONSchema(z.object({ items: z.array(attachmentSchema) })) },
    },
  }
  paths['/runs/{runId}/attachments'] = {
    get: {
      operationId: 'listAttachments',
      security: auth,
      parameters: [runParameter],
      responses: { '200': fileResult },
    },
    post: {
      operationId: 'uploadAttachments',
      security: auth,
      parameters: [
        runParameter,
        { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } },
        {
          name: 'X-CSRF-Token',
          in: 'header',
          schema: { type: 'string' },
          description: 'Required with browser cookies',
        },
      ],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['files'],
              properties: {
                files: {
                  type: 'array',
                  items: { type: 'string', contentMediaType: 'application/octet-stream' },
                },
              },
            },
          },
        },
      },
      responses: { '201': fileResult },
    },
  }
  paths['/runs/{runId}/attachments/{attachmentId}'] = {
    get: {
      operationId: 'downloadAttachment',
      security: auth,
      parameters: [
        runParameter,
        { name: 'attachmentId', in: 'path', required: true, schema: z.toJSONSchema(idSchema) },
        { name: 'Range', in: 'header', schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'Complete binary download' },
        '206': { description: 'Single byte range' },
        '416': { description: 'Invalid byte range' },
      },
    },
  }
  paths['/runs/{runId}/session-attachments/{sequence}/{index}'] = {
    get: {
      operationId: 'downloadSessionAttachment', security: auth,
      parameters: [runParameter, ...['sequence', 'index'].map(name => ({ name, in: 'path', required: true,
        schema: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }))],
      responses: {
        '200': { description: 'Verified bytes from a visible Session message' },
        '404': { description: 'No visible attachment at this position' },
        '409': { description: 'Session persistence is not available yet; retry after provisioning' },
      },
    },
  }
  for (const path of ['/health', '/ready'])
    paths[path] = {
      get: {
        operationId: path === '/health' ? 'health' : 'readiness',
        security: auth,
        responses: { '200': { description: 'Live host readiness' }, '503': { description: 'Not ready' } },
      },
    }
  const credentialParams = [
    {
      name: 'reference',
      in: 'path',
      required: true,
      schema: { type: 'string', pattern: credentialReferencePattern.source },
    },
  ]
  const credentialResult = {
    description: 'Value-free credential presence',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['configured', 'writable'],
          properties: { configured: { type: 'boolean' }, writable: { type: 'boolean' } },
        },
      },
    },
  }
  paths['/credentials'] = {
    get: {
      operationId: 'listCredentials',
      security: auth,
      responses: {
        '200': {
          description: 'Credential references named by installed definitions, with value-free presence',
          content: { 'application/json': { schema: z.toJSONSchema(credentialListSchema) } },
        },
      },
    },
  }
  paths['/credentials/{reference}'] = {
    get: {
      operationId: 'describeCredential',
      security: auth,
      parameters: credentialParams,
      responses: { '200': credentialResult },
    },
    put: {
      operationId: 'setCredential',
      security: auth,
      parameters: [
        ...credentialParams,
        {
          name: 'X-CSRF-Token',
          in: 'header',
          schema: { type: 'string' },
          description: 'Required with browser cookies',
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['value'],
              additionalProperties: false,
              properties: { value: { type: 'string', minLength: 1, maxLength: 65536, writeOnly: true } },
            },
          },
        },
      },
      responses: { '200': credentialResult },
    },
  }
  return document
}
