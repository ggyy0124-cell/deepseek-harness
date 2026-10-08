/** Reply cards for business waits, tool approvals and Agent questions. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconQuestionOutlineRegular, IconRefreshOutlineRegular, IconWarningTriangleOutlineRegular, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { useApp } from '../app/context.tsx'
import { commandKey, describeFailure, isProblem } from '../support/connection.ts'
import { bytes, failureText, formatTime, relative } from '../support/format.ts'
import { saveBlob } from '../support/download.ts'
import { sendOnEnter } from '../support/keys.ts'
import type { Attachment, Interaction, Json } from '../support/types.ts'
import { Clamp } from './Clamp.tsx'
import { Markdown } from './markdown.tsx'
import { hasEnterField, hasFormControls, resolveSchema, SchemaForm, schemaChoices, schemaDefault, type SchemaNode } from './SchemaForm.tsx'
import { FileChip, argumentSummary } from './Transcript.tsx'

/** Height in px at which a long card body collapses behind an expand control. */
const BODY_CLAMP_PX = 200

type Choice = { value: Json; label: string; description?: string | undefined }
type ReplyMode =
  | { readonly kind: 'choices'; readonly choices: readonly Choice[] }
  | { readonly kind: 'choice-object'; readonly key: string; readonly choices: readonly Choice[]; readonly notes: readonly string[] }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'text' }
  | { readonly kind: 'form' }

/** Choose the reply control of a business wait from its response schema.
 * @param schema - response schema.
 * @returns control kind.
 */
export function replyMode(schema: SchemaNode): ReplyMode {
  const node = resolveSchema(schema, schema)
  if (Object.keys(node).length === 0) return { kind: 'text' }
  const choices = schemaChoices(node)
  if (choices !== undefined) return { kind: 'choices', choices }
  if (node['type'] === 'boolean') return { kind: 'boolean' }
  if (node['type'] === 'string') return { kind: 'text' }
  const properties = node['properties']
  if (node['type'] === 'object' && typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
    const entries = Object.entries(properties).map(([key, value]) => [key, resolveSchema(value as SchemaNode, schema)] as const)
    const choiceEntries = entries.filter(([, value]) => schemaChoices(value) !== undefined)
    const others = entries.filter(([, value]) => schemaChoices(value) === undefined)
    if (choiceEntries.length === 1 && others.every(([, value]) => value['type'] === 'string')) {
      const [key, value] = choiceEntries[0] as readonly [string, SchemaNode]
      return { kind: 'choice-object', key, choices: schemaChoices(value) ?? [], notes: others.map(([name]) => name) }
    }
  }
  return hasFormControls(schema) ? { kind: 'form' } : { kind: 'text' }
}

/** Submit one reply bound to the interaction revision.
 * @returns submit command and state.
 */
function useRespond(interaction: Interaction, onDone: () => void) {
  const t = useT()
  const { connection, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [key] = useState(commandKey)
  const submit = (response: Json) => {
    setBusy(true)
    setError(undefined)
    connection.call('respond', {
      params: { runId: interaction.runId, waitId: interaction.id }, body: { revision: interaction.revision, response }, idempotencyKey: key,
    }).then(() => { toast(t.interaction.replied); onDone() }, (failure: unknown) => {
      if (isProblem(failure, 'stale_interaction', 'not_found', 'read_only', 'invalid_state')) setStale(true)
      else setError(failureText(describeFailure(failure), t))
    }).finally(() => { setBusy(false) })
  }
  return { busy, stale, error, submit }
}

function Strip({ tone, icon, children }: { tone: 'warning'; icon: ReactNode; children: ReactNode }) {
  return <div className={clsx('tw-interaction-strip', `tw-strip-${tone}`)}>{icon}<span>{children}</span></div>
}

function Footer({ left, actions }: { left: ReactNode; actions: ReactNode }) {
  return <div className="tw-interaction-footer"><span className="tw-interaction-meta">{left}</span><div
    className="tw-inline-flex tw-gap-8">{actions}</div></div>
}

function StaleFooter({ onRefresh }: { onRefresh: () => void }) {
  const t = useT()
  return <Footer left={<span className="tw-danger-text">{t.interaction.stale}</span>}
    actions={<Button variant="primary" icon={<IconRefreshOutlineRegular size={16} />}
      onClick={onRefresh}>{t.interaction.viewLatest}</Button>} />
}

/** Card for any interaction source.
 * @param props.interaction - waiting interaction.
 * @param props.runName - display name of the owning Run.
 * @param props.onDone - called after a reply or when the card must refresh.
 * @param props.callArguments - tool call arguments from the transcript, when known.
 * @returns card element.
 */
export function InteractionCard({ interaction, runName, onDone, callArguments }: {
  interaction: Interaction
  runName: string
  onDone: () => void
  callArguments?: string | undefined
}) {
  switch (interaction.source) {
    case 'business': return <BusinessCard interaction={interaction} runName={runName} onDone={onDone} />
    case 'tool_approval': return <ToolApprovalCard interaction={interaction} onDone={onDone} callArguments={callArguments} />
    case 'agent_question': return <QuestionCard interaction={interaction} onDone={onDone} />
  }
}

function BusinessCard({ interaction, runName, onDone }: { interaction: Interaction; runName: string; onDone: () => void }) {
  const t = useT()
  const { connection, toast } = useApp()
  const schema = interaction.schema as SchemaNode
  const mode = useMemo(() => replyMode(schema), [schema])
  const { busy, stale, error, submit } = useRespond(interaction, onDone)
  const [choice, setChoice] = useState<number | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [text, setText] = useState('')
  const [form, setForm] = useState<Json>(() => schemaDefault(schema, schema))
  const attachments = useAttachments(interaction)
  const expires = interaction.expiresAt
  const strip = [t.interaction.businessStrip(runName), expires === null ? undefined
    : Date.parse(expires) < Date.now() ? t.interaction.expired : t.interaction.expires(relative(expires, t))].filter(Boolean).join(' · ')
  const send = () => {
    switch (mode.kind) {
      case 'choices': { const item = choice === null ? undefined
        : mode.choices[choice]; if (item !== undefined) submit(item.value); return }
      case 'choice-object': {
        const item = choice === null ? undefined : mode.choices[choice]
        if (item === undefined) return
        const body: Record<string, Json> = { [mode.key]: item.value }
        for (const note of mode.notes) if ((notes[note] ?? '') !== '') body[note] = notes[note] ?? ''
        submit(body)
        return
      }
      case 'boolean': return
      case 'text': submit(text); return
      case 'form': submit(form)
    }
  }
  const ready = mode.kind === 'choices' || mode.kind === 'choice-object' ? choice !== null : mode.kind === 'text' ? text.trim() !== ''
    : true
  // Enter in a reply text box does what the reply button does, so it sends nothing before a choice is made or while a reply is in flight.
  // A form reply (a decision, editable fields and a note) sends from its top-level multiline fields;
  // fields inside groups keep Enter as a line break.
  const sendIfReady = () => { if (!busy && ready) send() }
  const onKeyDown = sendOnEnter(sendIfReady)
  const typed = mode.kind === 'text' || (mode.kind === 'choice-object' && mode.notes.length > 0)
    || (mode.kind === 'form' && hasEnterField(schema))
  return (
    <section aria-label={t.source.business} className="tw-interaction">
      <Strip tone="warning" icon={<IconQuestionOutlineRegular size={16} />}>{strip}</Strip>
      <div className="tw-interaction-head">
        <h3>{interaction.title}</h3>
        {interaction.description !== '' && (
          <div className="tw-interaction-body"><Clamp maxHeight={BODY_CLAMP_PX}><Markdown text={interaction.description} compact /></Clamp></div>
        )}
        {attachments.length > 0 && (
          <div className="tw-chip-row">
            {attachments.map(item => (
              <FileChip key={item.id} name={item.name} detail={`${item.mime} · ${bytes(item.size)}`} label={t.run.files.download(item.name)}
                onClick={() => { connection.guard(() => connection.client.download(item.runId, item.id)).then((blob) => { saveBlob(blob,
                  item.name) }, () => { toast(t.run.files.downloadFailed, 'error') }) }} />
            ))}
          </div>
        )}
      </div>
      {!stale && (mode.kind === 'choices' || mode.kind === 'choice-object') && (
        <OptionList choices={mode.choices} selected={choice === null ? [] : [choice]} onToggle={(index) => { setChoice(index) }} />
      )}
      {!stale && mode.kind === 'choice-object' && mode.notes.map(note => (
        <div key={note} className="tw-interaction-field">
          <textarea className="tw-textarea" rows={2} aria-label={t.interaction.note} placeholder={t.interaction.note}
            value={notes[note] ?? ''} onChange={(event) => { setNotes(current => ({ ...current, [note]: event.target.value })) }}
            onKeyDown={onKeyDown} />
        </div>
      ))}
      {!stale && mode.kind === 'text' && (
        <div className="tw-interaction-field">
          <textarea className="tw-textarea" rows={3} aria-label={t.interaction.answerPlaceholder}
            placeholder={t.interaction.answerPlaceholder}
            value={text} onChange={(event) => { setText(event.target.value) }} onKeyDown={onKeyDown} />
        </div>
      )}
      {!stale && mode.kind === 'form' && (
        <div className="tw-interaction-field"><SchemaForm schema={schema} value={form} onChange={setForm} layout="stack" context={{ onEnter: sendIfReady }} /></div>
      )}
      {error !== undefined && <p className="tw-interaction-error" role="alert">{error}</p>}
      {stale
        ? <StaleFooter onRefresh={onDone} />
        : <Footer left={typed ? `${t.interaction.revision(interaction.revision)} · ${t.interaction.sendKeys}` : t.interaction.revision(interaction.revision)}
          actions={mode.kind === 'boolean'
            ? <>
              <Button variant="outline" disabled={busy} onClick={() => { submit(false) }}>{t.interaction.reject}</Button>
              <Button variant="primary" disabled={busy} onClick={() => { submit(true) }}>{t.interaction.approve}</Button>
            </>
            : <Button variant="primary" disabled={busy || !ready} onClick={send}>{t.interaction.reply}</Button>} />}
    </section>
  )
}

function useAttachments(interaction: Interaction): readonly Attachment[] {
  const { connection } = useApp()
  const [items, setItems] = useState<readonly Attachment[]>([])
  const ids = interaction.attachments.join(',')
  useEffect(() => {
    if (ids === '') { setItems([]); return }
    let live = true
    const wanted = new Set(ids.split(','))
    connection.guard(() => connection.client.attachments(interaction.runId)).then((all) => {
      if (live) setItems(all.filter(item => wanted.has(item.id)))
    }, () => { if (live) setItems([]) })
    return () => { live = false }
  }, [connection, interaction.runId, ids])
  return items
}

function OptionList({ choices, selected,
  onToggle }: { choices: readonly Choice[]; selected: readonly number[]; onToggle: (index: number) => void }) {
  return (
    <div className="tw-option-list" role="listbox" aria-multiselectable={false}>
      {choices.map((item, index) => (
        <button key={`${index}-${item.label}`} type="button" role="option" aria-selected={selected.includes(index)}
          className={clsx('tw-option', selected.includes(index) && 'tw-selected')} onClick={() => { onToggle(index) }}>
          <span className="tw-option-index">{index + 1}</span>
          <span className="tw-option-text"><span className="tw-option-label">{item.label}</span>
            {item.description !== undefined && item.description !== '' && <span className="tw-option-desc">{item.description}</span>}</span>
        </button>
      ))}
    </div>
  )
}

function ToolApprovalCard({ interaction, onDone,
  callArguments }: { interaction: Interaction; onDone: () => void; callArguments?: string | undefined }) {
  const t = useT()
  const { busy, stale, error, submit } = useRespond(interaction, onDone)
  return (
    <section aria-label={t.source.tool_approval} className="tw-interaction tw-interaction-tool">
      <Strip tone="warning" icon={<IconWarningTriangleOutlineRegular size={14} />}>{t.interaction.toolStrip}</Strip>
      <div className="tw-interaction-head">
        <span className="tw-interaction-title">{interaction.title}</span>
        {callArguments !== undefined && <span className="tw-mono tw-muted-text tw-break">{argumentSummary(callArguments)}</span>}
        {interaction.description !== '' && <Clamp maxHeight={BODY_CLAMP_PX}><span className="tw-secondary-text">{interaction.description}</span></Clamp>}
      </div>
      {error !== undefined && <p className="tw-interaction-error" role="alert">{error}</p>}
      {stale
        ? <StaleFooter onRefresh={onDone} />
        : <Footer left={`${t.interaction.toolHint} · ${formatTime(interaction.createdAt)}`} actions={<>
          <Button variant="outline" disabled={busy} onClick={() => { submit('rejected') }}>{t.interaction.reject}</Button>
          <Button variant="primary" disabled={busy} onClick={() => { submit('allowed-once') }}>{t.interaction.allowOnce}</Button>
        </>} />}
    </section>
  )
}

function QuestionCard({ interaction, onDone }: { interaction: Interaction; onDone: () => void }) {
  const t = useT()
  const { busy, stale, error, submit } = useRespond(interaction, onDone)
  const questions = interaction.questions ?? []
  const [selected, setSelected] = useState<Record<string, readonly number[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const answers = questions.map(question => ({
    id: question.id,
    selected: (selected[question.id] ?? []).map(index => question.options[index]?.label ?? '').filter(label => label !== ''),
    ...(custom[question.id]?.trim() ? { custom: custom[question.id]?.trim() ?? '' } : {}),
  }))
  const ready = questions.every((question, index) => {
    const answer = answers[index]
    return answer !== undefined && (answer.selected.length > 0 || 'custom' in answer || question.options.length === 0)
  })
  return (
    <section aria-label={t.source.agent_question} className="tw-interaction">
      <Strip tone="warning" icon={<IconQuestionOutlineRegular size={16} />}>{t.interaction.questionStrip}</Strip>
      {questions.map(question => (
        <div key={question.id} className="tw-question">
          <div className="tw-interaction-head">
            {question.header !== null && <span className="tw-question-header"><Tag tone="neutral">{question.header}</Tag></span>}
            <h3>{question.question}</h3>
            {question.detail !== null && <Clamp maxHeight={BODY_CLAMP_PX}><span className="tw-secondary-text">{question.detail}</span></Clamp>}
          </div>
          {!stale && question.options.length > 0 && (
            <OptionList choices={question.options.map(option => ({ value: option.label, label: option.label,
              description: option.description ?? undefined }))}
            selected={selected[question.id] ?? []}
            onToggle={(index) => {
              setSelected((current) => {
                const list = current[question.id] ?? []
                const next = question.multiSelect ? (list.includes(index) ? list.filter(item => item !== index) : [...list, index])
                  : [index]
                return { ...current, [question.id]: next }
              })
            }} />
          )}
          {!stale && (
            <div className="tw-interaction-field">
              <input type="text" className="tw-input tw-input-full" aria-label={t.interaction.custom}
                placeholder={t.interaction.customPlaceholder}
                value={custom[question.id] ?? ''} onChange={(event) => { setCustom(current => ({ ...current,
                  [question.id]: event.target.value })) }} />
            </div>
          )}
        </div>
      ))}
      {questions.length === 0 && <div className="tw-interaction-head"><h3>{interaction.title}</h3><span
        className="tw-secondary-text">{interaction.description}</span></div>}
      {error !== undefined && <p className="tw-interaction-error" role="alert">{error}</p>}
      {stale
        ? <StaleFooter onRefresh={onDone} />
        : <Footer left={formatTime(interaction.createdAt)} actions={<Button variant="primary" disabled={busy || !ready}
          onClick={() => { submit({ answers }) }}>{t.interaction.submitAnswer}</Button>} />}
    </section>
  )
}
