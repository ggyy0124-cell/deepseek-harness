/** One definition: configuration editor, its Runs and its lifecycle. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, IconEllipsisOutlineRegular, IconListPenOutlineRegular, Menu, Modal, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useT, type Messages } from '../i18n/index.ts'
import { useApp, useShared } from '../app/context.tsx'
import { commandKey, describeFailure, isProblem, type RequestFailure } from '../support/connection.ts'
import { applyChanges, configChanges, type ConfigChange } from '../support/config-diff.ts'
import { nextOccurrences, parseCron, validTimeZone } from '../support/cron.ts'
import { describeCron, failureText, formatTime, intervalParts, UNIT_MS } from '../support/format.ts'
import { useResource } from '../support/resource.ts'
import { paths, useRouter } from '../support/router.tsx'
import type { Catalog, CredentialStatus, Definition, Json, TaskConfig } from '../support/types.ts'
import {
  Card, Crumbs, Dot, EmptyState, Mono, Notice, Segmented, Select, SettingsRow, Tabs, Tile, Time,
} from '../components/ui.tsx'
import { hasFormControls, SchemaForm, validateSchema, type SchemaNode } from '../components/SchemaForm.tsx'
import { availabilityTone, ScheduleIcon } from './Definitions.tsx'
import { RunList } from './Runs.tsx'
import { RetireDialog, LifecyclePanel } from './Lifecycle.tsx'

type Tab = 'config' | 'runs' | 'lifecycle'

/** Definition page.
 * @param props.id - definition identity.
 * @returns main element.
 */
export function DefinitionPage({ id }: { id: string }) {
  const t = useT()
  const { connection, toast } = useApp()
  const { route, navigate } = useRouter()
  const shared = useShared()
  const definition = useResource(`definition:${id}`, signal => connection.call('getDefinition', { params: { definitionId: id }, signal }),
    { affects: (_runId, event) => /^(definition|retirement|run)\./.test(event) })
  const [retiring, setRetiring] = useState(false)
  const [menu, setMenu] = useState(false)
  const [pending, setPending] = useState(false)
  const tabParam = route.query.get('tab')
  const tab: Tab = tabParam === 'runs' || tabParam === 'lifecycle' ? tabParam : 'config'
  const value = definition.value
  if (value === undefined) {
    if (definition.error?.kind === 'problem' && definition.error.code === 'not_found') {
      return (
        <main className="tw-main">
          <EmptyState icon={<IconListPenOutlineRegular size={20} />} title={t.definition.notFound}
            action={<Button variant="outline" size="sm"
              onClick={() => { navigate(paths.definitions()) }}>{t.common.back}</Button>}>{t.definition.notFoundBody}</EmptyState>
        </main>
      )
    }
    return <main className="tw-main">{definition.error !== undefined ? <Notice kind="error"
      title={t.common.loadFailed}>{failureText(definition.error, t)}</Notice> : <p
      className="tw-muted-line">{t.common.loading}</p>}</main>
  }
  const toggle = () => {
    setPending(true)
    connection.call('enableDefinition', { params: { definitionId: value.id }, body: { revision: value.revision, enabled: !value.enabled },
      idempotencyKey: commandKey() })
      .then(() => { toast(value.enabled ? t.definitions.paused(value.title) : t.definitions.enabled(value.title)) },
        (error: unknown) => { toast(`${t.definitions.toggleFailed}：${failureText(describeFailure(error), t)}`, 'error') })
      .finally(() => { setPending(false); definition.reload(); shared.definitions.reload() })
  }
  const setTab = (next: Tab) => { navigate(paths.definition(value.id, next === 'config' ? undefined : next), { replace: true }) }
  const activeRuns = shared.active.value?.filter(run => run.definitionId === value.id) ?? []
  const runCount = activeRuns.length
  const activeRevision = Math.min(value.revision, ...activeRuns.map(run => run.configRevision))
  return (
    <main className="tw-main tw-gap-20 tw-main-with-bar">
      <Crumbs items={[{ label: t.definition.crumb, to: paths.definitions() }, { label: value.title }]} />
      <header className="tw-definition-header">
        <div className="tw-inline-flex tw-gap-14">
          <Tile muted={!value.installed}><ScheduleIcon definition={value} /></Tile>
          <div className="tw-stack-4">
            <div className="tw-inline-flex tw-gap-8">
              <h1 className="tw-h1">{value.title}</h1>
              <Tag tone="neutral">{t.kind[value.config.schedule.kind]}</Tag>
              <Tag tone={availabilityTone(value.availability)}>{t.availability[value.availability]}</Tag>
            </div>
            <span className="tw-meta-row"><Mono tone="muted">{value.id}</Mono><span>{t.definition.code(value.codeVersion)}</span>
              <span>{t.definition.revision(value.revision)}</span><span>{t.definition.formVersion(value.configSchemaVersion)}</span></span>
          </div>
        </div>
        <div className="tw-inline-flex tw-gap-12">
          {value.installed && (
            <span className="tw-inline-flex tw-gap-8 tw-secondary-text">{t.definition.enable}
              <Switch checked={value.enabled} label={t.definition.enableAria} disabled={pending || value.availability === 'retiring'}
                onChange={toggle} /></span>
          )}
          <Button variant="outline" size="sm" className="tw-page-button" onClick={() => { setTab('runs') }}>{t.definition.viewRuns}</Button>
          <Menu open={menu} onClose={() => { setMenu(false) }} portal align="end"
            items={[{ id: 'retire', label: t.definition.retire, danger: true, disabled: !value.installed
              || value.availability === 'retiring' }, { id: 'lifecycle', label: t.definition.tabs.lifecycle }]}
            onSelect={(item) => { setMenu(false); if (item === 'retire') setRetiring(true); else setTab('lifecycle') }}
            anchor={<button type="button" className="tw-icon-button" aria-label={t.common.more}
              onClick={() => { setMenu(open => !open) }}><IconEllipsisOutlineRegular size={16} /></button>} />
        </div>
      </header>
      <Tabs label={t.definition.tabsLabel} value={tab} onChange={setTab}
        items={[{ value: 'config', label: t.definition.tabs.config }, { value: 'runs', label: t.definition.tabs.runs, count: runCount
          || undefined }, { value: 'lifecycle', label: t.definition.tabs.lifecycle }]} />
      {tab === 'config' && <ConfigEditor definition={value} onSaved={() => { definition.reload(); shared.definitions.reload() }}
        activeRuns={runCount} activeRevision={activeRevision} />}
      {tab === 'runs' && <RunList fixed={{ definitionId: value.id }} />}
      {tab === 'lifecycle' && <LifecyclePanel definition={value} onRetire={() => { setRetiring(true) }} />}
      {retiring && <RetireDialog definition={value} activeRuns={runCount} onClose={() => { setRetiring(false) }}
        onDone={() => { definition.reload(); shared.definitions.reload() }} />}
    </main>
  )
}

function fieldLabel(path: readonly string[], definition: Definition, t: Messages): string {
  const [head, ...rest] = path
  switch (head) {
    case 'schedule': {
      const key = rest[0]
      if (key === 'intervalMs') return t.definition.interval
      if (key === 'cron') return t.definition.cron
      if (key === 'timezone') return t.definition.timezone
      if (key === 'misfire') return t.definition.misfire
      if (key === 'overlap') return t.definition.overlap
      return t.definition.schedule
    }
    case 'concurrency': return t.definition.concurrency
    case 'preset': return t.definition.preset
    case 'permissionPreset': return t.definition.permission
    case 'model': return t.definition.model
    case 'workspacePath': return t.definition.workspace
    default: {
      let node: Json | undefined = definition.businessConfigSchema
      const labels: string[] = []
      for (const key of rest) {
        const properties: Json | undefined = typeof node === 'object' && node !== null && !Array.isArray(node) ? node['properties']
          : undefined
        node = typeof properties === 'object' && properties !== null && !Array.isArray(properties) ? properties[key] : undefined
        const title = typeof node === 'object' && node !== null && !Array.isArray(node) && typeof node['title'] === 'string'
          ? node['title'] : key
        labels.push(title)
      }
      return labels.length === 0 ? t.definition.business : labels.join(' › ')
    }
  }
}

function changeText(change: ConfigChange): string {
  const show = (value: Json | undefined) => value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value)
  return `${show(change.before)} → ${show(change.after)}`
}

function ConfigEditor({ definition, onSaved, activeRuns,
  activeRevision }: { definition: Definition; onSaved: () => void; activeRuns: number; activeRevision: number }) {
  const t = useT()
  const { connection, toast, openSettings } = useApp()
  const catalog = useResource('catalog', signal => connection.call('getCatalog', { signal }), { live: false })
  const diagnostics = useResource('diagnostics-capacity', signal => connection.call('getDiagnostics', { signal }), { live: false })
  const credentials = useResource('credentials', () => connection.credentials(), { affects: (_runId,
    event) => event.startsWith('definition.') })
  const [base, setBase] = useState<{ revision: number; config: TaskConfig }>({ revision: definition.revision, config: definition.config })
  const [draft, setDraft] = useState<TaskConfig>(definition.config)
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [jsonText, setJsonText] = useState(() => JSON.stringify(definition.config.business, null, 2))
  const [jsonError, setJsonError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<RequestFailure | undefined>()
  const [conflict, setConflict] = useState<{ current: Definition; changes: ConfigChange[] } | null>(null)
  const [check, setCheck] = useState<{ at: number; messages: readonly string[] } | { at: number; error: RequestFailure } | null>(null)
  const [checking, setChecking] = useState(false)
  const changes = useMemo(() => configChanges(base.config, draft), [base.config, draft])
  const dirty = changes.length > 0
  const readOnly = !definition.installed
  const businessSchema = definition.businessConfigSchema as SchemaNode
  const formAvailable = definition.configSchemaVersion > 0 && hasFormControls(businessSchema)
  const effectiveMode = formAvailable ? mode : 'json'

  // Adopt a newer saved revision while nothing is edited.
  useEffect(() => {
    if (dirty || definition.revision === base.revision) return
    setBase({ revision: definition.revision, config: definition.config })
    setDraft(definition.config)
    setJsonText(JSON.stringify(definition.config.business, null, 2))
  }, [definition.revision, definition.config, base.revision, dirty])

  const setBusiness = (business: Json) => {
    setDraft(current => ({ ...current, business }))
    setJsonText(JSON.stringify(business, null, 2))
    setJsonError(false)
  }
  const businessErrors = useMemo(() => formAvailable
    ? validateSchema(businessSchema, draft.business, businessSchema, '', { required: t.common.required, invalid: t.definition.invalid,
      credential: t.settings.referenceInvalid })
    : new Map<string, string>(), [formAvailable, businessSchema, draft.business, t])
  const scheduleError = draft.schedule.kind === 'scheduled'
    ? { cron: parseCron(draft.schedule.cron) === undefined ? t.definition.cronInvalid : undefined,
      timezone: validTimeZone(draft.schedule.timezone) ? undefined : t.definition.timezoneInvalid }
    : { cron: undefined, timezone: undefined }
  const intervalError = draft.schedule.kind === 'polling' && (!Number.isInteger(draft.schedule.intervalMs)
    || draft.schedule.intervalMs < 1000) ? t.definition.invalid : undefined
  const concurrencyError = !Number.isInteger(draft.concurrency) || draft.concurrency < 1 ? t.definition.invalid : undefined
  const workspaceError = draft.workspacePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(draft.workspacePath) ? undefined
    : t.definition.invalid
  const invalid = businessErrors.size > 0 || jsonError || scheduleError.cron !== undefined || scheduleError.timezone !== undefined
    || intervalError !== undefined || concurrencyError !== undefined || workspaceError !== undefined

  const discard = () => {
    setDraft(base.config)
    setJsonText(JSON.stringify(base.config.business, null, 2))
    setJsonError(false)
    setFailure(undefined)
  }
  const save = () => {
    setSaving(true)
    setFailure(undefined)
    const saved = draft
    connection.call('configureDefinition', {
      params: { definitionId: definition.id }, idempotencyKey: commandKey(),
      body: { revision: base.revision, configSchemaVersion: definition.configSchemaVersion, config: saved },
    }).then((next) => {
      setBase({ revision: next.revision, config: next.config })
      setDraft(next.config)
      setJsonText(JSON.stringify(next.config.business, null, 2))
      toast(t.definition.saved(next.revision))
      onSaved()
    }, async (error: unknown) => {
      if (isProblem(error, 'revision_conflict')) {
        const current = await connection.call('getDefinition', { params: { definitionId: definition.id } })
        setConflict({ current, changes: configChanges(base.config, saved) })
        return
      }
      setFailure(describeFailure(error))
    }).finally(() => { setSaving(false) })
  }
  const draftRef = useRef(draft)
  draftRef.current = draft
  // Options read the draft at request time so typing elsewhere does not refetch them.
  const loadOptions = useCallback(async (field: string) => (await connection.call('getOptions', {
    params: { definitionId: definition.id }, body: { field, config: draftRef.current }, idempotencyKey: commandKey(),
  })).items as readonly { value: Json; label: string }[], [connection, definition.id])
  const runCheck = () => {
    setChecking(true)
    connection.call('checkConfig', { params: { definitionId: definition.id }, body: { config: draft }, idempotencyKey: commandKey() })
      .then((result) => { setCheck({ at: Date.now(), messages: result.messages }) }, (error: unknown) => { setCheck({ at: Date.now(),
        error: describeFailure(error) }) })
      .finally(() => { setChecking(false) })
  }
  const credentialStatus = (reference: string): CredentialStatus | undefined =>
    credentials.value?.find(item => item.reference === reference)

  return (
    <>
      {readOnly
        ? <Notice kind="warning" title={t.definition.uninstalledNotice}>{t.definition.uninstalledBody}</Notice>
        : <Notice kind="info" title={t.definition.futureOnly}>{t.definition.futureOnlyBody(activeRuns, activeRevision)}</Notice>}
      {definition.availability === 'blocked' && definition.reason !== null && (
        <Notice kind="error" title={t.availability.blocked}><span
          className="tw-mono">{definition.reason}</span> · {t.definitions.blockedFix}</Notice>
      )}
      <ScheduleCard definition={definition} draft={draft} setDraft={setDraft} readOnly={readOnly} errors={{ ...scheduleError,
        interval: intervalError }} />
      <ExecutionCard draft={draft} setDraft={setDraft} catalog={catalog.value} readOnly={readOnly}
        globalConcurrency={diagnostics.value?.concurrency}
        errors={{ concurrency: concurrencyError, workspace: workspaceError }} />
      <Card className="tw-form-card">
        <div className="tw-form-card-head">
          <div className="tw-inline-flex tw-gap-10 tw-baseline"><h2>{t.definition.business}</h2>
            <span className="tw-muted-small">{t.definition.businessBy(definition.id, definition.configSchemaVersion)}</span></div>
          {formAvailable && <Segmented label={t.definition.editMode} value={effectiveMode} onChange={setMode}
            items={[{ value: 'form', label: t.definition.form }, { value: 'json', label: t.definition.json }]} />}
        </div>
        {effectiveMode === 'form'
          ? <SchemaForm schema={businessSchema} value={draft.business} onChange={setBusiness} errors={businessErrors}
            context={{ readOnly, loadOptions: readOnly ? undefined : loadOptions, credentialStatus,
              editCredential: (reference) => { openSettings('credentials', reference) } }} />
          : (
            <div className="tw-json-editor">
              <textarea aria-label={t.definition.json} className="tw-textarea tw-mono" rows={Math.min(24, Math.max(8,
                jsonText.split('\n').length + 1))}
              value={jsonText} disabled={readOnly}
              onChange={(event) => {
                setJsonText(event.target.value)
                try {
                  const business = JSON.parse(event.target.value) as Json
                  setDraft(current => ({ ...current, business }))
                  setJsonError(false)
                } catch {
                  setJsonError(true) // The draft keeps the last parseable value until the text parses.
                }
              }} />
              {jsonError && <span className="tw-field-error" role="alert">{t.definition.jsonInvalid}</span>}
              {!formAvailable && <span className="tw-form-hint">{t.definition.jsonOnly}</span>}
            </div>
          )}
      </Card>
      {!readOnly && (
        <Card className="tw-form-card">
          <div className="tw-form-card-head">
            <div className="tw-inline-flex tw-gap-10 tw-baseline"><h2>{t.definition.check}</h2>
              {check !== null && <span className="tw-muted-small">{'error' in check
                ? `${formatTime(check.at)} · ${t.definition.checkFailed}` : t.definition.checkResult(formatTime(check.at),
                  check.messages.length)}</span>}</div>
          </div>
          <div className="tw-stack-8 tw-pad-bottom">
            <div className="tw-row-between"><span className="tw-secondary-text">{t.definition.checkHint}</span>
              <Button variant="outline" size="sm" disabled={checking || invalid} onClick={runCheck}>{checking ? t.definition.checking
                : t.definition.checkAction}</Button></div>
            {check !== null && 'error' in check && <Notice kind="error" title={t.definition.checkFailed}>{failureText(check.error,
              t)}</Notice>}
            {check !== null && 'messages' in check && check.messages.length === 0 && <Notice kind="success"
              title={t.definition.checkEmpty} />}
            {check !== null && 'messages' in check && check.messages.map((message, index) => <Notice key={`${index}-${message}`}
              kind="info" title={message} />)}
          </div>
        </Card>
      )}
      {failure !== undefined && <Notice kind="error" title={t.definition.saveFailed}>{failureText(failure, t)}</Notice>}
      {dirty && !readOnly && (
        <div className="tw-save-bar" role="region" aria-label={t.definition.unsaved(changes.length, base.revision + 1)}>
          <span className="tw-inline-flex tw-gap-8 tw-secondary-text"><Dot state="warning" />{t.definition.unsaved(changes.length,
            base.revision + 1)}</span>
          <span className="tw-inline-flex tw-gap-8">
            <Button variant="ghost" onClick={discard} disabled={saving}>{t.common.discard}</Button>
            <Button variant="primary" onClick={save} disabled={saving || invalid}>{t.common.save}</Button>
          </span>
        </div>
      )}
      {conflict !== null && (
        <Modal open title={t.definition.conflictTitle} closeLabel={t.common.close} backdropBlur={false} className="tw-dialog-medium"
          onClose={() => { setConflict(null) }}
          description={t.definition.conflictBody(base.revision, conflict.current.revision)}
          footer={<>
            <Button variant="outline" onClick={() => {
              setBase({ revision: conflict.current.revision, config: conflict.current.config })
              setDraft(conflict.current.config)
              setJsonText(JSON.stringify(conflict.current.config.business, null, 2))
              setConflict(null)
              onSaved()
            }}>{t.definition.conflictDiscard}</Button>
            <Button variant="primary" onClick={() => {
              const merged = applyChanges(conflict.current.config, conflict.changes)
              setBase({ revision: conflict.current.revision, config: conflict.current.config })
              setDraft(merged)
              setJsonText(JSON.stringify(merged.business, null, 2))
              setConflict(null)
              onSaved()
            }}>{t.definition.conflictApply(conflict.current.revision)}</Button>
          </>}>
          <div className="tw-stack-4">
            <span className="tw-muted-small">{t.definition.conflictChanges}</span>
            <ul className="tw-change-list">
              {conflict.changes.map(change => (
                <li key={change.path.join('.')}><span className="tw-secondary-text">{fieldLabel(change.path, definition, t)}</span><span
                  className="tw-change-value">{changeText(change)}</span></li>
              ))}
            </ul>
          </div>
          <p className="tw-footnote">{t.definition.conflictHint(conflict.current.revision)}</p>
        </Modal>
      )}
    </>
  )
}

function ScheduleCard({ definition, draft, setDraft, readOnly, errors }: {
  definition: Definition
  draft: TaskConfig
  setDraft: (update: (current: TaskConfig) => TaskConfig) => void
  readOnly: boolean
  errors: { cron: string | undefined; timezone: string | undefined; interval: string | undefined }
}) {
  const t = useT()
  const schedule = draft.schedule
  const zones = useMemo(() => (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []), [])
  return (
    <Card className="tw-form-card">
      <div className="tw-form-card-head"><h2>{t.definition.schedule}</h2></div>
      <SettingsRow label={t.definition.trigger} hint={t.definition.triggerHint}><Tag
        tone="neutral">{t.kind[schedule.kind]}</Tag></SettingsRow>
      {schedule.kind === 'polling' && (() => {
        const parts = intervalParts(schedule.intervalMs)
        return (
          <>
            <SettingsRow label={t.definition.interval} hint={t.definition.intervalHint} error={errors.interval} htmlFor="schedule-interval">
              <input id="schedule-interval" type="number" min={1} className="tw-input tw-input-number" disabled={readOnly}
                value={parts.value}
                onChange={(event) => { const value = Number(event.target.value); setDraft(current => ({ ...current,
                  schedule: { kind: 'polling', intervalMs: Math.round(value * UNIT_MS[parts.unit]) } })) }} />
              <Select label={t.definition.intervalUnit} width={96} value={parts.unit} disabled={readOnly}
                options={(['seconds', 'minutes', 'hours'] as const).map(unit => ({ value: unit, label: t.schedule.units[unit] }))}
                onChange={(unit) => { setDraft(current => ({ ...current, schedule: { kind: 'polling',
                  intervalMs: parts.value * UNIT_MS[unit] } })) }} />
            </SettingsRow>
            <SettingsRow label={t.definition.nextPoll} hint={t.definition.nextPollHint}>
              <span>{definition.nextDueAt === null ? t.common.none : <Time value={definition.nextDueAt} />}</span>
            </SettingsRow>
          </>
        )
      })()}
      {schedule.kind === 'scheduled' && (() => {
        const spec = parseCron(schedule.cron)
        const upcoming = spec !== undefined && validTimeZone(schedule.timezone) ? nextOccurrences(spec, schedule.timezone, Date.now(), 3)
          : []
        const update = (patch: Partial<typeof schedule>) => { setDraft(current => current.schedule.kind === 'scheduled' ? { ...current,
          schedule: { ...current.schedule, ...patch } } : current) }
        return (
          <>
            <SettingsRow label={t.definition.cron} hint={t.definition.cronHint} error={errors.cron} htmlFor="schedule-cron">
              <span className="tw-stack-4 tw-align-end">
                <input id="schedule-cron" type="text" className="tw-input tw-mono tw-input-medium" disabled={readOnly} value={schedule.cron}
                  onChange={(event) => { update({ cron: event.target.value }) }} />
                <span className="tw-muted-small">{describeCron(schedule.cron, t) ?? ''}</span>
              </span>
            </SettingsRow>
            <SettingsRow label={t.definition.timezone} hint={t.definition.timezoneHint} error={errors.timezone} htmlFor="schedule-timezone">
              <input id="schedule-timezone" type="text" list="tw-timezones" className="tw-input tw-input-medium" disabled={readOnly}
                value={schedule.timezone}
                onChange={(event) => { update({ timezone: event.target.value }) }} />
              <datalist id="tw-timezones">{zones.map(zone => <option key={zone} value={zone} />)}</datalist>
            </SettingsRow>
            <SettingsRow label={t.definition.misfire} hint={t.definition.misfireHint}>
              <Segmented label={t.definition.misfire} value={schedule.misfire} disabled={readOnly}
                onChange={(misfire) => { update({ misfire }) }}
                items={(['all', 'coalesce', 'skip'] as const).map(value => ({ value, label: t.definition.misfireOptions[value] }))} />
            </SettingsRow>
            <SettingsRow label={t.definition.overlap} hint={t.definition.overlapHint}>
              <Segmented label={t.definition.overlap} value={schedule.overlap} disabled={readOnly}
                onChange={(overlap) => { update({ overlap }) }}
                items={(['queue', 'allow'] as const).map(value => ({ value, label: t.definition.overlapOptions[value] }))} />
            </SettingsRow>
            <SettingsRow label={t.definition.upcoming} hint={t.definition.upcomingHint}>
              <ul className="tw-occurrences">
                {upcoming.map(instant => <li key={instant}>{formatTime(instant, { weekdays: t.weekdays, today: t.time.today })}</li>)}
                {upcoming.length === 0 && <li>{t.common.none}</li>}
              </ul>
            </SettingsRow>
            <SettingsRow label={t.definition.nextTrigger} hint={t.definition.nextPollHint}>
              <span>{definition.nextDueAt === null ? t.common.none : <Time value={definition.nextDueAt} weekday />}</span>
            </SettingsRow>
          </>
        )
      })()}
    </Card>
  )
}

function ExecutionCard({ draft, setDraft, catalog, readOnly, globalConcurrency, errors }: {
  draft: TaskConfig
  setDraft: (update: (current: TaskConfig) => TaskConfig) => void
  catalog: Catalog | undefined
  readOnly: boolean
  globalConcurrency: number | undefined
  errors: { concurrency: string | undefined; workspace: string | undefined }
}) {
  const t = useT()
  const presets = catalog?.presets ?? []
  const permissions = catalog?.permissions ?? []
  const models = catalog?.models ?? []
  const presetOptions = [...presets.map(item => ({ value: item.id, label: item.title === item.id ? item.id
    : `${item.id} · ${item.title}` })),
  ...(presets.some(item => item.id === draft.preset) ? [] : [{ value: draft.preset, label: draft.preset }])]
  const permissionOptions = [...permissions.map(item => ({ value: item.id, label: item.title })),
    ...(permissions.some(item => item.id === draft.permissionPreset) ? [] : [{ value: draft.permissionPreset,
      label: draft.permissionPreset }])]
  const modelKey = draft.model === undefined ? '' : `${draft.model.provider}/${draft.model.model}`
  const modelOptions = [{ value: '', label: t.definition.defaultModel }, ...models.map(item => ({ value: `${item.provider}/${item.model}`,
    label: item.title })),
  ...(modelKey === '' || models.some(item => `${item.provider}/${item.model}` === modelKey) ? [] : [{ value: modelKey,
    label: modelKey }])]
  return (
    <Card className="tw-form-card">
      <div className="tw-form-card-head"><h2>{t.definition.execution}</h2></div>
      <SettingsRow label={t.definition.concurrency} hint={t.definition.concurrencyHint(globalConcurrency ?? 0)} error={errors.concurrency}
        htmlFor="execution-concurrency">
        <input id="execution-concurrency" type="number" min={1} step={1} className="tw-input tw-input-number" disabled={readOnly}
          value={draft.concurrency}
          onChange={(event) => { const concurrency = Number(event.target.value); setDraft(current => ({ ...current, concurrency })) }} />
      </SettingsRow>
      <SettingsRow label={t.definition.preset} hint={t.definition.presetHint}>
        <Select label={t.definition.preset} width={220} value={draft.preset} options={presetOptions} disabled={readOnly}
          onChange={(preset) => { setDraft(current => ({ ...current, preset })) }} />
      </SettingsRow>
      <SettingsRow label={t.definition.permission} hint={t.definition.permissionHint}>
        <Select label={t.definition.permission} width={220} value={draft.permissionPreset} options={permissionOptions} disabled={readOnly}
          onChange={(permissionPreset) => { setDraft(current => ({ ...current, permissionPreset })) }} />
      </SettingsRow>
      <SettingsRow label={t.definition.model} hint={t.definition.modelHint}>
        <Select label={t.definition.model} width={220} value={modelKey} options={modelOptions} disabled={readOnly}
          onChange={(key) => {
            setDraft((current) => {
              if (key === '') { const { model: _model, ...rest } = current; return rest }
              const [provider = '', ...model] = key.split('/')
              return { ...current, model: { provider, model: model.join('/') } }
            })
          }} />
      </SettingsRow>
      <SettingsRow label={t.definition.workspace} hint={t.definition.workspaceHint} error={errors.workspace} htmlFor="execution-workspace">
        <input id="execution-workspace" type="text" className="tw-input tw-mono tw-input-wide" disabled={readOnly}
          value={draft.workspacePath}
          onChange={(event) => { const workspacePath = event.target.value; setDraft(current => ({ ...current, workspacePath })) }} />
      </SettingsRow>
    </Card>
  )
}
