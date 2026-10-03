// @vitest-environment jsdom
/** Schema-driven form helpers, reply-control selection and configuration merge. */
import { describe, expect, it } from 'vitest'
import { hasFormControls, resolveSchema, schemaChoices, schemaDefault, validateSchema, type SchemaNode } from '../src/components/SchemaForm.tsx'
import { replyMode } from '../src/components/Interaction.tsx'
import { applyChanges, configChanges } from '../src/lib/config-diff.ts'
import type { TaskConfig } from '../src/lib/types.ts'

const messages = { required: 'required', invalid: 'invalid', credential: 'credential' }

describe('schema helpers', () => {
  const schema: SchemaNode = {
    type: 'object',
    required: ['product', 'token'],
    $defs: { token: { type: 'string', 'x-dsh-widget': 'credential', title: 'Token' } },
    properties: {
      product: { type: 'string', enum: ['mobile', 'web'] },
      severity: { type: 'array', items: { oneOf: [{ const: 1, title: 'Critical', description: 'Stops work' }, { const: 2, title: 'Major' }] } },
      review: { type: 'boolean', default: true },
      limit: { type: 'integer', minimum: 1, maximum: 5 },
      branch: { type: 'string', pattern: '^release/' },
      token: { $ref: '#/$defs/token' },
    },
  }

  it('resolves local references and reads closed choices', () => {
    expect(resolveSchema({ $ref: '#/$defs/token', description: 'local' }, schema)).toEqual({ type: 'string', 'x-dsh-widget': 'credential', title: 'Token', description: 'local' })
    expect(schemaChoices({ enum: ['a', 2] })).toEqual([{ value: 'a', label: 'a' }, { value: 2, label: '2' }])
    expect(schemaChoices({ oneOf: [{ const: 1, title: 'Critical', description: 'Stops work' }] })).toEqual([{ value: 1, label: 'Critical', description: 'Stops work' }])
    expect(schemaChoices({ oneOf: [{ type: 'string' }] })).toBeUndefined()
  })

  it('fills required fields and explicit defaults only', () => {
    expect(schemaDefault(schema, schema)).toEqual({ product: null, token: null, review: true })
    expect(hasFormControls(schema)).toBe(true)
    expect(hasFormControls({})).toBe(false)
  })

  it('reports required, range, pattern and credential reference errors by field path', () => {
    const errors = validateSchema(schema, { product: '', token: '1bad', limit: 9, branch: 'main' }, schema, '', messages)
    expect(Object.fromEntries(errors)).toEqual({ product: 'required', token: 'credential', limit: 'invalid', branch: 'invalid' })
    expect(validateSchema(schema, { product: 'web', token: 'TOKEN', limit: 2, branch: 'release/2.4' }, schema, '', messages).size).toBe(0)
  })
})

describe('replyMode', () => {
  it('maps response schemas to reply controls', () => {
    expect(replyMode({})).toEqual({ kind: 'text' })
    expect(replyMode({ type: 'string' })).toEqual({ kind: 'text' })
    expect(replyMode({ type: 'boolean' })).toEqual({ kind: 'boolean' })
    expect(replyMode({ enum: ['yes', 'no'] })).toMatchObject({ kind: 'choices' })
    expect(replyMode({ type: 'object', properties: { decision: { enum: ['approve', 'reject'] }, note: { type: 'string' } } }))
      .toMatchObject({ kind: 'choice-object', key: 'decision', notes: ['note'] })
    expect(replyMode({ type: 'object', properties: { count: { type: 'integer' } } })).toEqual({ kind: 'form' })
  })
})

describe('configuration merge', () => {
  const base: TaskConfig = {
    schedule: { kind: 'polling', intervalMs: 600000 }, concurrency: 2, preset: 'standard', permissionPreset: 'read-only',
    workspacePath: '/work', business: { product: 'mobile', severity: [1, 2] },
  }

  it('lists changed leaves and reapplies them onto a newer revision', () => {
    const edited: TaskConfig = { ...base, business: { product: 'mobile', severity: [1, 2, 3] }, model: { provider: 'deepseek', model: 'flash' } }
    const changes = configChanges(base, edited)
    expect(changes.map(change => change.path.join('.'))).toEqual(['business.severity', 'model'])
    const newer: TaskConfig = { ...base, schedule: { kind: 'polling', intervalMs: 300000 } }
    expect(applyChanges(newer, changes)).toEqual({ ...newer, business: { product: 'mobile', severity: [1, 2, 3] }, model: { provider: 'deepseek', model: 'flash' } })
    const { model: _model, ...withoutModel } = edited
    expect(applyChanges(edited, configChanges(edited, withoutModel))).toEqual(withoutModel)
  })
})
