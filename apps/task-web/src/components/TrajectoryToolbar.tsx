/** Toolbar above the trajectory timeline: axis choice, fold buttons and search. */
import { IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'

/** Foldable parts of the ledger and whether all of them are folded. */
interface Fold {
  readonly folded: boolean
  readonly onToggle: () => void
}

/** Toolbar of the trajectory.
 * @param props.recorded - the timeline sizes blocks by recorded duration instead of equal widths.
 * @param props.onRecorded - axis chosen.
 * @param props.turns - fold state of the turns.
 * @param props.calls - fold state of the tool calls under each request.
 * @param props.query - search text.
 * @param props.onQuery - search text changed.
 * @returns buttons for 时长, 轮次 and 调用, and the search field.
 */
export function TrajectoryToolbar({ recorded, onRecorded, turns, calls, query, onQuery }: {
  recorded: boolean
  onRecorded: (recorded: boolean) => void
  turns: Fold
  calls: Fold
  query: string
  onQuery: (query: string) => void
}) {
  const t = useT()
  const copy = t.run.trajectory.toolbar
  const fold = (label: string, expand: string, collapse: string, state: Fold) => (
    <button type="button" className="tw-traj-button" aria-pressed={state.folded} aria-label={state.folded ? expand : collapse}
      title={state.folded ? expand : collapse} onClick={state.onToggle}>
      {state.folded ? <IconChevronRightOutlineRegular size={12} /> : <IconChevronDownOutlineRegular size={12} />}
      {label}
    </button>
  )
  return (
    <div role="toolbar" aria-label={copy.label} className="tw-traj-toolbar">
      <div className="tw-traj-actions">
        <button type="button" className="tw-traj-button" aria-pressed={recorded} aria-label={copy.recordedDuration}
          title={recorded ? copy.equalWidth : copy.recordedDuration} onClick={() => { onRecorded(!recorded) }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="4.75" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 3.4V6l1.8 1.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {copy.duration}
        </button>
        {fold(copy.turns, copy.expandTurns, copy.collapseTurns, turns)}
        {fold(copy.calls, copy.expandCalls, copy.collapseCalls, calls)}
      </div>
      <label className="tw-traj-search">
        <IconSearchOutlineRegular size={14} />
        <input type="search" className="tw-input" aria-label={copy.search} placeholder={copy.searchPlaceholder} value={query}
          onChange={(event) => { onQuery(event.target.value) }} />
      </label>
    </div>
  )
}
