/** Bounded, self-contained Draft 2020-12 configuration and interaction validation. */
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js'
import { TaskCommandError, type TaskForms } from '@deepseek-ai/dsh-task'
import { credentialReferencePattern, credentialReferences, taskFormAnnotationError } from '@deepseek-ai/dsh-task/schema'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

const ajv = new Ajv2020({ strict: false, allErrors: false, validateFormats: false, addUsedSchema: false })
const validators = new WeakMap<object, ValidateFunction>()
/** Compile a local JSON Schema and reject remote references, executable extensions or unknown Task annotations.
 * @param schema - plugin-owned schema document.
 * @returns validator with no remote resolver or mutation of input values.
 */
export function compileForm(schema: JsonValue): ValidateFunction {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema))
    throw new Error('Task form schema must be an object')
  const cached = validators.get(schema)
  if (cached !== undefined) return cached
  // Protocol resource limits bound compilation, independently of plugin deployment tunables.
  if (Buffer.byteLength(JSON.stringify(schema)) > 65536) throw new Error('Task form schema exceeds 64 KiB')
  const visit = (value: JsonValue, depth: number): void => {
    if (depth > 32) throw new Error('Task form schema exceeds nesting limit')
    if (typeof value !== 'object' || value === null) return
    if (!Array.isArray(value)) {
      const annotation = taskFormAnnotationError(value)
      if (annotation !== undefined) throw new Error(annotation)
    }
    for (const [key, child] of Object.entries(value)) {
      if ((key === '$ref' || key === '$dynamicRef') && (typeof child !== 'string' || !child.startsWith('#')))
        throw new Error('Task schemas must use local references')
      if (key === '$async' || key === '$id')
        throw new Error('Task schemas cannot define async validators or external identities')
      visit(child, depth + 1)
    }
  }
  visit(schema, 0)
  const validate = ajv.compile(schema)
  validators.set(schema, validate)
  return validate
}
/** Validate business input without returning submitted values in diagnostics.
 * @param schema - declared local schema.
 * @param value - business configuration or input.
 */
export function validateForm(schema: JsonValue, value: JsonValue): void {
  if (!compileForm(schema)(value))
    throw new TaskCommandError('invalid_configuration', 'Task value does not match the declared schema')
  if (credentialReferences(schema, value).some(reference => !credentialReferencePattern.test(reference)))
    throw new TaskCommandError('invalid_configuration', 'Task credential reference names are invalid')
}
/** Validate every schema document at plugin registration.
 * @param forms - optional schema generation; absent preserves historical generic JSON definitions.
 */
export function validateForms(forms: TaskForms | undefined): void {
  if (forms === undefined) return
  if (!Number.isSafeInteger(forms.version) || forms.version < 1)
    throw new Error('Task schema version must be a positive integer')
  compileForm(forms.business)
  compileForm(forms.input)
  if (forms.supplement !== undefined) compileForm(forms.supplement)
}
