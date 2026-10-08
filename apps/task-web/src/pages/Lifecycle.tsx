/** Definition lifecycle: availability, retirement progress and the retirement confirmation. */
import { useState } from 'react'
import { Button, Checkbox, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { useApp } from '../app/context.tsx'
import { commandKey, describeFailure, isProblem } from '../support/connection.ts'
import { failureText } from '../support/format.ts'
import { useResource } from '../support/resource.ts'
import type { Definition } from '../support/types.ts'
import { Card, Dot, Mono, Notice, SettingsRow, Time } from '../components/ui.tsx'
import { availabilityTone } from './Definitions.tsx'

/** Lifecycle tab of a definition.
 * @param props.definition - definition.
 * @param props.onRetire - open the retirement dialog.
 * @returns tab content.
 */
export function LifecyclePanel({ definition, onRetire }: { definition: Definition; onRetire: () => void }) {
  const t = useT()
  const { connection } = useApp()
  const retirement = useResource(`retirement:${definition.id}`, async (signal) => {
    try {
      return await connection.call('getRetirement', { params: { definitionId: definition.id }, signal })
    } catch (error) {
      if (isProblem(error, 'not_found')) return null
      throw error
    }
  }, { affects: (_runId, event) => event.startsWith('retirement.') || event.startsWith('definition.') })
  const value = retirement.value
  return (
    <Card className="tw-form-card">
      <div className="tw-form-card-head"><h2>{t.definition.lifecycle}</h2></div>
      <SettingsRow label={t.definition.availability}><Tag
        tone={availabilityTone(definition.availability)}>{t.availability[definition.availability]}</Tag></SettingsRow>
      {definition.reason !== null && <SettingsRow label={t.definition.reason}><Mono>{definition.reason}</Mono></SettingsRow>}
      <SettingsRow label={t.definition.retirementState} hint={value === null || value === undefined ? undefined
        : t.definition.stateChangeHint}>
        {value === null || value === undefined
          ? <span className="tw-secondary-text">{t.definition.noRetirement}</span>
          : <Tag tone={value.state === 'complete' ? 'outline' : value.state === 'blocked' ? 'danger'
            : 'warning'}>{t.retirement[value.state]}</Tag>}
      </SettingsRow>
      {value !== null && value !== undefined && (
        <>
          <SettingsRow label={t.definition.requestedAt}><Time value={value.requestedAt} full /></SettingsRow>
          <SettingsRow label={t.definition.completedAt}><Time value={value.completedAt} full /></SettingsRow>
        </>
      )}
      <SettingsRow label={t.definition.retire} hint={t.definition.retireHint}>
        <Button variant="outline" size="sm" className="tw-danger-button" disabled={!definition.installed
          || definition.availability === 'retiring'} onClick={onRetire}>{t.retire.start}</Button>
      </SettingsRow>
    </Card>
  )
}

/** Retirement confirmation.
 * @param props.definition - definition to retire.
 * @param props.activeRuns - unfinished Runs that retirement cancels.
 * @returns modal dialog.
 */
export function RetireDialog({ definition, activeRuns, onClose,
  onDone }: { definition: Definition; activeRuns: number; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const { connection, toast } = useApp()
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const start = () => {
    setBusy(true)
    connection.call('retireDefinition', { params: { definitionId: definition.id }, body: { revision: definition.revision },
      idempotencyKey: commandKey() })
      .then(() => { toast(t.retire.started); onDone(); onClose() }, (failure: unknown) => { setError(failureText(describeFailure(failure),
        t)) })
      .finally(() => { setBusy(false) })
  }
  return (
    <Modal open title={t.retire.title(definition.title)} closeLabel={t.common.close} description={t.retire.description}
      backdropBlur={false} onClose={onClose} className="tw-dialog-medium" contentClassName="tw-dialog-scroll"
      footer={<>
        <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="primary" className="tw-danger-fill" disabled={!ack || busy} onClick={start}>{t.retire.start}</Button>
      </>}>
      <ul className="tw-impact-list">
        <li><Dot state="error" /><span>{t.retire.stop(activeRuns)}</span></li>
        <li><Dot state="idle" /><span>{t.retire.clean}</span></li>
        <li><Dot state="done" /><span>{t.retire.keep}</span></li>
      </ul>
      <div className="tw-ack"><Checkbox checked={ack} onChange={setAck} label={t.retire.ack} /></div>
      <p className="tw-footnote">{t.retire.warning}</p>
      {error !== undefined && <Notice kind="error" title={t.retire.failed}>{error}</Notice>}
    </Modal>
  )
}
