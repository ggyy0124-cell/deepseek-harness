/** Manual trigger dialog: choose an enabled manual definition and submit its input form. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, IconChevronDownOutlineRegular, IconPlayOutlineRegular, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { useApp, useShared } from '../app/context.tsx'
import { commandKey, describeFailure } from '../support/connection.ts'
import { failureText } from '../support/format.ts'
import { paths, useRouter } from '../support/router.tsx'
import type { Json } from '../support/types.ts'
import { EmptyState, Notice, Tile } from '../components/ui.tsx'
import { hasFormControls, SchemaForm, schemaDefault, validateSchema, type SchemaNode } from '../components/SchemaForm.tsx'

/** Manual trigger dialog.
 * @param props.definitionId - preselected definition.
 * @param props.onClose - close the dialog.
 * @returns modal dialog.
 */
export function TriggerDialog({ definitionId, onClose }: { definitionId?: string | undefined; onClose: () => void }) {
  const t = useT()
  const { connection, toast } = useApp()
  const { definitions, active } = useShared()
  const { navigate } = useRouter()
  const manual = (definitions.value ?? []).filter(item => item.installed && item.enabled && item.config.schedule.kind === 'manual')
  const [selected, setSelected] = useState<string | undefined>(() => manual.find(item => item.id === definitionId)?.id ?? manual[0]?.id)
  const definition = manual.find(item => item.id === selected)
  const schema = (definition?.manualInputSchema ?? {}) as SchemaNode
  const formAvailable = hasFormControls(schema)
  const [values, setValues] = useState<Record<string, Json>>({})
  const [jsonText, setJsonText] = useState<Record<string, string>>({})
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [key, setKey] = useState(commandKey)
  const [attempted, setAttempted] = useState(false)
  const [rejections, setRejections] = useState(0)
  const form = useRef<HTMLDivElement>(null)
  const value: Json = definition === undefined ? null : values[definition.id] ?? schemaDefault(schema, schema)
  const errors = useMemo(() => (formAvailable
    ? validateSchema(schema, value, schema, '', { required: t.common.required, invalid: t.definition.invalid, credential: t.settings.referenceInvalid })
    : new Map<string, string>()), [formAvailable, schema, value, t])
  let jsonInput: Json | undefined = null
  let jsonInvalid = false
  if (!formAvailable && definition !== undefined) {
    const text = jsonText[definition.id] ?? ''
    try { jsonInput = text.trim() === '' ? null : JSON.parse(text) as Json } catch { jsonInvalid = true }
  }
  const submit = () => {
    if (definition === undefined) return
    setAttempted(true)
    if (errors.size > 0 || jsonInvalid) { setRejections(count => count + 1); return }
    setBusy(true)
    setError(undefined)
    connection.call('triggerManual', { params: { definitionId: definition.id }, body: { input: formAvailable ? value : jsonInput ?? null }, idempotencyKey: key })
      .then((run) => { toast(`${t.trigger.submit} · ${definition.title}`); active.reload(); onClose(); navigate(paths.run(run.id)) },
        (failure: unknown) => {
          setError(failureText(describeFailure(failure), t))
          setKey(commandKey())
          setRejections(count => count + 1)
        })
      .finally(() => { setBusy(false) })
  }
  // A long form scrolls under the pinned footer, so a rejected submit brings the first field error or the failure notice into view.
  useEffect(() => {
    if (rejections > 0) form.current?.querySelector('.tw-field-error, .tw-notice')?.scrollIntoView({ block: 'nearest' })
  }, [rejections])
  return (
    <Modal open title={t.trigger.title} closeLabel={t.common.close} backdropBlur={false} onClose={onClose}
      className="tw-dialog-wide" contentClassName="tw-dialog-scroll"
      footer={<>
        <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="primary" disabled={definition === undefined || busy} onClick={submit}>{t.trigger.submit}</Button>
      </>}>
      {manual.length === 0
        ? <EmptyState icon={<IconPlayOutlineRegular size={20} />} title={t.trigger.none}>{t.trigger.noneBody}</EmptyState>
        : (
          <div ref={form} className="tw-stack-16">
            <div className="tw-stack-field">
              <span className="tw-stack-label">{t.trigger.task}</span>
              <Menu open={picker} onClose={() => { setPicker(false) }} portal selectedId={selected}
                items={manual.map(item => ({ id: item.id, label: item.title }))}
                onSelect={(id) => { setPicker(false); setSelected(id); setKey(commandKey()); setError(undefined); setAttempted(false) }}
                anchor={(
                  <button type="button" className="tw-picker" aria-haspopup="menu" aria-expanded={picker} aria-label={t.trigger.pick} onClick={() => { setPicker(open => !open) }}>
                    <Tile size="sm"><IconPlayOutlineRegular size={18} /></Tile>
                    <span className="tw-picker-text"><span className="tw-strong">{definition?.title ?? t.trigger.pick}</span>
                      {definition !== undefined && <span className="tw-muted-small">{t.trigger.hint(definition.id, definition.codeVersion)}</span>}</span>
                    <IconChevronDownOutlineRegular size={14} />
                  </button>
                )} />
            </div>
            {definition !== undefined && (formAvailable
              ? <SchemaForm key={definition.id} schema={schema} value={value} errors={attempted ? errors : undefined} layout="stack"
                onChange={(next) => { setValues(current => ({ ...current, [definition.id]: next })) }} />
              : (
                <div className="tw-stack-field">
                  <label className="tw-stack-label" htmlFor="trigger-json">{t.trigger.jsonInput}</label>
                  <textarea id="trigger-json" className="tw-textarea tw-mono" rows={5} value={jsonText[definition.id] ?? ''}
                    onChange={(event) => { setJsonText(current => ({ ...current, [definition.id]: event.target.value })) }} />
                  {jsonInvalid && <span className="tw-field-error">{t.definition.jsonInvalid}</span>}
                </div>
              ))}
            <p className="tw-footnote">{t.trigger.note}</p>
            {error !== undefined && <Notice kind="error" title={t.trigger.failed}>{error}</Notice>}
          </div>
        )}
    </Modal>
  )
}
