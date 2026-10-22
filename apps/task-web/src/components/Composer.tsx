/** Supplemental input of an open Run: text or a form, plus files that upload when the input is sent. */
import { useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import { Button, IconCloseOutlineRegular, IconPaperclipOutlineRegular, IconSendOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { useApp } from '../app/context.tsx'
import { commandKey, describeFailure } from '../support/connection.ts'
import { carriedFiles, textNamesFiles, useDrafts, type FileCarrier } from '../support/drafts.ts'
import { bytes, failureText, fileKind } from '../support/format.ts'
import { sendOnEnter } from '../support/keys.ts'
import type { Json, Run } from '../support/types.ts'
import { hasFormControls, SchemaForm, schemaDefault } from './SchemaForm.tsx'

/** Tallest the supplemental input grows, in px, before it scrolls. */
const COMPOSER_MAX_PX = 240

/** Supplemental input box of an open Run. Files from the picker, a paste or a drop wait as thumbnails or file cards and upload
 * together with the input, so a file chosen by mistake can still be removed.
 * @param props.run - open execution; remount per Run so text and files never carry over.
 * @param props.onSent - refresh after the input was accepted.
 * @param props.onUploaded - refresh after files were stored.
 * @param props.footer - content under the box.
 * @returns the input box.
 */
export function Composer({ run, onSent, onUploaded, footer }: { run: Run; onSent: () => void; onUploaded: () => void; footer: ReactNode }) {
  const t = useT()
  const { connection, toast } = useApp()
  const schema = run.supplementalInputSchema
  const structured = schema !== null && schema['type'] !== 'string' && hasFormControls(schema)
  const [text, setText] = useState('')
  const [form, setForm] = useState<Json>(() => (schema === null ? null : schemaDefault(schema, schema)))
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(commandKey)
  const [over, setOver] = useState(false)
  const area = useRef<HTMLTextAreaElement | null>(null)
  const { drafts, add, drop, uploadKey } = useDrafts()
  const blocked = run.status === 'blocked'
  const hasInput = structured || text.trim() !== ''
  useLayoutEffect(() => {
    const node = area.current
    if (node === null) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight + node.offsetHeight - node.clientHeight, COMPOSER_MAX_PX)}px`
  }, [text])
  /** Take the files of a paste or drop into the drafts.
   * @returns the files taken.
   */
  const intake = (data: FileCarrier): readonly File[] => {
    const { files, directories } = carriedFiles(data)
    if (directories > 0) toast(t.run.draft.directory, 'error')
    if (files.length > 0) add(files)
    return files
  }
  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = intake(event.clipboardData)
    if (files.length > 0 && textNamesFiles(event.clipboardData.getData('text/plain'), files)) event.preventDefault()
  }
  const dragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setOver(true)
  }
  const dragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
  }
  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setOver(false)
    intake(event.dataTransfer)
  }
  /** Upload the drafts, then send the input; each failure keeps what has not been stored or accepted. */
  const deliver = async () => {
    const staged = drafts
    let stored = 0
    if (staged.length > 0) {
      try {
        stored = (await connection.guard(() => connection.client.upload(run.id, staged.map(draft => draft.file), uploadKey()))).length
      } catch (error) {
        toast(`${t.run.files.uploadFailed}：${failureText(describeFailure(error), t)}`, 'error')
        return
      }
      drop(new Set(staged.map(draft => draft.id)))
      onUploaded()
    }
    if (!hasInput) {
      toast(t.run.files.uploaded(stored))
      return
    }
    const input: Json = structured ? form : text.trim()
    try {
      await connection.call('sendInput', { params: { runId: run.id }, body: { input }, idempotencyKey: key })
    } catch (error) {
      toast(`${t.run.sendFailed}：${failureText(describeFailure(error), t)}`, 'error')
      return
    }
    toast(stored === 0 ? t.run.sent : t.run.sentWithFiles(stored))
    setText('')
    setForm(schema === null ? null : schemaDefault(schema, schema))
    setKey(commandKey())
    onSent()
    area.current?.focus()
  }
  const send = () => {
    if (busy || (!hasInput && drafts.length === 0)) return
    setBusy(true)
    void deliver().finally(() => { setBusy(false) })
  }
  const sendLabel = !hasInput ? t.run.upload : blocked ? t.run.wake : t.run.send
  return (
    <div className="tw-composer-wrap">
      <div className="tw-composer" data-over={over || undefined} onPaste={paste} onDragOver={dragOver} onDragLeave={dragLeave}
        onDrop={dropFiles}>
        <div className="tw-composer-title"><span className="tw-strong">{t.run.composerLabel}</span><span className="tw-muted-small">{t.run.composerHint}</span></div>
        {structured
          ? <div className="tw-composer-form"><SchemaForm schema={schema} value={form} onChange={setForm} layout="stack" /></div>
          : <textarea ref={area} className="tw-composer-input" aria-label={t.run.composerLabel} rows={3}
            placeholder={blocked ? t.run.composerBlocked : t.run.composer} value={text}
            onChange={(event) => { setText(event.target.value) }} onKeyDown={sendOnEnter(send)} />}
        {drafts.length > 0 && (
          <ul className="tw-drafts" aria-label={t.run.draft.label}>
            {drafts.map(draft => (
              <li key={draft.id} className={draft.preview === null ? 'tw-draft tw-draft-file' : 'tw-draft tw-draft-image'}
                data-sending={busy || undefined}>
                {draft.preview === null
                  ? (
                    <>
                      <span className="tw-file-kind" aria-hidden="true">{fileKind(draft.file.name)}</span>
                      <span className="tw-file-text"><span className="tw-file-name">{draft.file.name}</span><span
                        className="tw-muted-small">{bytes(draft.file.size)}</span></span>
                    </>
                  )
                  : <img src={draft.preview} alt={draft.file.name} title={draft.file.name} />}
                <button type="button" className="tw-draft-remove" aria-label={t.run.draft.remove(draft.file.name)} disabled={busy}
                  onClick={() => { drop(new Set([draft.id])) }}><IconCloseOutlineRegular size={12} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="tw-composer-bar">
          <div className="tw-inline-flex tw-gap-8">
            <label className="tw-attach" title={t.run.upload}>
              <IconPaperclipOutlineRegular size={14} /><span>{t.run.attach}</span>
              <input type="file" multiple hidden aria-label={t.run.upload}
                onChange={(event) => { add([...(event.target.files ?? [])]); event.target.value = '' }} />
            </label>
            {drafts.length > 0
              ? <span className="tw-muted-small">{busy ? t.run.files.uploading(drafts.length) : t.run.draft.hint}</span>
              : !structured && <span className="tw-muted-small tw-send-keys">{t.run.sendKeys}</span>}
          </div>
          <Button variant="primary" size="sm" icon={<IconSendOutlineRegular size={14} />} disabled={busy || (!hasInput && drafts.length === 0)}
            onClick={send}>{sendLabel}</Button>
        </div>
      </div>
      {footer}
    </div>
  )
}
