// @vitest-environment jsdom
/** Transcript feed and conversation scrolling against a scripted gateway. */
import { useRef, type ReactNode } from 'react'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { idSchema } from '@deepseek-ai/dsh-task-api-protocol'
import { AppContext, type AppValue } from '../src/app/context.tsx'
import { TaskConnection } from '../src/support/connection.ts'
import { TaskEventHub } from '../src/support/events.ts'
import { useStickToBottom } from '../src/support/scroll.ts'
import { useTranscript } from '../src/support/transcript.ts'
import { header, message, text, tool } from './trajectory-fixtures.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const problem = (status: number, code: string) => new Response(JSON.stringify({
  type: 'about:blank', status, title: 'rejected', detail: code, instance: '/api/task/v1/requests/1', code, requestId: 'request-1',
}), { status, headers: { 'content-type': 'application/problem+json' } })
const frame = (kind: string, cursor: string, body: object) => `id: ${cursor}\nevent: ${kind}\ndata: ${JSON.stringify({ kind, cursor, ...body })}\n\n`
const stream = (...frames: string[]) => new Response(frames.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
const stored = message(1, 'assistant', 0, [text('hello')])
const request = header(0, [tool('bash')])
const page = { runId: 'run-1', sessionId: 'session-1', items: [stored], requests: [request], nextCursor: 'cursor-2', hasMore: false }
const runId = idSchema.parse('run-1')
const otherRunId = idSchema.parse('run-2')
const services = (connection: TaskConnection): AppValue => ({
  connection, events: new TaskEventHub(connection), toast: () => {}, openSettings: () => {}, openTrigger: () => {},
})

function feed(respond: () => Response | Promise<Response>) {
  const connection = new TaskConnection('http://127.0.0.1:3081/')
  vi.stubGlobal('fetch', vi.fn(async () => respond()))
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppContext.Provider value={services(connection)}>{children}</AppContext.Provider>
  )
  return renderHook(() => useTranscript({ id: runId, terminalAt: null }), { wrapper })
}

describe('transcript feed', () => {
  it('counts failed reads, retries on request and clears the failure once the stream is live', async () => {
    let healthy = false
    const { result } = feed(() => {
      if (!healthy) throw new TypeError('network down')
      return stream(frame('session_ready', 'cursor-1', {}), frame('session', 'cursor-2', { page }))
    })
    await waitFor(() => { expect(result.current.failure?.count).toBe(1) })
    expect(result.current.state).toBe('reconnecting')
    expect(result.current.failure?.error).toEqual({ kind: 'transport', detail: 'network down' })
    act(() => { result.current.retry() })
    await waitFor(() => { expect(result.current.failure?.count).toBe(2) })
    healthy = true
    act(() => { result.current.retry() })
    await waitFor(() => { expect(result.current.entries.map(entry => entry.sequence)).toEqual([1]) })
    expect(result.current.requests).toEqual([request])
    expect(result.current.state).toBe('live')
    expect(result.current.failure).toBeUndefined()
  })

  it('keeps one copy of a message and a request header that arrive in more than one page', async () => {
    const { result } = feed(() => stream(
      frame('session_ready', 'cursor-1', {}), frame('session', 'cursor-2', { page }), frame('session', 'cursor-3', { page: { ...page, nextCursor: 'cursor-3' } }),
    ))
    await waitFor(() => { expect(result.current.entries).toHaveLength(1) })
    expect(result.current.requests).toEqual([request])
  })

  it('reports a Session that is not ready as pending without a failure', async () => {
    const { result } = feed(() => problem(409, 'session_unavailable'))
    await waitFor(() => { expect(result.current.state).toBe('pending') })
    expect(result.current.failure).toBeUndefined()
  })

  it('names a rejected read by its problem code', async () => {
    const { result } = feed(() => problem(500, 'unavailable'))
    await waitFor(() => { expect(result.current.failure?.error).toMatchObject({ kind: 'problem', code: 'unavailable' }) })
  })

  it('reads the pages of an ended Run and reports a failed page read', async () => {
    const connection = new TaskConnection('http://127.0.0.1:3081/')
    let healthy = true
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (!healthy) throw new TypeError('network down')
      return new Response(JSON.stringify(page), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppContext.Provider value={services(connection)}>{children}</AppContext.Provider>
    )
    const ended = renderHook(() => useTranscript({ id: runId, terminalAt: '2026-10-06T10:05:00.000Z' }), { wrapper })
    await waitFor(() => { expect(ended.result.current.state).toBe('complete') })
    expect(ended.result.current.entries).toHaveLength(1)
    expect(ended.result.current.requests).toEqual([request])
    healthy = false
    const failing = renderHook(() => useTranscript({ id: otherRunId, terminalAt: '2026-10-06T10:05:00.000Z' }), { wrapper })
    await waitFor(() => { expect(failing.result.current.failure?.count).toBe(1) })
  })
})

describe('conversation scrolling', () => {
  function column(initial: { content: string; enabled: boolean }) {
    const geometry = { scrollHeight: 1000, clientHeight: 400 }
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => geometry.scrollHeight)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => geometry.clientHeight)
    let node: HTMLDivElement | null = null
    function Probe({ content, enabled }: { content: string; enabled: boolean }) {
      const ref = useRef<HTMLDivElement | null>(null)
      useStickToBottom(ref, content, enabled)
      return <div ref={(value) => { ref.current = value; node = value }} />
    }
    const mounted = render(<Probe {...initial} />)
    const read = () => node
    return {
      geometry,
      scrollTop: () => read()?.scrollTop,
      scrollTo: (top: number) => { const element = read(); if (element !== null) { element.scrollTop = top; element.dispatchEvent(new Event('scroll')) } },
      update: (next: { content: string; enabled: boolean }) => { mounted.rerender(<Probe {...next} />) },
    }
  }

  it('follows new content until the reader scrolls away and again after returning to the end', () => {
    const view = column({ content: 'one', enabled: true })
    expect(view.scrollTop()).toBe(1000)
    view.geometry.scrollHeight = 1400
    view.update({ content: 'two', enabled: true })
    expect(view.scrollTop()).toBe(1400)
    view.scrollTo(200)
    view.geometry.scrollHeight = 1800
    view.update({ content: 'three', enabled: true })
    expect(view.scrollTop()).toBe(200)
    view.scrollTo(1790)
    view.geometry.scrollHeight = 2000
    view.update({ content: 'four', enabled: true })
    expect(view.scrollTop()).toBe(2000)
  })

  it('returns to the start while disabled and follows from the end once enabled again', () => {
    const view = column({ content: 'one', enabled: true })
    view.scrollTo(100)
    view.update({ content: 'one', enabled: false })
    expect(view.scrollTop()).toBe(0)
    view.update({ content: 'changed while away', enabled: false })
    expect(view.scrollTop()).toBe(0)
    view.update({ content: 'changed while away', enabled: true })
    expect(view.scrollTop()).toBe(1000)
  })
})
