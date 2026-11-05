// @vitest-environment jsdom
/** Run detail tabs: what a reader typed into the supplemental input or a confirmation card is still there after a visit to another tab. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { idSchema } from '@deepseek-ai/dsh-task-api-protocol'
import { AppContext, SharedContext, type AppValue, type SharedData } from '../src/app/context.tsx'
import { RunPage } from '../src/pages/Run.tsx'
import { TaskConnection } from '../src/support/connection.ts'
import { TaskEventHub } from '../src/support/events.ts'
import { updatePreferences } from '../src/support/preferences.ts'
import type { Resource } from '../src/support/resource.ts'
import { RouterProvider } from '../src/support/router.tsx'
import type { Interaction, Run } from '../src/support/types.ts'

const run: Run = {
  id: idSchema.parse('run-1'), sessionId: idSchema.parse('session-1'), definitionId: idSchema.parse('zentao.bug-triage'), kind: 'ordinary',
  parentRunId: null, restartedFrom: null, businessKey: '1481990', codeVersion: '1', configRevision: 1, revision: 4,
  status: 'waiting_input', reason: null, outcome: null, occurrence: null, cleanup: 'pending', createdAt: '2026-11-05T10:00:00.000Z',
  updatedAt: '2026-11-05T10:05:00.000Z', terminalAt: null, retryAt: null, result: null, supplementalInputSchema: null,
}
const gate: Interaction = {
  id: idSchema.parse('wait-1'), runId: run.id, revision: 3, source: 'business', title: 'Confirm the fix plan', description: '',
  schema: {
    type: 'object', required: ['decision'], properties: {
      decision: { oneOf: [{ const: 'approve', title: 'Approve and continue' }, { const: 'reject', title: 'Reject' }] },
      note: { type: 'string' },
    },
  },
  callId: null, questions: null, attachments: [], createdAt: '2026-11-05T10:01:00.000Z', expiresAt: null,
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const resource = <Value,>(value: Value): Resource<Value> => ({ value, error: undefined, loading: false, reload: () => {} })

/** Mount the Run page against a gateway that answers its reads; the event streams and statistics never answer. */
function mount() {
  vi.stubGlobal('fetch', vi.fn((input: string | URL) => {
    const reads: Readonly<Record<string, unknown>> = {
      '/api/task/v1/runs/run-1': run,
      '/api/task/v1/runs/run-1/interactions': { items: [gate] },
      '/api/task/v1/runs/run-1/inputs': { items: [] },
      '/api/task/v1/runs/run-1/attachments': { items: [] },
    }
    const body = reads[new URL(input).pathname]
    return body === undefined ? new Promise<Response>(() => {}) : Promise.resolve(json(body))
  }))
  const connection = new TaskConnection('http://127.0.0.1:3081/')
  const app: AppValue = { connection, events: new TaskEventHub(connection), toast: () => {}, openSettings: () => {}, openTrigger: () => {} }
  const shared: SharedData = { definitions: resource([]), active: resource([]), interactions: resource([]) }
  render(
    <AppContext.Provider value={app}>
      <SharedContext.Provider value={shared}><RouterProvider><RunPage id="run-1" /></RouterProvider></SharedContext.Provider>
    </AppContext.Provider>,
  )
}

const tab = (name: string | RegExp) => screen.getByRole('tab', { name })
const composer = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: '补充信息' })
const note = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: '补充说明（可选）' })
const approve = () => screen.getByRole('option', { name: /Approve and continue/ })

beforeEach(() => {
  updatePreferences({ locale: 'zh-CN' })
  vi.stubGlobal('matchMedia', (query: string) => ({ media: query, matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('supplemental input of the Session tab', () => {
  it('keeps its text while the Interactions and Result tabs show', async () => {
    mount()
    await screen.findByRole('tab', { name: /交互\s*1/ })
    fireEvent.change(composer(), { target: { value: '已配置凭据，请重试' } })
    fireEvent.click(tab(/交互/))
    expect(screen.queryByRole('textbox', { name: '补充信息' })).toBeNull()
    fireEvent.click(tab('结果'))
    expect(screen.queryByRole('textbox', { name: '补充信息' })).toBeNull()
    fireEvent.click(tab('会话'))
    expect(composer().value).toBe('已配置凭据，请重试')
  })

  it('keeps the text while another view of the Session shows', async () => {
    mount()
    await screen.findByRole('tab', { name: /交互\s*1/ })
    fireEvent.change(composer(), { target: { value: '补充一行' } })
    fireEvent.click(tab('轨迹'))
    fireEvent.click(tab('对话'))
    expect(composer().value).toBe('补充一行')
  })
})

describe('confirmation card of the Interactions tab', () => {
  it('keeps the chosen option and its note while the Session tab shows', async () => {
    mount()
    fireEvent.click(await screen.findByRole('tab', { name: /交互\s*1/ }))
    fireEvent.click(approve())
    fireEvent.change(note(), { target: { value: 'ship after tests' } })
    fireEvent.click(tab('会话'))
    expect(screen.queryByRole('region', { name: '业务确认' })).toBeNull()
    fireEvent.click(tab(/交互/))
    expect(note().value).toBe('ship after tests')
    expect(approve().getAttribute('aria-selected')).toBe('true')
  })

  it('shows its card only on the Interactions tab', async () => {
    mount()
    await screen.findByRole('tab', { name: /交互\s*1/ })
    expect(screen.queryByRole('region', { name: '业务确认' })).toBeNull()
    fireEvent.click(tab(/交互/))
    await waitFor(() => { expect(within(screen.getByRole('region', { name: '业务确认' })).getByText('Confirm the fix plan')).toBeTruthy() })
    expect(screen.queryByRole('textbox', { name: '补充信息' })).toBeNull()
  })
})
