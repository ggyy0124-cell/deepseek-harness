/** Settings: display preferences, connection, credentials, device tokens and version facts. */
import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconApiOutlineRegular, IconCloseOutlineRegular, IconDarkOutlineRegular, IconFollowsystemOutlineRegular, IconInfoOutlineRegular,
  IconLightOutlineRegular, IconLinkOutlineRegular, IconRightUpOutlineRegular, IconSettingsOutlineRegular, IconUserOutlineRegular, Modal,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import { useApp, type SettingsTab } from '../app/context.tsx'
import { describeFailure } from '../lib/connection.ts'
import { definitionTitle, failureText, formatTime } from '../lib/format.ts'
import { preferences, updatePreferences, type Appearance } from '../lib/preferences.ts'
import { useResource } from '../lib/resource.ts'
import { useStore } from '../lib/store.ts'
import { useShared } from '../app/context.tsx'
import { CommandLine, CopyButton, Dot, Mono, Notice, Select, SettingsRow } from '../components/ui.tsx'


/** Settings modal.
 * @param props.initialTab - first section.
 * @param props.credential - credential reference to edit first.
 * @param props.onClose - close the modal.
 * @returns modal dialog.
 */
export function SettingsDialog({ initialTab, credential,
  onClose }: { initialTab: SettingsTab; credential?: string | undefined; onClose: () => void }) {
  const t = useT()
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const sections: { key: SettingsTab; label: string; icon: ReactNode }[] = [
    { key: 'general', label: t.settings.tabs.general, icon: <IconSettingsOutlineRegular size={16} /> },
    { key: 'connection', label: t.settings.tabs.connection, icon: <IconLinkOutlineRegular size={16} /> },
    { key: 'credentials', label: t.settings.tabs.credentials, icon: <IconUserOutlineRegular size={16} /> },
    { key: 'devices', label: t.settings.tabs.devices, icon: <IconApiOutlineRegular size={16} /> },
    { key: 'about', label: t.settings.tabs.about, icon: <IconInfoOutlineRegular size={16} /> },
  ]
  const current = sections.find(item => item.key === tab)
  return (
    <Modal open headless title={t.settings.title} backdropBlur={false} onClose={onClose} className="tw-settings-dialog">
      <div className="tw-settings">
        <nav aria-label={t.settings.nav} className="tw-settings-nav">
          <span className="tw-settings-title">{t.settings.title}</span>
          {sections.map(item => (
            <button key={item.key} type="button" className={clsx('tw-settings-nav-item', tab === item.key && 'tw-active')}
              aria-current={tab === item.key ? 'page' : undefined}
              onClick={() => { setTab(item.key) }}>{item.icon}<span>{item.label}</span></button>
          ))}
        </nav>
        <div className="tw-settings-content">
          <div className="tw-settings-close">
            <button type="button" className="tw-icon-button" aria-label={t.settings.close} onClick={onClose}><IconCloseOutlineRegular
              size={16} /></button>
          </div>
          <h2 className="tw-settings-heading">{current?.label}</h2>
          <div className="tw-settings-scroll">
            {tab === 'general' && <General />}
            {tab === 'connection' && <Connection />}
            {tab === 'credentials' && <Credentials focus={credential} />}
            {tab === 'devices' && <Devices />}
            {tab === 'about' && <About />}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function offsetLabel(): string {
  const minutes = -new Date().getTimezoneOffset()
  const sign = minutes >= 0 ? '+' : '−'
  const absolute = Math.abs(minutes)
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
}

function General() {
  const t = useT()
  const value = useStore(preferences)
  const appearances: { key: Appearance; label: string; icon: ReactNode }[] = [
    { key: 'light', label: t.settings.light, icon: <IconLightOutlineRegular size={16} /> },
    { key: 'dark', label: t.settings.dark, icon: <IconDarkOutlineRegular size={16} /> },
    { key: 'system', label: t.settings.system, icon: <IconFollowsystemOutlineRegular size={16} /> },
  ]
  return (
    <>
      <SettingsRow label={t.settings.language}>
        <Select label={t.settings.language} value={value.locale} options={[{ value: 'zh-CN', label: '中文' }, { value: 'en',
          label: 'English' }]}
        onChange={(locale) => { updatePreferences({ locale }) }} />
      </SettingsRow>
      <div className="tw-appearance">
        <div className="tw-settings-row-title">{t.settings.appearance}</div>
        <div className="tw-appearance-options" role="radiogroup" aria-label={t.settings.appearance}>
          {appearances.map(item => (
            <button key={item.key} type="button" role="radio" aria-checked={value.appearance === item.key}
              className={clsx('tw-appearance-option', value.appearance === item.key && 'tw-active')}
              onClick={() => { updatePreferences({ appearance: item.key }) }}>
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
      <SettingsRow label={t.settings.timeDisplay} hint={t.settings.timeHint}>
        <Select label={t.settings.timeDisplay} value={value.time} onChange={(time) => { updatePreferences({ time }) }}
          options={[{ value: 'local', label: t.settings.timeLocal(offsetLabel()) }, { value: 'utc', label: t.settings.timeUtc }]} />
      </SettingsRow>
    </>
  )
}

function Connection() {
  const t = useT()
  const { connection, events } = useApp()
  const state = useStore(connection.state)
  const stream = useStore(events.state)
  const ready = useResource('settings-ready', () => connection.readiness())
  const address = connection.base.href.replace(/\/$/, '')
  return (
    <>
      <SettingsRow label={t.settings.address} hint={t.settings.addressHint}><Mono tone="strong">{address}</Mono><CopyButton text={address}
        label={t.settings.copyAddress} size={28} /></SettingsRow>
      <SettingsRow label={t.settings.serviceState} hint={t.settings.serviceHint}>
        {ready.value !== undefined && <Tag tone={ready.value ? 'success' : 'warning'}>{ready.value ? t.diagnostics.ready
          : t.diagnostics.notReady}</Tag>}
      </SettingsRow>
      <SettingsRow label={t.settings.live} hint={t.settings.liveHint}>
        <span className="tw-inline-flex tw-gap-6"><Dot state={stream === 'connected' || stream === 'recovered' ? 'done' : 'warning'} />
          {stream === 'connected' || stream === 'recovered' ? t.settings.liveConnected : t.settings.liveDisconnected}</span>
      </SettingsRow>
      <SettingsRow label={t.settings.browserSession}
        hint={state.kind === 'ready' ? t.settings.sessionHint(formatTime(state.expiresAt, { full: true })) : undefined}>
        <Button variant="outline" className="tw-danger-button" onClick={() => { void connection.logout() }}>{t.settings.logout}</Button>
      </SettingsRow>
      <SettingsRow label={t.settings.openapi} hint={t.settings.openapiHint}>
        <a className="tw-secondary-button" href={`${address}/openapi.json`} target="_blank" rel="noreferrer"><IconRightUpOutlineRegular
          size={16} />{t.settings.openOpenapi}</a>
      </SettingsRow>
    </>
  )
}

const REFERENCE = /^[A-Za-z_][A-Za-z0-9_]*$/

function Credentials({ focus }: { focus: string | undefined }) {
  const t = useT()
  const { connection, toast } = useApp()
  const { definitions } = useShared()
  const list = useResource('credentials', () => connection.credentials(), { affects: (_runId, event) => event.startsWith('definition.') })
  const [editing, setEditing] = useState<string | null>(focus ?? null)
  const [value, setValue] = useState('')
  const [other, setOther] = useState('')
  const [busy, setBusy] = useState(false)
  const items = [...(list.value ?? [])]
  if (focus !== undefined && REFERENCE.test(focus) && !items.some(item => item.reference === focus)) items.push({ reference: focus,
    configured: false, writable: true, definitionIds: [] })
  const save = (reference: string) => {
    setBusy(true)
    connection.setCredential(reference, value).then(() => {
      toast(t.settings.credentialSaved(reference))
      setEditing(null)
      setValue('')
      list.reload()
    }, (error: unknown) => { toast(`${t.settings.credentialFailed}：${failureText(describeFailure(error), t)}`,
      'error') }).finally(() => { setBusy(false) })
  }
  const editor = (reference: string) => (
    <div className="tw-credential-editor">
      <input type="password" className="tw-input tw-input-full tw-input-focus" autoComplete="new-password" autoFocus
        aria-label={t.settings.valueAria(reference)}
        placeholder={t.settings.newValue} value={value} onChange={(event) => { setValue(event.target.value) }}
        onKeyDown={(event) => { if (event.key === 'Enter' && value !== '') save(reference) }} />
      <div className="tw-row-between">
        <span className="tw-muted-small">{t.settings.valueHint}</span>
        <span className="tw-inline-flex tw-gap-8">
          <Button variant="ghost" size="sm" onClick={() => { setEditing(null); setValue('') }}>{t.common.cancel}</Button>
          <Button variant="primary" size="sm" disabled={value === '' || busy} onClick={() => { save(reference) }}>{t.common.save}</Button>
        </span>
      </div>
    </div>
  )
  return (
    <>
      <p className="tw-settings-intro">{t.settings.credentialsIntro}</p>
      {list.error !== undefined && <Notice kind="error" title={t.common.loadFailed}>{failureText(list.error, t)}</Notice>}
      {list.value !== undefined && items.length === 0 && <p className="tw-muted-line">{t.settings.credentialsEmpty}</p>}
      {items.map(item => (
        <div key={item.reference} className={clsx('tw-credential', editing === item.reference && 'tw-editing')}>
          <div className="tw-credential-row">
            <div className="tw-credential-text">
              <Mono tone="strong">{item.reference}</Mono>
              <span className="tw-muted-small">{item.writable ? item.definitionIds.map(id => definitionTitle(definitions.value,
                id)).join(' · ') : t.settings.readOnlyBy}</span>
            </div>
            <Tag tone={item.configured ? 'success' : 'danger'}>{item.configured ? t.form.configured : t.form.missing}</Tag>
            {!item.writable
              ? <Tag tone="outline">{t.form.readOnly}</Tag>
              : editing !== item.reference && <Button variant={item.configured ? 'outline' : 'primary'} size="sm"
                onClick={() => { setEditing(item.reference); setValue('') }}>{item.configured ? t.form.replace : t.form.set}</Button>}
          </div>
          {editing === item.reference && item.writable && editor(item.reference)}
        </div>
      ))}
      <SettingsRow label={t.settings.otherReference} hint={t.settings.otherReferenceHint} error={other !== '' && !REFERENCE.test(other)
        ? t.settings.referenceInvalid : undefined}>
        <input type="text" className="tw-input tw-mono tw-input-ref" placeholder={t.settings.referencePlaceholder}
          aria-label={t.settings.otherReference}
          value={other} onChange={(event) => { setOther(event.target.value) }} />
        <Button variant="outline" size="sm" disabled={!REFERENCE.test(other)}
          onClick={() => { setEditing(other); setValue(''); setOther('') }}>{t.form.set}</Button>
      </SettingsRow>
      {editing !== null && !items.some(item => item.reference === editing) && (
        <div className="tw-credential tw-editing"><div className="tw-credential-row"><Mono
          tone="strong">{editing}</Mono></div>{editor(editing)}</div>
      )}
    </>
  )
}

function Devices() {
  const t = useT()
  return (
    <div className="tw-stack-12">
      <p className="tw-settings-intro">{t.settings.devicesIntro}</p>
      <CommandLine command="dsh --profile task --token-create" />
      <CommandLine command={`dsh --profile task --token-revoke ${t.settings.deviceId}`} />
      <p className="tw-footnote">{t.settings.devicesWarning}</p>
    </div>
  )
}

function About() {
  const t = useT()
  return (
    <>
      <SettingsRow label={t.settings.version}><Mono tone="strong">{t.settings.product(__DSH_TASK_WEB_VERSION__)}</Mono></SettingsRow>
      <SettingsRow label={t.settings.apiVersion}><Mono tone="strong">/api/task/v1</Mono></SettingsRow>
      <SettingsRow label={t.settings.dataDir} hint={t.settings.dataDirHint}><Mono tone="strong">$DSH_HOME/tasks</Mono></SettingsRow>
      <SettingsRow label={t.settings.backup}
        hint={t.settings.backupHint}><Mono>{`dsh --profile task --backup ${t.settings.backupDir}`}</Mono></SettingsRow>
    </>
  )
}
