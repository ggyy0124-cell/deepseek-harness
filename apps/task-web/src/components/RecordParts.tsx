/** Parts of the record inspector shared by its message, tool call and request views. */
import { useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronRightOutlineRegular, JsonTree, type JsonTreeLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { formatInstant } from '../support/format.ts'
import { preferences } from '../support/preferences.ts'
import { useStore } from '../support/store.ts'
import type { Run, TranscriptEntry } from '../support/types.ts'
import { Clamp } from './Clamp.tsx'
import { BlockChip } from './Transcript.tsx'

/** Height in px at which an overview preview collapses behind an expand control. */
const PREVIEW_CLAMP_PX = 160

/** Copy of the JSON tree's menus and buttons.
 * @returns labels in the interface language, stable while the language is.
 */
export function useJsonLabels(): JsonTreeLabels {
  const copy = useT().run.trajectory.json
  return useMemo(() => ({
    copyValue: copy.copyValue, copyJson: copy.copyJson, copyPath: copy.copyPath, copyPrettyJson: copy.copyPrettyJson,
    copyCompactJson: copy.copyCompactJson, copied: copy.copied, copyFailed: copy.copyFailed, collapseNode: copy.collapse,
    expandNode: copy.expand, copyButtonTitle: copy.copyHint,
  }), [copy])
}

/** JSON object or array as an expandable tree.
 * @param props.data - parsed JSON container.
 * @param props.label - accessible name of the tree.
 * @param props.preview - show fewer lines of long strings, for an overview section.
 * @param props.failed - tint the tree as an error result.
 * @returns the tree.
 */
export function JsonView({ data, label, preview = false, failed = false }: {
  data: object
  label: string
  preview?: boolean
  failed?: boolean
}) {
  const labels = useJsonLabels()
  return <JsonTree data={data} label={label} labels={labels} collapsedStringLines={preview ? 3 : 12} className={clsx('tw-detail-json', failed && 'tw-detail-failed')} />
}

/** Row value that opens another record, request or tab.
 * @param props.children - what the link names.
 * @param props.onClick - called when the link is chosen.
 * @returns text button with a trailing chevron.
 */
export function JumpLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="tw-detail-link" onClick={onClick}>
      <span>{children}</span>
      <IconChevronRightOutlineRegular size={11} />
    </button>
  )
}

/** Overview section: a heading that opens the matching tab above a clamped preview of its content.
 * @param props.label - section name, which is also the name of the tab it opens.
 * @param props.onOpen - opens the tab.
 * @param props.children - preview content.
 * @returns the section.
 */
export function DetailSection({ label, onOpen, children }: { label: string; onOpen: () => void; children: ReactNode }) {
  return (
    <div className="tw-detail-section">
      <h3 className="tw-detail-heading">
        <button type="button" className="tw-detail-title" onClick={onOpen}>
          <span>{label}</span>
          <IconChevronRightOutlineRegular size={12} />
        </button>
      </h3>
      <Clamp maxHeight={PREVIEW_CLAMP_PX}>{children}</Clamp>
    </div>
  )
}

/** Muted line for a missing value.
 * @param props.children - the explanation.
 * @returns paragraph.
 */
export function Missing({ children }: { children: ReactNode }) {
  return <p className="tw-muted-line">{children}</p>
}

/** Time an operation started; a click switches between the date and the Unix timestamp.
 * @param props.at - epoch milliseconds, or null when the log lacks the start.
 * @returns the time as a button, or the note that it is unavailable.
 */
export function StartedAt({ at }: { at: number | null }) {
  const copy = useT().run.trajectory.timing
  const [unix, setUnix] = useState(false)
  useStore(preferences)
  if (at === null) return <>{copy.notAvailable}</>
  return (
    <button type="button" className="tw-detail-stamp" title={unix ? copy.showLocalTime : copy.showUnixTimestamp}
      onClick={() => { setUnix(current => !current) }}>
      {unix ? (at / 1000).toFixed(3) : formatInstant(at)}
    </button>
  )
}

/** Download chips of the images and files a message carries.
 * @param props.run - execution that owns the attachments.
 * @param props.entry - stored message.
 * @returns the chips, or nothing without attachments.
 */
export function Files({ run, entry }: { run: Pick<Run, 'id'>; entry: TranscriptEntry }) {
  const files = entry.blocks.map((block, index) => ({ block, index })).filter(item => item.block.kind === 'image' || item.block.kind === 'file')
  if (files.length === 0) return null
  return <div className="tw-chip-row">{files.map(item => <BlockChip key={item.index} run={run} entry={entry} block={item.block} index={item.index} />)}</div>
}
