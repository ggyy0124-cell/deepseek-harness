// @vitest-environment jsdom
/** Business confirmation card: its reply text boxes send on Enter like the Run composer. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { idSchema } from '@deepseek-ai/dsh-task-api-protocol'
import { AppContext, type AppValue } from '../src/app/context.tsx'
import { InteractionCard } from '../src/components/Interaction.tsx'
import { TaskConnection } from '../src/support/connection.ts'
import { TaskEventHub } from '../src/support/events.ts'
import { updatePreferences } from '../src/support/preferences.ts'
import type { Interaction } from '../src/support/types.ts'

const decisionWithNote: Interaction['schema'] = {
  type: 'object', required: ['decision'], properties: {
    decision: { oneOf: [{ const: 'approve', title: 'Approve and continue' }, { const: 'reject', title: 'Reject' }] },
    note: { type: 'string' },
  },
}
const decisionOnly: Interaction['schema'] = { type: 'object', required: ['decision'], properties: { decision: { enum: ['approve', 'reject'] } } }
const answer: Interaction['schema'] = { type: 'string' }
/** A confirmation gate with an editable field group: not a choice plus text, so the card renders it as a form. */
const gateWithFields: Interaction['schema'] = {
  type: 'object', required: ['decision'], properties: {
    decision: { oneOf: [{ const: 'continue', title: 'Continue' }, { const: 'revise', title: 'Revise' }] },
    fields: { type: 'object', title: 'Bug facts', default: { branch: 'main', cause: 'null check' }, properties: {
      branch: { type: 'string', title: 'Git branch', default: 'main' },
      cause: { type: 'string', title: 'Cause', default: 'null check', 'x-dsh-widget': 'textarea' },
    } },
    note: { type: 'string', title: '备注 / 修改意见', 'x-dsh-widget': 'textarea' },
  },
}

const waiting = (schema: Interaction['schema']): Interaction => ({
  id: idSchema.parse('wait-1'), runId: idSchema.parse('run-1'), revision: 3, source: 'business', title: 'Confirm the fix plan', description: '',
  schema, callId: null, questions: null, attachments: [], createdAt: '2026-10-07T10:00:00.000Z', expiresAt: null,
})
const stale = () => new Response(JSON.stringify({
  type: 'about:blank', status: 409, title: 'stale', detail: 'stale', instance: '/api/task/v1/requests/1', code: 'stale_interaction', requestId: 'request-1',
}), { status: 409, headers: { 'content-type': 'application/problem+json' } })

/** Mount the card against a gateway that records each reply and rejects it as stale, or never answers. */
function mount(schema: Interaction['schema'], answered = true) {
  const sent: { path: string; body: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn((input: string | URL, init?: RequestInit) => {
    const text = init?.body
    if (typeof text !== 'string') throw new Error('The gateway receives each reply as JSON text')
    sent.push({ path: new URL(input).pathname, body: JSON.parse(text) })
    return answered ? Promise.resolve(stale()) : new Promise<Response>(() => {})
  }))
  const connection = new TaskConnection('http://127.0.0.1:3081/')
  const app: AppValue = { connection, events: new TaskEventHub(connection), toast: () => {}, openSettings: () => {}, openTrigger: () => {} }
  render(<AppContext.Provider value={app}><InteractionCard interaction={waiting(schema)} runName="BUG-4821" onDone={() => {}} /></AppContext.Provider>)
  return sent
}

const note = () => screen.getByRole('textbox', { name: '补充说明（可选）' })

beforeEach(() => { updatePreferences({ locale: 'zh-CN' }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('reply text boxes', () => {
  it('sends the chosen option with its note on Enter', async () => {
    const sent = mount(decisionWithNote)
    fireEvent.click(screen.getByRole('option', { name: /Approve and continue/ }))
    fireEvent.change(note(), { target: { value: 'ship after tests' } })
    expect(fireEvent.keyDown(note(), { key: 'Enter' })).toBe(false)
    await waitFor(() => { expect(sent).toHaveLength(1) })
    expect(sent[0]).toEqual({
      path: '/api/task/v1/runs/run-1/interactions/wait-1/responses', body: { revision: 3, response: { decision: 'approve', note: 'ship after tests' } },
    })
    await screen.findByText(/此交互已更新或已关闭/)
  })

  it('sends the same reply from the reply button as from Enter', async () => {
    const sent = mount(decisionWithNote)
    fireEvent.click(screen.getByRole('option', { name: /Approve and continue/ }))
    fireEvent.change(note(), { target: { value: 'ship after tests' } })
    fireEvent.click(screen.getByRole('button', { name: '提交回复' }))
    await waitFor(() => { expect(sent).toHaveLength(1) })
    expect(sent[0]?.body).toEqual({ revision: 3, response: { decision: 'approve', note: 'ship after tests' } })
  })

  it('sends a text answer on Enter and nothing for an empty one', async () => {
    const sent = mount(answer)
    const box = screen.getByRole('textbox', { name: '输入回复内容' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(sent).toHaveLength(0)
    fireEvent.change(box, { target: { value: 'looks good' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => { expect(sent).toHaveLength(1) })
    expect(sent[0]?.body).toEqual({ revision: 3, response: 'looks good' })
  })

  it('breaks the line on Shift+Enter instead of sending', () => {
    const sent = mount(decisionWithNote)
    fireEvent.click(screen.getByRole('option', { name: /Reject/ }))
    expect(fireEvent.keyDown(note(), { key: 'Enter', shiftKey: true })).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it('sends nothing until an option is chosen, like the disabled reply button', () => {
    const sent = mount(decisionWithNote)
    fireEvent.change(note(), { target: { value: 'ship after tests' } })
    fireEvent.keyDown(note(), { key: 'Enter' })
    expect(sent).toHaveLength(0)
    expect(screen.getByRole('button', { name: '提交回复' }).hasAttribute('disabled')).toBe(true)
  })

  it('treats the Enter that confirms an IME candidate as part of the composition', () => {
    const sent = mount(answer)
    const box = screen.getByRole('textbox', { name: '输入回复内容' })
    fireEvent.change(box, { target: { value: 'ni hao' } })
    expect(fireEvent.keyDown(box, { key: 'Enter', isComposing: true })).toBe(true)
    expect(fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 })).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it('sends a reply once while it is in flight', async () => {
    const sent = mount(answer, false)
    const box = screen.getByRole('textbox', { name: '输入回复内容' })
    fireEvent.change(box, { target: { value: 'looks good' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => { expect(screen.getByRole('button', { name: '提交回复' }).hasAttribute('disabled')).toBe(true) })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(sent).toHaveLength(1)
  })

  it('sends a form reply on Enter in the top-level note and breaks the line on Shift+Enter', async () => {
    const sent = mount(gateWithFields)
    const box = screen.getByRole('textbox', { name: /备注 \/ 修改意见/ })
    fireEvent.change(box, { target: { value: 'use the release branch' } })
    expect(fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })).toBe(true)
    expect(sent).toHaveLength(0)
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(false)
    await waitFor(() => { expect(sent).toHaveLength(1) })
    expect(sent[0]?.body).toMatchObject({ revision: 3, response: { note: 'use the release branch', fields: { branch: 'main', cause: 'null check' } } })
  })

  it('keeps Enter as a line break in the multiline fields of a form group', () => {
    const sent = mount(gateWithFields)
    const cause = screen.getByRole('textbox', { name: /Cause/ })
    expect(fireEvent.keyDown(cause, { key: 'Enter' })).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it('names the keys beside the note of a form reply', () => {
    mount(gateWithFields)
    expect(screen.getByText(/Enter 提交，Shift\+Enter 换行/)).toBeTruthy()
  })

  it('names the keys beside a text box and shows no hint for closed choices', () => {
    mount(decisionWithNote)
    expect(screen.getByText(/Enter 提交，Shift\+Enter 换行/)).toBeTruthy()
    cleanup()
    mount(decisionOnly)
    expect(screen.queryByText(/Enter 提交/)).toBeNull()
  })
})
