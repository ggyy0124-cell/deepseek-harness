/** Launch-link login and connection states shown before the application frame. */
import type { ReactNode } from 'react'
import { Button, IconCheckOutlineRegular, IconLinkOutlineRegular, IconUserOutlineRegular, IconWarningOutlineRegular, IconWarningTriangleOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import type { ConnectionState, TaskConnection } from '../support/connection.ts'
import { CommandLine, Dot, Mark, Mono, Spinner, Tile } from '../components/ui.tsx'

type Step = 'done' | 'ongoing' | 'idle' | 'failed'

/** Login page.
 * @param props.connection - gateway connection.
 * @param props.state - connection state other than ready.
 * @returns full-page login layout.
 */
export function LoginPage({ connection, state }: { connection: TaskConnection; state: Exclude<ConnectionState, { kind: 'ready' }> }) {
  const t = useT()
  const reachable: Step = state.kind === 'checking' ? 'ongoing' : state.kind === 'unreachable' ? 'failed' : 'done'
  const verify: Step = state.kind === 'exchanging' ? 'ongoing'
    : state.kind === 'signed_out' && state.reason === 'link_invalid' ? 'failed'
      : state.kind === 'recovering' ? 'done' : 'idle'
  const session: Step = state.kind === 'recovering' ? 'done' : state.kind === 'signed_out' && state.reason === 'session_ended' ? 'failed' : 'idle'
  const reconnect = () => { void connection.resume('no_session') }
  return (
    <div className="tw-login">
      <header className="tw-login-brand"><Mark /><span>{t.brand}</span></header>
      <div className="tw-login-body">
        <section aria-label={t.login.title} className="tw-login-card">
          <Tile><IconLinkOutlineRegular size={22} /></Tile>
          <div className="tw-login-heading">
            <h1>{t.login.title}</h1>
            <p>{t.login.description}</p>
          </div>
          <ol className="tw-login-steps">
            <StepRow state={reachable} label={t.login.stepReachable} hint={<Mono tone="muted">{connection.base.href.replace(/\/$/, '')}</Mono>} />
            <StepRow state={verify} label={verify === 'done' ? t.login.stepVerified : verify === 'failed' ? t.login.linkInvalidTitle : t.login.stepVerify} hint={t.login.stepVerifyHint} />
            <StepRow state={session} label={t.login.stepSession} hint={t.login.stepSessionHint} />
          </ol>
          <StateCard state={state} onReconnect={reconnect} />
          <div className="tw-login-help">
            <span>{t.login.noLink}</span>
            <CommandLine command="dsh --profile task --launch-link" />
            <span>{t.login.commandHint} <Mono>dsh --profile task</Mono></span>
          </div>
        </section>
      </div>
    </div>
  )
}

function StepRow({ state, label, hint }: { state: Step; label: string; hint: ReactNode }) {
  const mark = state === 'ongoing' ? <Spinner size={16} tone="info" />
    : state === 'done' ? <span className="tw-step-done"><IconCheckOutlineRegular size={16} /></span>
      : state === 'failed' ? <span className="tw-step-failed"><IconWarningOutlineRegular size={16} /></span>
        : <span className="tw-step-idle"><Dot state="idle" /></span>
  return (
    <li className="tw-login-step" data-state={state}>
      <span className="tw-login-step-mark">{mark}</span>
      <span className="tw-login-step-text"><span className="tw-login-step-label">{label}</span><span className="tw-login-step-hint">{hint}</span></span>
    </li>
  )
}

function StateCard({ state, onReconnect }: { state: Exclude<ConnectionState, { kind: 'ready' }>; onReconnect: () => void }) {
  const t = useT()
  switch (state.kind) {
    case 'checking':
    case 'exchanging':
      return null
    case 'unreachable':
      return <Strip kind="error" title={t.login.unreachableTitle} body={t.login.unreachableBody}
        action={<Button variant="primary" size="sm" onClick={onReconnect}>{t.login.reconnect}</Button>} />
    case 'recovering':
      return <Strip kind="warning" title={t.login.recoveringTitle} body={t.login.recoveringBody}
        action={<span className="tw-login-wait"><Spinner />{t.login.waitingReady}</span>} />
    case 'signed_out':
      switch (state.reason) {
        case 'link_invalid': return <Strip kind="error" title={t.login.linkInvalidTitle} body={t.login.linkInvalidBody} />
        case 'session_ended': return <Strip kind="neutral" title={t.login.endedTitle} body={t.login.endedBody} />
        case 'no_session': return <Strip kind="neutral" title={t.login.noSessionTitle} body={t.login.noSessionBody} />
      }
  }
}

function Strip({ kind, title, body, action }: { kind: 'error' | 'warning' | 'neutral'; title: string; body: string; action?: ReactNode }) {
  const icon = kind === 'error' ? <IconWarningOutlineRegular size={14} /> : kind === 'warning' ? <IconWarningTriangleOutlineRegular size={14} /> : <IconUserOutlineRegular size={14} />
  return (
    <section className="tw-state-card" data-kind={kind} role="status">
      <div className="tw-state-card-strip">{icon}<span>{title}</span></div>
      <div className="tw-state-card-body">
        <p>{body}</p>
        {action !== undefined && <div className="tw-state-card-actions">{action}</div>}
      </div>
    </section>
  )
}
