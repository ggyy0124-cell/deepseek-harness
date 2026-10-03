/** Plugin-supplied JSON schemas are bounded and cannot load code or remote documents. */
import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { compileForm, validateForm, validateForms } from '../src/forms.ts'
import { taskConfigSchema } from '../src/schema.ts'
import { nextCalendar } from '../src/calendar.ts'

describe('Task schema admission', () => {
  it.each([null, [], true, 1, 'schema'])('refuses a non-object schema: %j', (schema) => {
    expect(() => compileForm(schema)).toThrow('must be an object')
  })

  it.each([
    { $ref: 'https://example.test/schema.json' },
    { $dynamicRef: 'schema.json' },
    { $ref: 1 },
    { $async: true },
    { $id: 'https://example.test/schema.json' },
  ])('refuses external resolution and asynchronous schema extensions: %j', (schema) => {
    expect(() => compileForm(schema as JsonValue)).toThrow()
  })

  it('bounds both schema byte size and nesting before compilation', () => {
    expect(() => compileForm({ description: 'x'.repeat(65536) })).toThrow('64 KiB')
    let schema: JsonValue = {}
    for (let level = 0; level < 33; level++) schema = { items: schema }
    expect(() => compileForm(schema)).toThrow('nesting limit')
  })

  it('supports local references and leaves validated input unchanged', () => {
    const schema = { type: 'object', properties: { id: { $ref: '#/$defs/id' } },
      required: ['id'], additionalProperties: false, $defs: { id: { type: 'integer' } } }
    const input = Object.freeze({ id: 7 })
    validateForm(schema, input)
    validateForm(schema, input)
    expect(input).toEqual({ id: 7 })
    expect(() => { validateForm(schema, { id: 'secret-value' }) }).toThrow('does not match')
  })

  it.each([
    [{ 'x-dsh-label': 'Title' }, 'do not support the x-dsh-label annotation'],
    [{ type: 'string', 'x-dsh-widget': 'slider' }, 'must be textarea, credential, or options'],
    [{ type: 'integer', 'x-dsh-widget': 'credential' }, 'credential requires type string'],
    [{ properties: { notes: { 'x-dsh-widget': 'textarea' } } }, 'textarea requires type string'],
  ])('rejects unsupported Task form annotations: %j', (schema, message) => {
    expect(() => compileForm(schema as JsonValue)).toThrow(message)
  })

  it('accepts widget annotations and rejects invalid credential reference names', () => {
    const schema = { type: 'object', properties: {
      token: { type: 'string', 'x-dsh-widget': 'credential' },
      product: { 'x-dsh-widget': 'options' },
      notes: { type: 'string', 'x-dsh-widget': 'textarea' },
    } }
    validateForm(schema, { token: 'ZENTAO_TOKEN', product: 12, notes: 'Line one\nLine two' })
    expect(() => { validateForm(schema, { token: 'not a reference' }) }).toThrow('credential reference names are invalid')
    validateForms({ version: 1, business: schema, input: {}, supplement: { type: 'object', properties: { text: { type: 'string', 'x-dsh-widget': 'textarea' } } } })
    expect(() => { validateForms({ version: 1, business: {}, input: {}, supplement: { 'x-dsh-order': 1 } }) }).toThrow('x-dsh-order')
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('requires a positive safe schema generation: %s', (version) => {
    expect(() => { validateForms({ version, business: {}, input: {} }) }).toThrow('positive integer')
  })

  it('retains an explicit model choice while omitting an absent one', () => {
    const config = { schedule: { kind: 'manual' }, concurrency: 1, preset: 'minimal',
      permissionPreset: 'read-only', workspacePath: '/task', business: null }
    expect(taskConfigSchema.parse(config)).not.toHaveProperty('model')
    const model = { provider: 'configured', model: 'selected' }
    expect(taskConfigSchema.parse({ ...config, model }).model).toEqual(model)
  })

  it('returns no occurrence for an impossible calendar date', () => {
    expect(nextCalendar({ kind: 'scheduled', cron: '0 0 31 2 *', timezone: 'UTC', misfire: 'skip', overlap: 'queue' }, Date.UTC(2026, 0, 1)))
      .toBeNull()
  })
})
