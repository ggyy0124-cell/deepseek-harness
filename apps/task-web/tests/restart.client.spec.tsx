// @vitest-environment jsdom
/** Restart action on the result of a failed or cancelled ordinary Run. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { idSchema } from '@deepseek-ai/dsh-task-api-protocol'
import { AppContext, type AppValue } from '../src/app/context.tsx'
import { RestartCard } from '../src/components/Restart.tsx'
import { TaskConnection } from '../src/support/connection.ts'
import { TaskEventHub } from '../src/support/events.ts'
import { updatePreferences } from '../src/support/preferences.ts'
import { RouterProvider } from '../src/support/router.tsx'
import { isRestartable, type Run } from '../src/support/types.ts'

const run = (id: string, overrides: Partial<Run> = {}): Run => ({
  id: idSchema.parse(id), sessionId: idSchema.parse(`${id}-session`), definitionId: idSchema.parse('zentao.bug-triage'), kind: 'ordinary',
  parentRunId: idSchema.parse('poll-1'), restartedFrom: null, businessKey: '1472778', codeVersion: '1', configRevision: 1, revision: 4,
  status: 'failed', reason: 'rejected', outcome: 'failed', occurrence: null, cleanup: 'complete', createdAt: '2026-10-08T10:00:00.000Z',
  updatedAt: '2026-10-08T10:05:00.000Z', terminalAt: '2026-10-08T10:05:00.000Z', retryAt: null, result: null, supplementalInputSchema: null,
  ...overrides,
})
const stopped = run('stopped-run')
const restarted = run('restarted-run', { restartedFrom: stopped.id, status: 'provisioning', outcome: null, terminalAt: null, reason: null })
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': status < 400 ? 'application/json' : 'application/problem+json' },
})
const problem = (status: number, code: string) => json(status, {
  type: 'about:blank', status, title: 'rejected', detail: 'rejected', instance: '/api/task/v1/requests/1', code, requestId: 'request-1',
})

interface Sent { readonly method: string; readonly path: string; readonly search: string; readonly key: string | null }

/** Mount the card against a gateway whose newest run of the business key and restart answer are supplied. */
function mount(card: Run, newest: Run, restart: () => Response = () => json(201, restarted)) {
  const sent: Sent[] = []
  const toast = vi.fn<AppValue['toast']>()
  const onRestarted = vi.fn()
  vi.stubGlobal('fetch', vi.fn((input: string | URL, init?: RequestInit) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    sent.push({ method, path: url.pathname, search: url.search, key: new Headers(init?.headers).get('Idempotency-Key') })
    return Promise.resolve(method === 'POST' ? restart() : json(200, { items: [newest], nextCursor: null }))
  }))
  const connection = new TaskConnection('http://127.0.0.1:3081/')
  const app: AppValue = { connection, events: new TaskEventHub(connection), toast, openSettings: () => {}, openTrigger: () => {} }
  render(
    <AppContext.Provider value={app}>
      <RouterProvider><RestartCard run={card} onRestarted={onRestarted} /></RouterProvider>
    </AppContext.Provider>,
  )
  return { sent, toast, onRestarted }
}

beforeEach(() => { updatePreferences({ locale: 'zh-CN' }); history.replaceState(null, '', '/runs/stopped-run') })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('restartable runs', () => {
  it('are the ended ordinary runs that failed or were cancelled', () => {
    expect(isRestartable(stopped)).toBe(true)
    expect(isRestartable(run('cancelled-run', { status: 'cancelled' }))).toBe(true)
    expect(isRestartable(run('succeeded-run', { status: 'succeeded' }))).toBe(false)
    expect(isRestartable(run('active-run', { status: 'running', terminalAt: null }))).toBe(false)
    expect(isRestartable(run('polling-run', { kind: 'polling' }))).toBe(false)
  })
})

describe('restart card', () => {
  it('restarts the newest run of the business key and opens the new run', async () => {
    const { sent, onRestarted } = mount(stopped, stopped)
    fireEvent.click(await screen.findByRole('button', { name: '重来' }))
    await waitFor(() => { expect(location.pathname).toBe('/runs/restarted-run') })
    expect(sent[0]).toMatchObject({ method: 'GET', path: '/api/task/v1/runs' })
    expect(Object.fromEntries(new URLSearchParams(sent[0]?.search))).toEqual({
      definitionId: 'zentao.bug-triage', kind: 'ordinary', businessKey: '1472778', limit: '1',
    })
    expect(sent[1]).toMatchObject({ method: 'POST', path: '/api/task/v1/runs/stopped-run/restart' })
    expect(sent[1]?.key).toMatch(/^web-[0-9a-f]{32}$/)
    expect(onRestarted).toHaveBeenCalledOnce()
  })

  it('points to the newer run instead of offering a restart', async () => {
    const { sent } = mount(stopped, restarted)
    const link = await screen.findByRole('link', { name: 'restarte' })
    expect(link.getAttribute('href')).toBe('/runs/restarted-run')
    expect(screen.getByText('该业务对象已有更新的执行')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重来' })).toBeNull()
    expect(sent.every(request => request.method === 'GET')).toBe(true)
  })

  it('names a refused restart and lets the user try again', async () => {
    const { toast, onRestarted } = mount(stopped, stopped, () => problem(409, 'invalid_state'))
    const button = await screen.findByRole('button', { name: '重来' })
    fireEvent.click(button)
    await waitFor(() => { expect(toast).toHaveBeenCalledWith('无法重来：该业务对象已有更新的执行，或任务已停用', 'error') })
    expect(onRestarted).not.toHaveBeenCalled()
    expect(location.pathname).toBe('/runs/stopped-run')
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('reports other failures with their own text', async () => {
    const { toast } = mount(stopped, stopped, () => problem(404, 'not_found'))
    fireEvent.click(await screen.findByRole('button', { name: '重来' }))
    await waitFor(() => { expect(toast).toHaveBeenCalledOnce() })
    expect(toast.mock.calls[0]?.[0]).toMatch(/^无法重来：/)
    expect(toast.mock.calls[0]?.[0]).not.toContain('已有更新的执行')
  })

  it('shows nothing and reads nothing for a run that is not restartable', () => {
    const { sent } = mount(run('succeeded-run', { status: 'succeeded' }), stopped)
    expect(screen.queryByRole('button', { name: '重来' })).toBeNull()
    expect(sent).toHaveLength(0)
  })
})
