/** Colored label of a trajectory record's kind. */
import { useT } from '../i18n/index.ts'
import { kindLabel } from '../support/presentation.ts'
import type { TrajectoryRecord } from '../support/trajectory.ts'

/** Kind of a record as a tag; a failed tool call is tinted as an error.
 * @param props.record - table row.
 * @returns the tag.
 */
export function KindTag({ record }: { record: TrajectoryRecord }) {
  const t = useT()
  return (
    <span className="tw-kind" data-kind={record.kind} data-failed={(record.kind === 'tool' && record.failed) || undefined}>
      {kindLabel(record, t)}
    </span>
  )
}
