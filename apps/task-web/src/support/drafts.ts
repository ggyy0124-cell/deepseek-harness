/** Files a person chose for a Run's supplemental input and has not sent yet. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { commandKey } from './connection.ts'

/** One chosen file. */
export interface Draft {
  /** Identity among the drafts of one composer. */
  readonly id: number
  readonly file: File
  /** Object URL of an image the browser can show; null for other files. Released when the draft is dropped. */
  readonly preview: string | null
}

/** Image types shown as thumbnails; other files appear as file cards. */
const THUMBNAIL_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** Files of a paste or drop with the number of directories left out. */
export interface Carried {
  readonly files: readonly File[]
  readonly directories: number
}

/** The part of `DataTransfer` that {@link carriedFiles} reads. */
export interface FileCarrier {
  readonly items: ArrayLike<{
    readonly kind: string
    getAsFile(): File | null
    webkitGetAsEntry(): { readonly isDirectory: boolean } | null
  }>
  readonly files: ArrayLike<File>
}

/** Read the files of a paste or drop, leaving directories out. Call it synchronously inside the event handler: the browser empties
 * the transfer afterwards.
 * @param data - clipboard or drag data.
 * @returns the files and how many directories were skipped.
 */
export function carriedFiles(data: FileCarrier): Carried {
  const items = Array.from(data.items).filter(item => item.kind === 'file')
  if (items.length === 0) return { files: Array.from(data.files), directories: 0 }
  const files: File[] = []
  let directories = 0
  for (const item of items) {
    if (item.webkitGetAsEntry()?.isDirectory === true) directories += 1
    else {
      const file = item.getAsFile()
      if (file !== null) files.push(file)
    }
  }
  return { files, directories }
}

/** Whether a paste that carries files should not also insert its text: a copied file puts its own name on the clipboard as text.
 * @param text - plain text of the clipboard.
 * @param files - files of the same paste.
 * @returns true when the text is empty or only names the files.
 */
export function textNamesFiles(text: string, files: readonly File[]): boolean {
  const names = new Set(files.map(file => file.name))
  return text.split(/\r?\n/u).every(line => line.trim() === '' || names.has(line.trim()))
}

function release(draft: Draft): void {
  if (draft.preview !== null) URL.revokeObjectURL(draft.preview)
}

/** Drafts of one composer.
 * @returns the drafts, intake and removal, and the idempotency key of the current set.
 */
export function useDrafts(): {
  drafts: readonly Draft[]
  add: (files: readonly File[]) => void
  drop: (ids: ReadonlySet<number>) => void
  uploadKey: () => string
} {
  const [drafts, setDrafts] = useState<readonly Draft[]>([])
  const latest = useRef<readonly Draft[]>(drafts)
  const sequence = useRef(0)
  const batch = useRef<string | null>(null)
  const publish = useCallback((next: readonly Draft[]) => {
    latest.current = next
    batch.current = null
    setDrafts(next)
  }, [])
  const add = useCallback((files: readonly File[]) => {
    if (files.length === 0) return
    const made = files.map((file): Draft => ({
      id: sequence.current++, file, preview: THUMBNAIL_TYPES.has(file.type) ? URL.createObjectURL(file) : null,
    }))
    publish([...latest.current, ...made])
  }, [publish])
  const drop = useCallback((ids: ReadonlySet<number>) => {
    for (const draft of latest.current) if (ids.has(draft.id)) release(draft)
    publish(latest.current.filter(draft => !ids.has(draft.id)))
  }, [publish])
  const uploadKey = useCallback(() => (batch.current ??= commandKey()), [])
  useEffect(() => () => { for (const draft of latest.current) release(draft) }, [])
  return { drafts, add, drop, uploadKey }
}
