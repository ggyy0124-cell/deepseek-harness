/** Run attachment list, downloads and uploads. */
import { useRef, useState, type DragEvent } from 'react'
import { IconDownloadOutlineRegular, IconPaperclipOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { useApp } from '../app/context.tsx'
import { commandKey, describeFailure } from '../support/connection.ts'
import { bytes, failureText } from '../support/format.ts'
import { saveBlob } from '../support/download.ts'
import type { Attachment, Run } from '../support/types.ts'
import { IconButton, Time } from './ui.tsx'

/** Upload files to a Run with one idempotency key per selection.
 * @param run - owning execution.
 * @param onUploaded - refresh after success.
 * @returns upload command and progress.
 */
export function useUpload(run: Pick<Run, 'id'>, onUploaded: () => void): { upload: (files: readonly File[]) => void; uploading: number } {
  const t = useT()
  const { connection, toast } = useApp()
  const [uploading, setUploading] = useState(0)
  const upload = (files: readonly File[]) => {
    if (files.length === 0) return
    setUploading(files.length)
    const key = commandKey()
    connection.guard(() => connection.client.upload(run.id, files, key)).then(
      (items) => { toast(t.run.files.uploaded(items.length)); onUploaded() },
      (error: unknown) => { toast(`${t.run.files.uploadFailed}：${failureText(describeFailure(error), t)}`, 'error') },
    ).finally(() => { setUploading(0) })
  }
  return { upload, uploading }
}

/** Attachment tab.
 * @param props.run - owning execution.
 * @param props.items - attachment metadata.
 * @param props.canUpload - whether the Run accepts new files.
 * @param props.closedText - explanation shown when uploads are closed.
 * @returns upload zone and list.
 */
export function AttachmentsPanel({ run, items, canUpload, closedText, onChanged }: {
  run: Run
  items: readonly Attachment[]
  canUpload: boolean
  closedText: string
  onChanged: () => void
}) {
  const t = useT()
  const { connection, toast } = useApp()
  const { upload, uploading } = useUpload(run, onChanged)
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setOver(false)
    if (canUpload) upload([...event.dataTransfer.files])
  }
  return (
    <div className="tw-stack-12">
      {canUpload
        ? (
          <div className={over ? 'tw-dropzone tw-over' : 'tw-dropzone'} onDragOver={(event) => { event.preventDefault(); setOver(true) }}
            onDragLeave={() => { setOver(false) }} onDrop={drop}>
            <IconPaperclipOutlineRegular size={16} />
            {uploading > 0
              ? <span>{t.run.files.uploading(uploading)}</span>
              : <span>{t.run.files.drop}<button type="button" className="tw-text-button" onClick={() => { input.current?.click() }}>{t.run.files.choose}</button>{t.run.files.limit}</span>}
            <input ref={input} type="file" multiple hidden onChange={(event) => { upload([...(event.target.files ?? [])]); event.target.value = '' }} />
          </div>
        )
        : <div className="tw-closed-note">{closedText}；{t.run.files.keep}</div>}
      {items.length === 0 && <p className="tw-muted-line">{t.run.files.empty}</p>}
      <div className="tw-attachment-list">
        {items.map(item => (
          <div key={item.id} className="tw-attachment-row">
            <span className="tw-file-kind" aria-hidden="true">{(item.name.split('.').pop() ?? '').slice(0, 4).toUpperCase()}</span>
            <span className="tw-attachment-text">
              <span>{item.name}</span>
              <span className="tw-muted-small">{item.mime} · {bytes(item.size)} · {t.run.files.sha} {item.digest.slice(0, 8)}…</span>
            </span>
            <span className="tw-muted-small"><Time value={item.createdAt} /></span>
            <IconButton label={t.run.files.download(item.name)} icon={<IconDownloadOutlineRegular size={16} />}
              onClick={() => { connection.guard(() => connection.client.download(run.id, item.id)).then((blob) => { saveBlob(blob, item.name) }, () => { toast(t.run.files.downloadFailed, 'error') }) }} />
          </div>
        ))}
      </div>
    </div>
  )
}
