/** Form annotations, credential references and wait content stay pure and transport independent. */
import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { credentialReferences, taskFormAnnotationError, taskIdPattern, waitContentSchema } from '../src/schema.ts'

describe('Task form annotations', () => {
  it.each([
    [{ type: 'string', title: 'Token', 'x-dsh-widget': 'credential' }, undefined],
    [{ type: 'string', 'x-dsh-widget': 'textarea' }, undefined],
    [{ 'x-dsh-widget': 'options' }, undefined],
    [{ 'x-dsh-hint': 'wide' }, 'Task forms do not support the x-dsh-hint annotation'],
    [{ type: 'string', 'x-dsh-widget': 'color' }, 'x-dsh-widget must be textarea, credential, or options'],
    [{ type: 'number', 'x-dsh-widget': 'textarea' }, 'x-dsh-widget textarea requires type string'],
  ])('checks %j', (node, error) => {
    expect(taskFormAnnotationError(node)).toBe(error)
  })
})

describe('credential references', () => {
  const credential = { type: 'string', 'x-dsh-widget': 'credential' }

  it('follows properties, array items, combinators and local references', () => {
    const schema = {
      type: 'object',
      $defs: { token: credential, 'a/b~c': credential },
      properties: {
        primary: { $ref: '#/$defs/token' },
        escaped: { $ref: '#/$defs/a~1b~0c' },
        mirrors: { type: 'array', items: credential },
        nested: { allOf: [{ properties: { inner: credential } }] },
        either: { anyOf: [credential, { type: 'number' }] },
        exclusive: { oneOf: [{ $ref: '#/allOf/0' }] },
        plain: { type: 'string' },
        missing: credential,
      },
      allOf: [credential],
    }
    const value = {
      primary: 'ZENTAO_TOKEN', escaped: 'ESCAPED_TOKEN', mirrors: ['GERRIT_PASSWORD', 'ZENTAO_TOKEN'],
      nested: { inner: 'NESTED_TOKEN' }, either: 'EITHER_TOKEN', exclusive: 'EXCLUSIVE_TOKEN', plain: 'NOT_A_REFERENCE',
    }
    expect(credentialReferences(schema, value)).toEqual(
      ['EITHER_TOKEN', 'ESCAPED_TOKEN', 'EXCLUSIVE_TOKEN', 'GERRIT_PASSWORD', 'NESTED_TOKEN', 'ZENTAO_TOKEN'])
  })

  it('ignores remote, unresolved and non-object schema nodes', () => {
    expect(credentialReferences({ $ref: 'https://example.test/schema.json' }, 'TOKEN')).toEqual([])
    expect(credentialReferences({ $ref: '#/$defs/absent' }, 'TOKEN')).toEqual([])
    expect(credentialReferences({ properties: { list: { $ref: '#/items/first' } }, items: [credential] }, { list: 'TOKEN' })).toEqual([])
    expect(credentialReferences({ $ref: '#', ...credential }, 'ROOT_TOKEN')).toEqual(['ROOT_TOKEN'])
    expect(credentialReferences(true, 'TOKEN')).toEqual([])
    expect(credentialReferences({ properties: { token: credential } }, ['TOKEN'])).toEqual([])
  })

  it('stops at the shared nesting limit', () => {
    let schema: JsonValue = credential
    for (let level = 0; level < 40; level++) schema = { properties: { next: schema } }
    let value: JsonValue = 'DEEP_TOKEN'
    for (let level = 0; level < 40; level++) value = { next: value }
    expect(credentialReferences(schema, value)).toEqual([])
  })
})

describe('business wait content', () => {
  it('accepts a title with optional Markdown and Run attachment identities', () => {
    expect(waitContentSchema.parse({ title: 'Confirm plan', body: '**Diff** below', attachments: ['blob-1'] }))
      .toEqual({ title: 'Confirm plan', body: '**Diff** below', attachments: ['blob-1'] })
    expect(waitContentSchema.safeParse({ title: 'Confirm plan', attachments: ['..'] }).success).toBe(false)
    expect(waitContentSchema.safeParse({ title: '', body: 'missing title' }).success).toBe(false)
    expect(taskIdPattern.test('run:1.2_a-b')).toBe(true)
  })
})
