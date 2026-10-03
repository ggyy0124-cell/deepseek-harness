/** Application root: login gate, frame, routing, dialogs and toasts. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { IconPanelLeftOutlineRegular, IconQueueOutlineRegular, IconWarningOutlineRegular, Toast,
  Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { useT } from '../i18n/index.ts'
import type { TaskConnection } from '../lib/connection.ts'
import type { TaskEventHub } from '../lib/events.ts'
import { useResource } from '../lib/resource.ts'
import { paths, RouterProvider, useRouter } from '../lib/router.tsx'
import { useStore } from '../lib/store.ts'
import { ACTIVE_STATUS_QUERY, AppContext, SharedContext, useApp, type AppValue, type SettingsTab } from './context.tsx'
import { Sidebar } from './Sidebar.tsx'
import { StreamIndicator } from './StreamIndicator.tsx'
import { EmptyState, IconButton } from '../components/ui.tsx'
import { LoginPage } from '../pages/Login.tsx'
import { OverviewPage } from '../pages/Overview.tsx'
import { DiagnosticsPage } from '../pages/Diagnostics.tsx'
import { DefinitionsPage } from '../pages/Definitions.tsx'
import { DefinitionPage } from '../pages/Definition.tsx'
import { RunsPage } from '../pages/Runs.tsx'
import { RunPage } from '../pages/Run.tsx'
import { InboxPage } from '../pages/Inbox.tsx'
import { SettingsDialog } from '../pages/Settings.tsx'
import { TriggerDialog } from '../pages/Trigger.tsx'

/** Root component.
 * @param props.connection - gateway connection.
 * @param props.events - Task event subscription.
 * @returns login page or application frame.
 */
export function App({ connection, events }: { connection: TaskConnection; events: TaskEventHub }) {
  const state = useStore(connection.state)
  const ready = state.kind === 'ready'
  useEffect(() => {
    if (!ready) return
    events.start()
    return () => { events.stop() }
  }, [ready, events])
  if (!ready) return <LoginPage connection={connection} state={state} />
  return <RouterProvider><Frame connection={connection} events={events} /></RouterProvider>
}

interface ToastItem { readonly id: number; readonly text: string; readonly tone: 'success' | 'error' }

function Frame({ connection, events }: { connection: TaskConnection; events: TaskEventHub }) {
  const t = useT()
  const [toasts, setToasts] = useState<readonly ToastItem[]>([])
  const [settings, setSettings] = useState<{ tab: SettingsTab; credential?: string | undefined } | null>(null)
  const [trigger, setTrigger] = useState<{ definitionId?: string | undefined } | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const toast = useCallback((text: string, tone: 'success' | 'error' = 'success') => {
    setToasts(items => [...items.slice(-2), { id: Date.now() + Math.random(), text, tone }])
  }, [])
  const app = useMemo<AppValue>(() => ({
    connection, events, toast,
    openSettings: (tab = 'general', credential) => { setSettings({ tab, credential }) },
    openTrigger: (definitionId) => { setTrigger({ definitionId }) },
  }), [connection, events, toast])

  return (
    <AppContext.Provider value={app}>
      <SharedProvider>
        <div className="tw-frame">
          {collapsed
            ? <div className="tw-rail"><IconButton label={t.nav.expand} icon={<IconPanelLeftOutlineRegular size={16} />}
              onClick={() => { setCollapsed(false) }} /></div>
            : <Sidebar onCollapse={() => { setCollapsed(true) }} />}
          <Routes />
          <StreamIndicator />
        </div>
        {settings !== null && <SettingsDialog initialTab={settings.tab} credential={settings.credential}
          onClose={() => { setSettings(null) }} />}
        {trigger !== null && <TriggerDialog definitionId={trigger.definitionId} onClose={() => { setTrigger(null) }} />}
        {toasts.map(item => (
          <Toast key={item.id} text={item.text} {...(item.tone === 'success' ? { tone: 'success' as const }
            : { icon: <IconWarningOutlineRegular size={16} /> })}
          holdMs={item.tone === 'error' ? 5000 : 2500}
          onDone={() => { setToasts(items => items.filter(other => other.id !== item.id)) }} />
        ))}
      </SharedProvider>
    </AppContext.Provider>
  )
}

function SharedProvider({ children }: { children: ReactNode }) {
  const { connection } = useApp()
  const definitions = useResource('definitions', async signal => (await connection.call('listDefinitions', { signal })).items,
    { affects: (_runId, event) => /^(definition|retirement|run)\./.test(event) })
  const active = useResource('active', async signal => (await connection.call('listRuns', { query: { status: ACTIVE_STATUS_QUERY,
    limit: '200' }, signal })).items)
  const interactions = useResource('interactions', async signal => (await connection.call('listWaitingInteractions', { signal })).items)
  const value = useMemo(() => ({ definitions, active, interactions }), [definitions, active, interactions])
  return <SharedContext.Provider value={value}>{children}</SharedContext.Provider>
}

function Routes() {
  const t = useT()
  const { route, navigate } = useRouter()
  const [first, second] = route.segments
  if (first === undefined) return <OverviewPage />
  if (first === 'definitions' && second === undefined) return <DefinitionsPage />
  if (first === 'definitions' && second !== undefined) return <DefinitionPage id={second} />
  if (first === 'runs' && second === undefined) return <RunsPage />
  if (first === 'runs' && second !== undefined) return <RunPage id={second} />
  if (first === 'inbox') return <InboxPage />
  if (first === 'diagnostics') return <DiagnosticsPage />
  return (
    <main className="tw-main">
      <EmptyState icon={<IconQueueOutlineRegular size={20} />} title={t.run.notFound}
        action={<Button variant="outline" size="sm" onClick={() => { navigate(paths.overview()) }}>{t.common.back}</Button>} />
    </main>
  )
}
