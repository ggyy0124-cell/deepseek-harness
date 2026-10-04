/** Rendering of `task-result/v1` documents and opaque Run results. */
import { useEffect, useState } from 'react'
import { resultDocumentSchema } from '@deepseek-ai/dsh-task-api-protocol'
import { useT } from '../i18n/index.ts'
import { useApp } from '../app/context.tsx'
import { bytes } from '../support/format.ts'
import { saveBlob } from '../support/download.ts'
import type { Attachment, ResultDocument, Run } from '../support/types.ts'
import { Markdown } from './markdown.tsx'
import { FileChip } from './Transcript.tsx'
import { JsonPreview } from './SchemaForm.tsx'

type ResultBlock = ResultDocument['blocks'][number]

/** Parse a Run result as a structured document.
 * @param value - stored result.
 * @returns document, or undefined for other values.
 */
export function resultDocument(value: unknown): ResultDocument | undefined {
  const parsed = resultDocumentSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** Result blocks of a Run.
 * @param props.run - ended or settling Run.
 * @param props.attachments - Run attachments referenced by image and file blocks.
 * @returns block list.
 */
export function ResultView({ run, attachments }: { run: Run; attachments: readonly Attachment[] }) {
  const t = useT()
  const document = resultDocument(run.result)
  if (document === undefined) {
    if (run.result === null) return <p className="tw-muted-line">{t.run.noResultValue}</p>
    if (typeof run.result === 'string') return <div className="tw-result-block"><Markdown text={run.result} /></div>
    return <ResultBlockFrame label="json"><JsonPreview value={run.result} /></ResultBlockFrame>
  }
  return (
    <div className="tw-stack-16">
      {document.blocks.map((block, index) => <ResultBlockView key={index} run={run} block={block} attachments={attachments} />)}
    </div>
  )
}

function ResultBlockFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="tw-result-block"><span className="tw-result-label">{label}</span>{children}</div>
}

function ResultBlockView({ run, block, attachments }: { run: Run; block: ResultBlock; attachments: readonly Attachment[] }) {
  switch (block.kind) {
    case 'text': return <ResultBlockFrame label="text"><p className="tw-result-text">{block.text}</p></ResultBlockFrame>
    case 'markdown': return <ResultBlockFrame label="markdown"><Markdown text={block.text} /></ResultBlockFrame>
    case 'json': return <ResultBlockFrame label="json"><JsonPreview value={block.value} /></ResultBlockFrame>
    case 'code': return <ResultBlockFrame label={block.language === undefined ? 'code' : `code · ${block.language}`}><pre
      className="tw-code-block">{block.text}</pre></ResultBlockFrame>
    case 'diff': return <ResultBlockFrame label="diff"><DiffView text={block.text} /></ResultBlockFrame>
    case 'table': return (
      <ResultBlockFrame label="table">
        <div className="tw-table-scroll">
          <table className="tw-result-table">
            <thead><tr>{block.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
            <tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td
              key={cellIndex}>{typeof cell === 'string' ? cell : JSON.stringify(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </ResultBlockFrame>
    )
    case 'image':
    case 'file': {
      const attachment = attachments.find(item => item.id === block.attachmentId)
      return <ResultBlockFrame label={block.kind}><AttachmentBlock run={run} kind={block.kind} attachment={attachment}
        id={block.attachmentId} /></ResultBlockFrame>
    }
  }
}

function AttachmentBlock({ run, kind, attachment,
  id }: { run: Run; kind: 'image' | 'file'; attachment: Attachment | undefined; id: string }) {
  const t = useT()
  const { connection, toast } = useApp()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (kind !== 'image') return
    let created: string | null = null
    let live = true
    connection.guard(() => connection.client.download(run.id, id)).then((blob) => {
      if (!live) return
      created = URL.createObjectURL(blob)
      setUrl(created)
    }, () => { /* The figure keeps its placeholder when the image cannot be read. */ })
    return () => { live = false; if (created !== null) URL.revokeObjectURL(created) }
  }, [connection, run.id, id, kind])
  const name = attachment?.name ?? id
  const download = () => {
    connection.guard(() => connection.client.download(run.id, id)).then((blob) => { saveBlob(blob, name) },
      () => { toast(t.run.files.downloadFailed, 'error') })
  }
  if (kind === 'image') {
    return (
      <figure className="tw-result-figure">
        {url === null ? <div className="tw-image-placeholder" /> : <img src={url} alt={name} />}
        <figcaption><button type="button" className="tw-text-button" onClick={download}>{name}</button>{attachment !== undefined
          && ` · ${bytes(attachment.size)}`}</figcaption>
      </figure>
    )
  }
  return <FileChip name={name} detail={attachment === undefined ? '' : `${attachment.mime} · ${bytes(attachment.size)}`}
    onClick={download} label={t.run.files.download(name)} />
}

/** Unified diff with added and removed line backgrounds.
 * @param props.text - unified diff text.
 * @returns diff block.
 */
export function DiffView({ text }: { text: string }) {
  const lines = text.replace(/\n$/, '').split('\n')
  return (
    <div className="tw-diff">
      {lines.map((line, index) => {
        const kind = line.startsWith('+++') || line.startsWith('---') ? 'file' : line.startsWith('@@') ? 'hunk' : line.startsWith('+')
          ? 'add' : line.startsWith('-') ? 'del' : 'context'
        return (
          <div key={index} className="tw-diff-line" data-kind={kind}>
            <span className="tw-diff-sign">{kind === 'add' ? '+' : kind === 'del' ? '−' : ''}</span>
            <span className="tw-diff-text">{kind === 'add' || kind === 'del' ? line.slice(1) : line}</span>
          </div>
        )
      })}
    </div>
  )
}
