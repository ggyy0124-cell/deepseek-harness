/** Pure execution configuration and form validation shared by storage and HTTP clients. */
import { z } from 'zod'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Non-secret execution choices resolved before admission. */
export const executionConfigSchema = z.strictObject({
  schedule: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('manual') }),
    z.strictObject({ kind: z.literal('polling'), intervalMs: z.number().int().positive() }),
    z.strictObject({
      kind: z.literal('scheduled'),
      cron: z.string().min(1),
      timezone: z.string().min(1),
      misfire: z.enum(['all', 'coalesce', 'skip']),
      overlap: z.enum(['queue', 'allow']),
    }),
  ]),
  concurrency: z.number().int().positive(),
  preset: z.string().min(1),
  permissionPreset: z.string().min(1),
  workspacePath: z.string().min(1),
  business: z.json(),
  model: z.strictObject({ provider: z.string().min(1), model: z.string().min(1) }).optional(),
})

/** Opaque wire identity characters; path segments `.` and `..` are excluded. */
export const taskIdPattern = /^(?!\.{1,2}$)[A-Za-z0-9._:-]+$/

/** Structured business wait content; any other wait prompt stays opaque JSON. */
export const waitContentSchema = z.strictObject({
  title: z.string().min(1),
  body: z.string().optional(),
  attachments: z.array(z.string().min(1).max(256).regex(taskIdPattern)).optional(),
})

/** One Agent question with its header, detail, selection mode and option descriptions. */
export const taskQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  detail: z.string().nullable(),
  header: z.string().nullable(),
  multiSelect: z.boolean(),
  options: z.array(z.object({ label: z.string(), description: z.string().nullable() })),
})

/**
 * Values of the `x-dsh-widget` form annotation: a multiline string, a shared
 * credential reference name, or a value chosen from the definition's dynamic options.
 */
export const taskFormWidgets = ['textarea', 'credential', 'options'] as const
/** One supported form widget annotation. */
export type TaskFormWidget = (typeof taskFormWidgets)[number]
/** Credential reference names accepted by the shared credential provider. */
export const credentialReferencePattern = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Check the Task annotations of one schema object.
 * @param node - one object node of a plugin form schema.
 * @returns the first annotation error, or undefined when the node is valid.
 */
export function taskFormAnnotationError(node: Readonly<Record<string, JsonValue>>): string | undefined {
  for (const key of Object.keys(node)) {
    if (!key.startsWith('x-dsh-')) continue
    if (key !== 'x-dsh-widget') return `Task forms do not support the ${key} annotation`
    const widget = taskFormWidgets.find(value => value === node[key])
    if (widget === undefined) return 'x-dsh-widget must be textarea, credential, or options'
    if (widget !== 'options' && node['type'] !== 'string') return `x-dsh-widget ${widget} requires type string`
  }
  return undefined
}

/** Collect the credential references a form value names through `x-dsh-widget: credential` properties.
 * @param schema - self-contained form schema; local `$ref` pointers are followed.
 * @param value - configuration or input value described by the schema.
 * @returns distinct reference names in sorted order.
 */
export function credentialReferences(schema: JsonValue, value: JsonValue): string[] {
  const found = new Set<string>()
  const visit = (node: JsonValue | undefined, data: JsonValue | undefined, depth: number): void => {
    if (depth > 32 || !isRecord(node) || data === undefined) return
    if (typeof node['$ref'] === 'string') visit(pointer(schema, node['$ref']), data, depth + 1)
    if (node['x-dsh-widget'] === 'credential' && typeof data === 'string') found.add(data)
    const properties = node['properties']
    if (isRecord(properties) && isRecord(data))
      for (const [key, child] of Object.entries(properties)) visit(child, data[key], depth + 1)
    const items = node['items']
    if (isRecord(items) && Array.isArray(data)) for (const item of data) visit(items, item, depth + 1)
    for (const key of ['allOf', 'anyOf', 'oneOf']) {
      const branches = node[key]
      if (Array.isArray(branches)) for (const branch of branches) visit(branch, data, depth + 1)
    }
  }
  visit(schema, value, 0)
  return [...found].sort()
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resolve a local JSON Pointer reference such as `#/$defs/token`. */
function pointer(root: JsonValue, reference: string): JsonValue | undefined {
  if (reference !== '#' && !reference.startsWith('#/')) return undefined
  let node: JsonValue | undefined = root
  for (const raw of reference === '#' ? [] : reference.slice(2).split('/')) {
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~')
    node = isRecord(node) ? node[segment] : Array.isArray(node) ? node[Number(segment)] : undefined
  }
  return node
}
