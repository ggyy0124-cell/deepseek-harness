/** Public requests reject ambiguous inputs before a Task command can run. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { configureSchema, createTaskOpenApi, idSchema, pageQuerySchema, problemSchema, responseSchema, runSchema, taskJsonRoutes, timestampSchema } from '../src/index.ts'

describe('Task HTTP schemas', () => {
  it('rejects stale-token substitutes and private fields in interaction replies', () => {
    expect(responseSchema.safeParse({ revision: -1, response: true }).success).toBe(false)
    expect(responseSchema.safeParse({ revision: 1, response: true, approvedBy: 'admin' }).success).toBe(false)
    expect(responseSchema.parse({ revision: 0, response: { approved: false } })).toEqual({ revision: 0, response: { approved: false } })
  })
  it.each(['0', '201', '-1', '01', '1.5', '1e2', 'Infinity', ' 50'])('rejects invalid page limit %s', (limit) => {
    expect(pageQuerySchema.safeParse({ limit }).success).toBe(false)
  })
  it.each(['1', '50', '99', '100', '199', '200'])('accepts bounded page limit %s', (limit) => {
    expect(pageQuerySchema.parse({ limit })).toEqual({ limit })
  })
  it('rejects paths masquerading as opaque identifiers', () => {
    for (const id of ['', '.', '..', '../etc/passwd', 'a/b', '%2f', 'a?b', 'x'.repeat(257)]) expect(idSchema.safeParse(id).success).toBe(false)
    expect(idSchema.parse('personal.zentao-bug')).toBe('personal.zentao-bug')
  })
  it('requires UTC wire timestamps without migrating internal storage', () => {
    expect(timestampSchema.safeParse(1726123456000).success).toBe(false)
    expect(timestampSchema.safeParse('2026-09-12T08:00:00+08:00').success).toBe(false)
    expect(timestampSchema.parse('2026-09-12T00:00:00.000Z')).toBe('2026-09-12T00:00:00.000Z')
  })
  it('requires a complete configuration revision and rejects unrecognized settings', () => {
    const config = { schedule: { kind: 'manual' }, concurrency: 1, preset: 'standard', permissionPreset: 'default', workspacePath: '/tmp/task', business: {} }
    expect(configureSchema.parse({ revision: 0, configSchemaVersion: 1, config }).config).toEqual(config)
    expect(configureSchema.safeParse({ revision: 0, config }).success).toBe(false)
    const invalid = { revision: 0, configSchemaVersion: 1, config: { ...config, credentialValue: 'secret' } }
    expect(configureSchema.safeParse(invalid).success).toBe(false)
  })
  it('does not expose private checkpoints in the execution DTO', () => {
    type Content = { schema: { properties: Record<string, unknown> } }
    type Operation = { responses: Record<string, { content: Record<string, Content> }> }
    const document = createTaskOpenApi() as { paths: Record<string, { get: Operation }> }
    const schema = document.paths['/runs/{runId}']!.get.responses['200']!.content['application/json']!.schema
    expect(schema.properties).not.toHaveProperty('checkpoint')
    expect(schema.properties).not.toHaveProperty('input')
    expect(runSchema.safeParse({ checkpoint: { secret: 'private' } }).success).toBe(false)
  })
  it('validates machine-readable problems and refuses accidental secret fields', () => {
    const problem = { type: 'urn:dsh:task:conflict', status: 409, title: 'Conflict', detail: 'Revision changed', instance: '/runs/r', code: 'interaction-stale', requestId: 'r1', currentRevision: 2 }
    expect(problemSchema.parse(problem)).toEqual(problem)
    expect(problemSchema.parse({ ...problem, stack: 'private' })).not.toHaveProperty('stack')
  })
})

describe('Task OpenAPI publication', () => {
  it('publishes the retryable unavailable Session response for attachment clients', () => {
    expect(createTaskOpenApi()).toMatchObject({ paths: {
      '/runs/{runId}/session-attachments/{sequence}/{index}': { get: { responses: {
        '404': { description: 'No visible attachment at this position' },
        '409': { description: 'Session persistence is not available yet; retry after provisioning' },
      } } },
    } })
  })
  it('does not invent named query parameters for a dictionary schema', () => {
    const document = createTaskOpenApi([{ operationId: 'dictionary', method: 'get', path: '/dictionary',
      query: z.record(z.string(), z.string()), response: z.object({}), status: 200 }])
    expect(document).toMatchObject({ paths: { '/dictionary': { get: { parameters: [] } } } })
  })
  it('matches the committed document', () => {
    expect(JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'))).toEqual(createTaskOpenApi())
  })
  it('rejects ambiguous operation registrations', () => {
    expect(() => createTaskOpenApi([taskJsonRoutes[0], taskJsonRoutes[0]])).toThrow('Duplicate')
    const repeatedId = { ...taskJsonRoutes[1], operationId: taskJsonRoutes[0].operationId }
    expect(() => createTaskOpenApi([taskJsonRoutes[0], repeatedId])).toThrow('Duplicate')
  })
  it('marks every write idempotent and every operation authenticated', () => {
    type Operation = { security: unknown[]; parameters: { name: string; required: boolean }[] }
    const doc = createTaskOpenApi() as { paths: Record<string, Record<string, Operation>> }
    for (const route of taskJsonRoutes) {
      const op = doc.paths[route.path]![route.method]!
      expect(op.security).toHaveLength(2)
      expect(op.parameters.some(p => p.name === 'Idempotency-Key' && p.required)).toBe(route.method !== 'get')
    }
  })
})
