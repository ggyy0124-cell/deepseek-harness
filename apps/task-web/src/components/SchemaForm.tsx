/** Form controls generated from plugin JSON Schemas, including the Task `x-dsh-widget` annotations. */
import { useEffect, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Button, IconRefreshOutlineRegular, Pill, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { sendOnEnter } from '../support/keys.ts'
import type { Json } from '../support/types.ts'
import { IconButton, Mono, Select, SettingsRow } from './ui.tsx'

/** JSON Schema node as published by a plugin. */
export type SchemaNode = { readonly [key: string]: Json }

/** Services a form needs beyond its schema and value. */
export interface SchemaFormContext {
  /** Root schema used to resolve local `$ref` pointers. */
  readonly root: SchemaNode
  /** Dynamic options of an `options` widget; absent renders a text field. */
  readonly loadOptions?: ((field: string) => Promise<readonly { value: Json; label: string }[]>) | undefined
  /** Value-free status of a credential reference. */
  readonly credentialStatus?: ((reference: string) => { configured: boolean; writable: boolean } | undefined) | undefined
  /** Open the credential editor for a reference. */
  readonly editCredential?: ((reference: string) => void) | undefined
  /** Disable every control. */
  readonly readOnly?: boolean | undefined
  /** Called for a plain Enter in a multiline field of the top-level object; Shift+Enter breaks the line.
   * Fields inside nested groups keep Enter as a line break. */
  readonly onEnter?: (() => void) | undefined
}

/** Whether the top-level object of a schema has a multiline text field, the fields {@link SchemaFormContext.onEnter} applies to.
 * @param schema - root schema.
 * @returns true when Enter can send from a field of the form.
 */
export function hasEnterField(schema: SchemaNode): boolean {
  const resolved = resolveSchema(schema, schema)
  const properties = isNode(resolved['properties']) ? resolved['properties'] : {}
  return Object.values(properties).some((child) => {
    if (!isNode(child)) return false
    const node = resolveSchema(child, schema)
    return node['x-dsh-widget'] === 'textarea' && typeOf(node) === 'string'
  })
}

const credentialPattern = /^[A-Za-z_][A-Za-z0-9_]*$/

function isNode(value: Json | undefined): value is SchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resolve a local `$ref` chain.
 * @param node - schema node.
 * @param root - document root.
 * @returns referenced node, or the node itself.
 */
export function resolveSchema(node: SchemaNode, root: SchemaNode): SchemaNode {
  let current = node
  for (let depth = 0; depth < 16; depth++) {
    const reference = current['$ref']
    if (typeof reference !== 'string' || !reference.startsWith('#')) return current
    let target: Json | undefined = root
    for (const raw of reference === '#' ? [] : reference.slice(2).split('/')) {
      const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~')
      target = isNode(target) ? target[segment] : Array.isArray(target) ? target[Number(segment)] : undefined
    }
    if (!isNode(target)) return current
    const { $ref: _reference, ...rest } = current
    current = { ...target, ...rest }
  }
  return current
}

function typeOf(node: SchemaNode): string | undefined {
  const type = node['type']
  if (typeof type === 'string') return type
  if (Array.isArray(type)) return type.find(item => item !== 'null') as string | undefined
  if (Array.isArray(node['enum'])) return typeof node['enum'][0] === 'number' ? 'number' : 'string'
  if (isNode(node['properties'])) return 'object'
  return undefined
}

/** Choices declared by `enum` or `oneOf`/`anyOf` constants.
 * @param node - resolved schema node.
 * @returns choices with labels, or undefined when the node is not a closed choice.
 */
export function schemaChoices(node: SchemaNode): { value: Json; label: string; description?: string | undefined }[] | undefined {
  const values = node['enum']
  if (Array.isArray(values)) return values.map(value => ({ value, label: typeof value === 'string' ? value : JSON.stringify(value) }))
  for (const key of ['oneOf', 'anyOf']) {
    const branches = node[key]
    if (!Array.isArray(branches) || branches.length === 0) continue
    if (!branches.every(branch => isNode(branch) && 'const' in branch)) continue
    return branches.map((branch) => {
      const item = branch as SchemaNode
      const value = item['const'] as Json
      return {
        value, label: typeof item['title'] === 'string' ? item['title'] : typeof value === 'string' ? value : JSON.stringify(value),
        description: typeof item['description'] === 'string' ? item['description'] : undefined,
      }
    })
  }
  return undefined
}

/** Default value of a schema node, used when a field is absent.
 * @param node - schema node.
 * @param root - document root.
 * @returns declared default or an empty value of the node's type.
 */
export function schemaDefault(node: SchemaNode, root: SchemaNode): Json {
  const resolved = resolveSchema(node, root)
  if ('default' in resolved) return resolved['default']
  switch (typeOf(resolved)) {
    case 'object': {
      const out: Record<string, Json> = {}
      const properties = resolved['properties']
      const required = Array.isArray(resolved['required']) ? resolved['required'] : []
      if (isNode(properties)) for (const [key, child] of Object.entries(properties)) {
        if (!isNode(child)) continue
        if (required.includes(key) || 'default' in resolveSchema(child, root)) out[key] = schemaDefault(child, root)
      }
      return out
    }
    case 'array': return []
    case 'boolean': return false
    default: return null
  }
}

/** Whether a schema can be edited with generated controls.
 * @param schema - root schema.
 * @returns false for empty schemas and roots that are not objects or scalars.
 */
export function hasFormControls(schema: SchemaNode): boolean {
  const type = typeOf(resolveSchema(schema, schema))
  return type !== undefined && Object.keys(schema).length > 0
}

/** Validate the client-checkable constraints of a value.
 * @param node - schema node.
 * @param value - candidate value.
 * @param root - document root.
 * @param path - dotted field path.
 * @param messages - localized messages.
 * @returns field path to message.
 */
export function validateSchema(node: SchemaNode, value: Json | undefined, root: SchemaNode, path: string,
  messages: { required: string; invalid: string; credential: string }): Map<string, string> {
  const errors = new Map<string, string>()
  const resolved = resolveSchema(node, root)
  const type = typeOf(resolved)
  if (value === undefined || value === null) return errors
  if (type === 'object' && isNode(value)) {
    const properties = resolved['properties']
    const required = Array.isArray(resolved['required']) ? resolved['required'] : []
    if (isNode(properties)) {
      for (const [key, child] of Object.entries(properties)) {
        const childValue = (value as Record<string, Json>)[key]
        const childPath = path === '' ? key : `${path}.${key}`
        if (required.includes(key) && (childValue === undefined || childValue === null || childValue === '')) errors.set(childPath,
          messages.required)
        else if (isNode(child)) for (const [field, message] of validateSchema(child, childValue, root, childPath,
          messages)) errors.set(field, message)
      }
    }
    return errors
  }
  if (type === 'string') {
    if (typeof value !== 'string') { errors.set(path, messages.invalid); return errors }
    if (resolved['x-dsh-widget'] === 'credential' && value !== '' && !credentialPattern.test(value)) errors.set(path, messages.credential)
    if (typeof resolved['minLength'] === 'number' && value.length < resolved['minLength']) errors.set(path, messages.invalid)
    if (typeof resolved['pattern'] === 'string') {
      try {
        if (!new RegExp(resolved['pattern'], 'u').test(value)) errors.set(path, messages.invalid)
      } catch {
        // An ECMAScript-incompatible pattern stays a server-side check.
      }
    }
  }
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || Number.isNaN(value) || (type === 'integer' && !Number.isInteger(value))) { errors.set(path,
      messages.invalid); return errors }
    if (typeof resolved['minimum'] === 'number' && value < resolved['minimum']) errors.set(path, messages.invalid)
    if (typeof resolved['maximum'] === 'number' && value > resolved['maximum']) errors.set(path, messages.invalid)
  }
  return errors
}

/** Generated form for an object schema.
 * @param props.schema - root schema.
 * @param props.value - current value.
 * @param props.onChange - replaced value.
 * @param props.errors - field path to message.
 * @param props.layout - settings rows or stacked fields.
 * @returns form fields.
 */
export function SchemaForm({ schema, value, onChange, errors, layout = 'rows', context }: {
  schema: SchemaNode
  value: Json
  onChange: (value: Json) => void
  errors?: ReadonlyMap<string, string> | undefined
  layout?: 'rows' | 'stack'
  context?: Omit<SchemaFormContext, 'root'>
}) {
  const full: SchemaFormContext = { root: schema, ...context }
  const resolved = resolveSchema(schema, schema)
  if (typeOf(resolved) === 'object') {
    return <ObjectFields node={resolved} value={isNode(value) ? value : {}} onChange={onChange} path="" errors={errors} layout={layout}
      context={full} />
  }
  const label = typeof resolved['title'] === 'string' ? resolved['title'] : ''
  return (
    <Field label={label} hint={description(resolved)} layout={layout} error={errors?.get('')} required={false}>
      <Control node={resolved} value={value} onChange={onChange} path="" context={full} />
    </Field>
  )
}

function description(node: SchemaNode): string | undefined {
  return typeof node['description'] === 'string' ? node['description'] : undefined
}

function ObjectFields({ node, value, onChange, path, errors, layout, context }: {
  node: SchemaNode
  value: { readonly [key: string]: Json }
  onChange: (value: Json) => void
  path: string
  errors: ReadonlyMap<string, string> | undefined
  layout: 'rows' | 'stack'
  context: SchemaFormContext
}) {
  const t = useT()
  const properties = isNode(node['properties']) ? node['properties'] : {}
  const required = Array.isArray(node['required']) ? node['required'] : []
  const order = Array.isArray(node['x-order']) ? node['x-order'].filter((key): key is string => typeof key === 'string') : []
  const keys = [...order.filter(key => key in properties), ...Object.keys(properties).filter(key => !order.includes(key))]
  return (
    <div className={clsx(layout === 'stack' ? 'tw-form-stack' : 'tw-form-rows')}>
      {keys.map((key) => {
        const raw = properties[key]
        if (!isNode(raw)) return null
        const child = resolveSchema(raw, context.root)
        const childPath = path === '' ? key : `${path}.${key}`
        const label = typeof child['title'] === 'string' ? child['title'] : key
        const set = (next: Json) => { onChange({ ...value, [key]: next }) }
        if (typeOf(child) === 'object' && !(child['x-dsh-widget'] !== undefined)) {
          return (
            <fieldset key={key} className="tw-form-group">
              <legend>{label}</legend>
              {description(child) !== undefined && <p className="tw-form-hint">{description(child)}</p>}
              <ObjectFields node={child} value={isNode(value[key]) ? value[key] : {}} onChange={set} path={childPath} errors={errors}
                layout={layout} context={context} />
            </fieldset>
          )
        }
        const hint = [description(child), child['x-dsh-widget'] === 'options' ? t.form.optionsLive : undefined,
          child['x-dsh-widget'] === 'credential' ? t.form.credentialHint : undefined,
          typeOf(child) === 'array' && schemaChoices(resolveSchema(isNode(child['items']) ? child['items'] : {},
            context.root)) !== undefined ? t.form.multi : undefined]
          .filter((item): item is string => item !== undefined).join(' · ')
        return (
          <Field key={key} label={label} hint={hint} layout={layout} error={errors?.get(childPath)} required={required.includes(key)}
            htmlFor={`field-${childPath}`}>
            <Control node={child} value={value[key]} onChange={set} path={childPath} context={context} />
          </Field>
        )
      })}
    </div>
  )
}

function Field({ label, hint, layout, error, required, htmlFor, children }: {
  label: string
  hint: string | undefined
  layout: 'rows' | 'stack'
  error: string | undefined
  required: boolean
  htmlFor?: string
  children: ReactNode
}) {
  const title = <>{label}{required && <span className="tw-required"> *</span>}</>
  if (layout === 'rows') return <SettingsRow label={title} hint={hint} error={error} {...(htmlFor === undefined ? {}
    : { htmlFor })}>{children}</SettingsRow>
  return (
    <div className="tw-stack-field">
      {htmlFor === undefined ? <span className="tw-stack-label">{title}</span> : <label className="tw-stack-label"
        htmlFor={htmlFor}>{title}</label>}
      {children}
      {hint !== undefined && hint !== '' && <span className="tw-form-hint">{hint}</span>}
      {error !== undefined && <span className="tw-field-error" role="alert">{error}</span>}
    </div>
  )
}

function Control({ node, value, onChange, path, context }: {
  node: SchemaNode
  value: Json | undefined
  onChange: (value: Json) => void
  path: string
  context: SchemaFormContext
}) {
  const t = useT()
  const type = typeOf(node)
  const widget = node['x-dsh-widget']
  const id = `field-${path}`
  const disabled = context.readOnly === true
  if (widget === 'credential') return <CredentialControl id={id} value={typeof value === 'string' ? value : ''} onChange={onChange}
    context={context} />
  if (widget === 'options') return <OptionsControl id={id} field={path} label={typeof node['title'] === 'string' ? node['title'] : path}
    value={value} onChange={onChange} context={context} multiple={type === 'array'} />
  const choices = schemaChoices(node)
  if (choices !== undefined) {
    const current = choices.find(choice => JSON.stringify(choice.value) === JSON.stringify(value))
    return (
      <Select label={typeof node['title'] === 'string' ? node['title'] : path} width={220} disabled={disabled} placeholder={t.form.select}
        value={current === undefined ? undefined : JSON.stringify(current.value)}
        options={choices.map(choice => ({ value: JSON.stringify(choice.value), label: choice.label }))}
        onChange={(next) => { onChange(JSON.parse(next) as Json) }} />
    )
  }
  switch (type) {
    case 'boolean':
      return <Switch checked={value === true} disabled={disabled} label={typeof node['title'] === 'string' ? node['title'] : path}
        onChange={onChange} />
    case 'integer':
    case 'number':
      return (
        <input id={id} type="number" className="tw-input tw-input-number" disabled={disabled}
          value={typeof value === 'number' ? String(value) : ''} step={type === 'integer' ? 1 : 'any'}
          {...(typeof node['minimum'] === 'number' ? { min: node['minimum'] } : {})} {...(typeof node['maximum'] === 'number'
            ? { max: node['maximum'] } : {})}
          onChange={(event) => { onChange(event.target.value === '' ? null : Number(event.target.value)) }} />
      )
    case 'string':
      if (widget === 'textarea') {
        const enter = context.onEnter
        return <textarea id={id} className="tw-textarea" rows={3} disabled={disabled} value={typeof value === 'string' ? value : ''}
          placeholder={typeof node['examples'] === 'string' ? node['examples'] : undefined}
          onChange={(event) => { onChange(event.target.value) }}
          {...(enter === undefined || path.includes('.') ? {} : { onKeyDown: sendOnEnter(enter) })} />
      }
      return <input id={id} type="text" className="tw-input tw-input-wide" disabled={disabled} value={typeof value === 'string' ? value
        : ''}
      onChange={(event) => { onChange(event.target.value) }} />
    case 'array': {
      const items = resolveSchema(isNode(node['items']) ? node['items'] : {}, context.root)
      const itemChoices = items['x-dsh-widget'] === 'options' ? undefined : schemaChoices(items)
      const list = Array.isArray(value) ? value : []
      if (itemChoices !== undefined) {
        return (
          <div className="tw-pills">
            {itemChoices.map((choice) => {
              const key = JSON.stringify(choice.value)
              const selected = list.some(item => JSON.stringify(item) === key)
              return (
                <Pill key={key} active={selected} disabled={disabled} aria-pressed={selected}
                  onClick={() => { onChange(selected ? list.filter(item => JSON.stringify(item) !== key) : [...list,
                    choice.value]) }}>{choice.label}</Pill>
              )
            })}
          </div>
        )
      }
      if (typeOf(items) === 'string') {
        return <textarea id={id} className="tw-textarea" rows={3} disabled={disabled}
          value={list.filter(item => typeof item === 'string').join('\n')}
          onChange={(event) => { onChange(event.target.value.split('\n').filter(line => line !== '')) }} />
      }
      return <JsonControl id={id} value={value} onChange={onChange} disabled={disabled} />
    }
    default:
      return <JsonControl id={id} value={value} onChange={onChange} disabled={disabled} />
  }
}

function JsonControl({ id, value, onChange,
  disabled }: { id: string; value: Json | undefined; onChange: (value: Json) => void; disabled: boolean }) {
  const t = useT()
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)))
  const [invalid, setInvalid] = useState(false)
  return (
    <div className="tw-stack-4">
      <textarea id={id} className="tw-textarea tw-mono" rows={4} disabled={disabled} value={text}
        onChange={(event) => {
          setText(event.target.value)
          try {
            onChange(event.target.value.trim() === '' ? null : JSON.parse(event.target.value) as Json)
            setInvalid(false)
          } catch {
            setInvalid(true) // Keep the text until it parses.
          }
        }} />
      {invalid && <span className="tw-field-error">{t.definition.jsonInvalid}</span>}
    </div>
  )
}

function CredentialControl({ id, value, onChange,
  context }: { id: string; value: string; onChange: (value: Json) => void; context: SchemaFormContext }) {
  const t = useT()
  const status = value === '' ? undefined : context.credentialStatus?.(value)
  return (
    <span className="tw-inline-flex tw-gap-8">
      <input id={id} type="text" className="tw-input tw-mono tw-input-ref" value={value} disabled={context.readOnly === true}
        placeholder={t.settings.referencePlaceholder} onChange={(event) => { onChange(event.target.value) }} />
      {status !== undefined && <Tag tone={status.configured ? 'success' : 'danger'}>{status.configured ? t.form.configured
        : t.form.missing}</Tag>}
      {status !== undefined && !status.writable && <Tag tone="outline">{t.form.readOnly}</Tag>}
      {value !== '' && credentialPattern.test(value) && (status === undefined || status.writable) && context.editCredential !== undefined
        && (
          <Button variant={status?.configured === true ? 'outline' : 'primary'} size="sm" onClick={() => { context.editCredential?.(value) }}>
            {status?.configured === true ? t.form.replace : t.form.set}
          </Button>
        )}
    </span>
  )
}

function OptionsControl({ id, field, label, value, onChange, context, multiple }: {
  id: string
  field: string
  label: string
  value: Json | undefined
  onChange: (value: Json) => void
  context: SchemaFormContext
  multiple: boolean
}) {
  const t = useT()
  const [state, setState] = useState<{ items: readonly { value: Json; label: string }[]; error: boolean; loading: boolean }>({ items: [],
    error: false, loading: true })
  const [generation, setGeneration] = useState(0)
  const load = context.loadOptions
  useEffect(() => {
    if (load === undefined) return
    let live = true
    setState(previous => ({ ...previous, loading: true }))
    load(field).then(
      (items) => { if (live) setState({ items, error: false, loading: false }) },
      () => { if (live) setState({ items: [], error: true, loading: false }) },
    )
    return () => { live = false }
  }, [load, field, generation])
  if (load === undefined) {
    return <input id={id} type="text" className="tw-input tw-input-wide" value={typeof value === 'string' ? value
      : JSON.stringify(value ?? '')}
    onChange={(event) => { onChange(event.target.value) }} />
  }
  const refresh = <IconButton label={t.form.refreshOptions} tone="caption" icon={<IconRefreshOutlineRegular size={16} />}
    onClick={() => { setGeneration(item => item + 1) }} />
  if (multiple) {
    const list = Array.isArray(value) ? value : []
    return (
      <span className="tw-inline-flex tw-gap-8">
        <span className="tw-pills">
          {state.items.map((item) => {
            const key = JSON.stringify(item.value)
            const selected = list.some(entry => JSON.stringify(entry) === key)
            return <Pill key={key} active={selected} onClick={() => { onChange(selected
              ? list.filter(entry => JSON.stringify(entry) !== key) : [...list, item.value]) }}>{item.label}</Pill>
          })}
          {state.items.length === 0 && !state.loading && <span className="tw-muted-small">{state.error ? t.form.optionsFailed
            : t.form.noOptions}</span>}
        </span>
        {refresh}
      </span>
    )
  }
  const current = value === undefined ? undefined : JSON.stringify(value)
  const known = state.items.some(item => JSON.stringify(item.value) === current)
  const options = [
    ...state.items.map(item => ({ value: JSON.stringify(item.value), label: item.label })),
    ...(current !== undefined && current !== 'null' && !known ? [{ value: current, label: typeof value === 'string' ? value : current }]
      : []),
  ]
  return (
    <span className="tw-inline-flex tw-gap-8">
      {state.error && <span className="tw-field-error">{t.form.optionsFailed}</span>}
      <Select label={label} width={220} value={current} options={options} placeholder={state.loading ? t.common.loading : t.form.select}
        disabled={context.readOnly === true} onChange={(next) => { onChange(JSON.parse(next) as Json) }} />
      {refresh}
    </span>
  )
}

/** Monospace JSON preview.
 * @returns pre element.
 */
export function JsonPreview({ value }: { value: unknown }) {
  return <pre className="tw-json">{JSON.stringify(value, null, 2)}</pre>
}

export { Mono }
