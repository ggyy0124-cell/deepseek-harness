// @vitest-environment jsdom
/** Supplemental input box: files from the picker, a paste or a drop wait as removable drafts and upload with the input. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { idSchema } from '@deepseek-ai/dsh-task-api-protocol'
import { AppContext, type AppValue } from '../src/app/context.tsx'
import { Composer } from '../src/components/Composer.tsx'
import { TaskConnection } from '../src/support/connection.ts'
import { TaskEventHub } from '../src/support/events.ts'
import { updatePreferences } from '../src/support/preferences.ts'
import type { Run } from '../src/support/types.ts'

const run: Run = {
  id: idSchema.parse('run-1'), sessionId: idSchema.parse('session-1'), definitionId: idSchema.parse('zentao.bug-triage'), kind: 'ordinary',
  parentRunId: null, restartedFrom: null, businessKey: '1481990', codeVersion: '1', configRevision: 1, revision: 4,
  status: 'running', reason: null, outcome: null, occurrence: null, cleanup: 'pending', createdAt: '2026-10-22T10:00:00.000Z',
  updatedAt: '2026-10-22T10:05:00.000Z', terminalAt: null, retryAt: null, result: null, supplementalInputSchema: null,
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': status < 400 ? 'application/json' : 'application/problem+json' },
})
const problem = (status: number, code: string) => json(status, {
  type: 'about:blank', status, title: 'rejected', detail: 'rejected', instance: '/api/task/v1/requests/1', code, requestId: 'request-1',
})
const stored = (names: readonly string[]) => json(201, {
  items: names.map((name, index) => ({
    id: idSchema.parse(`attachment-${index}`), runId: run.id, sessionId: run.sessionId, name, mime: 'text/plain', size: 3,
    digest: 'a'.repeat(64), createdAt: '2026-10-22T10:06:00.000Z',
  })),
})

const png = () => new File(['png'], 'shot.png', { type: 'image/png' })
const log = () => new File(['log'], 'run.log', { type: 'text/plain' })
/** Clipboard or drag data carrying the files, plus the text a clipboard holds next to them. */
function transfer(files: readonly File[], text = '') {
  return {
    files, types: files.length > 0 ? ['Files'] : ['text/plain'], getData: () => text,
    items: files.map(entry => ({ kind: 'file', getAsFile: () => entry, webkitGetAsEntry: () => ({ isDirectory: false }) })),
  }
}
const folder = {
  files: [], types: ['Files'], getData: () => '',
  items: [{ kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => ({ isDirectory: true }) }],
}

interface Sent { readonly path: string; readonly key: string | null; readonly files: readonly string[]; readonly input: unknown }
interface Answers {
  readonly upload?: (names: readonly string[]) => Response
  readonly send?: () => Response
}

/** Mount the box against a gateway that records each upload and input and answers them as scripted. */
function mount(answers: Answers = {}) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn((input: string | URL, init?: RequestInit) => {
    const path = new URL(input).pathname
    const body = init?.body
    const files = body instanceof FormData ? body.getAll('files').map(entry => (entry as File).name) : []
    sent.push({ path, key: new Headers(init?.headers).get('Idempotency-Key'), files, input: typeof body === 'string' ? JSON.parse(body) : null })
    return Promise.resolve(path.endsWith('/attachments') ? (answers.upload ?? stored)(files) : (answers.send ?? (() => json(200, run)))())
  }))
  const toast = vi.fn<AppValue['toast']>()
  const onSent = vi.fn()
  const onUploaded = vi.fn()
  const connection = new TaskConnection('http://127.0.0.1:3081/')
  const app: AppValue = { connection, events: new TaskEventHub(connection), toast, openSettings: () => {}, openTrigger: () => {} }
  const view = render(
    <AppContext.Provider value={app}>
      <Composer run={run} onSent={onSent} onUploaded={onUploaded} footer={null} />
    </AppContext.Provider>,
  )
  return { sent, toast, onSent, onUploaded, view }
}

const box = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: '补充信息' })
const drafts = () => screen.getByRole('list', { name: '待上传的附件' })
const listed = () => screen.queryByRole('list', { name: '待上传的附件' })
const sendButton = (name: string) => screen.getByRole('button', { name })

const created: string[] = []
const revoked: string[] = []
beforeEach(() => {
  updatePreferences({ locale: 'zh-CN' })
  vi.stubGlobal('matchMedia', (query: string) => ({ media: query, matches: false }))
  created.length = 0
  revoked.length = 0
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true, writable: true, value: (file: File) => { created.push(`blob:${file.name}`); return `blob:${file.name}` },
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: (url: string) => { revoked.push(url) } })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('files pasted into the box', () => {
  it('appear as a thumbnail and a file card, and the file names the clipboard carries as text stay out of the box', () => {
    mount()
    const inserted = fireEvent.paste(box(), { clipboardData: transfer([png(), log()], 'shot.png\nrun.log') })
    expect(inserted).toBe(false)
    expect(within(drafts()).getByRole('img', { name: 'shot.png' }).getAttribute('src')).toBe('blob:shot.png')
    expect(within(drafts()).getByText('run.log')).toBeTruthy()
    expect(within(drafts()).getByText('LOG')).toBeTruthy()
    expect(created).toEqual(['blob:shot.png'])
    expect(screen.getByText('附件将在发送时一并上传')).toBeTruthy()
    expect(box().value).toBe('')
  })

  it('leave pasted text that is more than file names in place', () => {
    mount()
    const inserted = fireEvent.paste(box(), { clipboardData: transfer([log()], 'see run.log for the stack') })
    expect(inserted).toBe(true)
    expect(within(drafts()).getByText('run.log')).toBeTruthy()
  })

  it('are not taken from a paste of plain text', () => {
    mount()
    expect(fireEvent.paste(box(), { clipboardData: transfer([], 'just text') })).toBe(true)
    expect(listed()).toBeNull()
  })

  it('skip folders and say so', () => {
    const { toast } = mount()
    fireEvent.paste(box(), { clipboardData: folder })
    expect(toast).toHaveBeenCalledWith('不支持上传文件夹，已跳过', 'error')
    expect(listed()).toBeNull()
  })
})

describe('files dropped on the box', () => {
  it('mark the box while a file is over it and become drafts on drop', () => {
    mount()
    const frame = box().closest('.tw-composer')
    expect(fireEvent.dragOver(box(), { dataTransfer: transfer([log()]) })).toBe(false)
    expect(frame?.hasAttribute('data-over')).toBe(true)
    fireEvent.dragLeave(box(), { dataTransfer: transfer([log()]) })
    expect(frame?.hasAttribute('data-over')).toBe(false)
    fireEvent.dragOver(box(), { dataTransfer: transfer([log()]) })
    expect(fireEvent.drop(box(), { dataTransfer: transfer([log()]) })).toBe(false)
    expect(frame?.hasAttribute('data-over')).toBe(false)
    expect(within(drafts()).getByText('run.log')).toBeTruthy()
  })

  it('leave dragged text to the browser', () => {
    mount()
    expect(fireEvent.dragOver(box(), { dataTransfer: transfer([], 'text') })).toBe(true)
    expect(fireEvent.drop(box(), { dataTransfer: transfer([], 'text') })).toBe(true)
    expect(listed()).toBeNull()
  })
})

describe('files chosen with the picker', () => {
  it('upload alone when there is no input', async () => {
    const { sent, toast, onSent, onUploaded } = mount()
    fireEvent.change(screen.getByLabelText('上传附件'), { target: { files: [log()] } })
    fireEvent.click(sendButton('上传附件'))
    await waitFor(() => { expect(toast).toHaveBeenCalledWith('已上传 1 个文件') })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ path: '/api/task/v1/runs/run-1/attachments', files: ['run.log'] })
    expect(sent[0]?.key).toMatch(/^web-[0-9a-f]{32}$/)
    expect(onUploaded).toHaveBeenCalledOnce()
    expect(onSent).not.toHaveBeenCalled()
    expect(listed()).toBeNull()
  })

  it('are ignored when the picker is closed without a choice', () => {
    mount()
    fireEvent.change(screen.getByLabelText('上传附件'), { target: { files: [] } })
    expect(listed()).toBeNull()
  })
})

describe('sending the input with files', () => {
  it('uploads the files first, then sends the text under its own retry key and clears the box', async () => {
    const { sent, toast, onSent, onUploaded } = mount()
    fireEvent.paste(box(), { clipboardData: transfer([png(), log()]) })
    fireEvent.change(box(), { target: { value: '附件是现场日志' } })
    fireEvent.click(sendButton('发送'))
    await waitFor(() => { expect(toast).toHaveBeenCalledWith('已发送补充输入，并上传 2 个文件') })
    expect(sent.map(request => request.path)).toEqual(['/api/task/v1/runs/run-1/attachments', '/api/task/v1/runs/run-1/inputs'])
    expect(sent[0]?.files).toEqual(['shot.png', 'run.log'])
    expect(sent[1]?.input).toEqual({ input: '附件是现场日志' })
    expect(sent[1]?.key).toMatch(/^web-[0-9a-f]{32}$/)
    expect(sent[1]?.key).not.toBe(sent[0]?.key)
    expect(onUploaded).toHaveBeenCalledOnce()
    expect(onSent).toHaveBeenCalledOnce()
    expect(box().value).toBe('')
    expect(listed()).toBeNull()
    expect(revoked).toEqual(['blob:shot.png'])
  })

  it('sends text alone without touching the attachment API', async () => {
    const { sent, toast } = mount()
    fireEvent.change(box(), { target: { value: '已配置凭据' } })
    fireEvent.click(sendButton('发送'))
    await waitFor(() => { expect(toast).toHaveBeenCalledWith('已发送补充输入') })
    expect(sent.map(request => request.path)).toEqual(['/api/task/v1/runs/run-1/inputs'])
  })

  it('keeps the files and retries the upload under the same key after a failure', async () => {
    let attempts = 0
    const { sent, toast, onSent } = mount({ upload: names => (attempts++ === 0 ? problem(409, 'run_readonly') : stored(names)) })
    fireEvent.paste(box(), { clipboardData: transfer([log()]) })
    fireEvent.change(box(), { target: { value: '补充' } })
    fireEvent.click(sendButton('发送'))
    await waitFor(() => { expect(toast).toHaveBeenCalledOnce() })
    expect(toast.mock.calls[0]?.[0]).toMatch(/^上传失败：/)
    expect(toast.mock.calls[0]?.[1]).toBe('error')
    expect(sent.map(request => request.path)).toEqual(['/api/task/v1/runs/run-1/attachments'])
    expect(onSent).not.toHaveBeenCalled()
    expect(box().value).toBe('补充')
    expect(within(drafts()).getByText('run.log')).toBeTruthy()
    await waitFor(() => { expect(sendButton('发送').hasAttribute('disabled')).toBe(false) })
    fireEvent.click(sendButton('发送'))
    await waitFor(() => { expect(onSent).toHaveBeenCalledOnce() })
    expect(sent.filter(request => request.path.endsWith('/attachments')).map(request => request.key)).toEqual([sent[0]?.key, sent[0]?.key])
  })

  it('starts a new upload identity once the set of files has changed', async () => {
    let attempts = 0
    const { sent, toast } = mount({ upload: names => (attempts++ === 0 ? problem(409, 'run_readonly') : stored(names)) })
    fireEvent.paste(box(), { clipboardData: transfer([log()]) })
    fireEvent.click(sendButton('上传附件'))
    await waitFor(() => { expect(toast).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(sendButton('上传附件').hasAttribute('disabled')).toBe(false) })
    fireEvent.paste(box(), { clipboardData: transfer([png()]) })
    fireEvent.click(sendButton('上传附件'))
    await waitFor(() => { expect(sent).toHaveLength(2) })
    expect(sent[1]?.files).toEqual(['run.log', 'shot.png'])
    expect(sent[1]?.key).not.toBe(sent[0]?.key)
  })

  it('keeps the text, and no longer the stored files, when the input is rejected', async () => {
    const { sent, toast, onSent, onUploaded } = mount({ send: () => problem(409, 'invalid_state') })
    fireEvent.paste(box(), { clipboardData: transfer([log()]) })
    fireEvent.change(box(), { target: { value: '补充' } })
    fireEvent.click(sendButton('发送'))
    await waitFor(() => { expect(toast).toHaveBeenCalledOnce() })
    expect(toast.mock.calls[0]?.[0]).toMatch(/^发送失败：/)
    expect(sent.map(request => request.path)).toEqual(['/api/task/v1/runs/run-1/attachments', '/api/task/v1/runs/run-1/inputs'])
    expect(onUploaded).toHaveBeenCalledOnce()
    expect(onSent).not.toHaveBeenCalled()
    expect(box().value).toBe('补充')
    expect(listed()).toBeNull()
  })

  it('cannot be sent while empty, and Enter sends the staged files', async () => {
    const { sent, toast } = mount()
    expect(sendButton('上传附件').hasAttribute('disabled')).toBe(true)
    fireEvent.paste(box(), { clipboardData: transfer([log()]) })
    expect(sendButton('上传附件').hasAttribute('disabled')).toBe(false)
    fireEvent.keyDown(box(), { key: 'Enter' })
    await waitFor(() => { expect(toast).toHaveBeenCalledWith('已上传 1 个文件') })
    expect(sent).toHaveLength(1)
  })
})

describe('drafts', () => {
  it('can be removed one by one, which releases their previews', () => {
    mount()
    fireEvent.paste(box(), { clipboardData: transfer([png(), log()]) })
    fireEvent.click(screen.getByRole('button', { name: '移除 shot.png' }))
    expect(within(drafts()).queryByRole('img', { name: 'shot.png' })).toBeNull()
    expect(within(drafts()).getByText('run.log')).toBeTruthy()
    expect(revoked).toEqual(['blob:shot.png'])
    fireEvent.click(screen.getByRole('button', { name: '移除 run.log' }))
    expect(listed()).toBeNull()
    expect(sendButton('上传附件').hasAttribute('disabled')).toBe(true)
  })

  it('release their previews when the box goes away', () => {
    const { view } = mount()
    fireEvent.paste(box(), { clipboardData: transfer([png()]) })
    view.unmount()
    expect(revoked).toEqual(['blob:shot.png'])
  })

  it('are locked while they upload', async () => {
    mount({ upload: () => new Response(null, { status: 500 }) })
    fireEvent.paste(box(), { clipboardData: transfer([log()]) })
    fireEvent.click(sendButton('上传附件'))
    expect(screen.getByText('正在上传 1 个文件…')).toBeTruthy()
    expect(screen.getByRole('button', { name: '移除 run.log' }).hasAttribute('disabled')).toBe(true)
    await waitFor(() => { expect(screen.queryByText('正在上传 1 个文件…')).toBeNull() })
  })
})
