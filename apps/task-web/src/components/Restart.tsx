/** Restart action on the result of a failed or cancelled ordinary Run. */
import { useState } from 'react'
import { Button, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { useApp } from '../app/context.tsx'
import { commandKey, describeFailure } from '../support/connection.ts'
import { failureText, shortId } from '../support/format.ts'
import { useResource } from '../support/resource.ts'
import { Link, paths, useRouter } from '../support/router.tsx'
import { isRestartable, type Run } from '../support/types.ts'
import { Card, Notice } from './ui.tsx'

/** Offer to restart a failed or cancelled ordinary Run, or point to the newer Run of the same business key.
 * @param props.run - ended Run shown on the result page.
 * @param props.onRestarted - called once the Task service reserved the new Run, before the page opens it.
 * @returns the restart card, the link to the newer Run, or nothing for other Runs.
 */
export function RestartCard({ run, onRestarted }: { run: Run; onRestarted: () => void }) {
  const t = useT()
  const { connection, toast } = useApp()
  const { navigate } = useRouter()
  const [pending, setPending] = useState(false)
  const restartable = isRestartable(run)
  const newest = useResource(restartable ? `newest:${run.definitionId}:${run.businessKey ?? ''}` : null, async signal => (await connection.call('listRuns',
    { query: { definitionId: run.definitionId, kind: 'ordinary', businessKey: run.businessKey ?? '', limit: '1' }, signal })).items[0],
  { affects: (_runId, event) => event === 'run.reserved' || event === 'run.ended' })
  if (!restartable || newest.value === undefined) return null
  if (newest.value.id !== run.id) {
    return (
      <Notice kind="info" title={t.run.restartNewer}>
        <Link to={paths.run(newest.value.id)} className="tw-link tw-mono">{shortId(newest.value.id)}</Link>
      </Notice>
    )
  }
  const restart = () => {
    setPending(true)
    connection.call('restartRun', { params: { runId: run.id }, idempotencyKey: commandKey() }).then(
      (restarted) => { onRestarted(); navigate(paths.run(restarted.id)) },
      (error: unknown) => {
        setPending(false)
        const failure = describeFailure(error)
        const reason = failure.kind === 'problem' && failure.code === 'invalid_state' ? t.run.restartRejected : failureText(failure, t)
        toast(`${t.run.restartFailed}：${reason}`, 'error')
      },
    )
  }
  return (
    <Card>
      <div className="tw-row-between">
        <span className="tw-muted-small">{t.run.restartBody}</span>
        <Button variant="primary" size="sm" className="tw-page-button" icon={<IconRefreshOutlineRegular size={14} />}
          disabled={pending} onClick={restart}>{t.run.restart}</Button>
      </div>
    </Card>
  )
}
