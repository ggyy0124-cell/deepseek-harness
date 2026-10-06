// @vitest-environment jsdom
/** Conversation rendering: folded, live and pinned turns, human inputs and the expand control of tall content. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Clamp } from '../src/components/Clamp.tsx'
import { Transcript } from '../src/components/Transcript.tsx'
import { updatePreferences } from '../src/support/preferences.ts'
import type { Run, RunInput, TranscriptBlock, TranscriptEntry } from '../src/support/types.ts'

type ConversationRun = Pick<Run, 'id' | 'createdAt' | 'terminalAt' | 'status' | 'outcome'>

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 6, 10, 0, seconds)).toISOString()
const text = (value: string): TranscriptBlock => ({ kind: 'text', text: value })
const call = (callId: string): TranscriptBlock => ({ kind: 'tool_call', callId, name: 'bash', arguments: '{"command":"ls -la"}' })

function message(sequence: number, role: TranscriptEntry['role'], seconds: number, blocks: TranscriptBlock[], callId: string | null = null): TranscriptEntry {
  return {
    sequence, at: at(seconds), role, blocks, callId, isError: false, model: null, usage: null, turn: null, step: null, source: null,
    startedAt: null, firstTokenAt: null,
  }
}
const run = (patch: Partial<ConversationRun> = {}): ConversationRun => ({
  id: 'run-1', createdAt: at(0), terminalAt: null, status: 'waiting_input', outcome: null, ...patch,
} as ConversationRun)
const entries = [
  message(1, 'user', 0, [text('Stage instruction text')]),
  message(2, 'assistant', 2, [{ kind: 'reasoning', text: 'thinking text' }, call('a')]),
  message(3, 'tool', 5, [text('file listing')], 'a'),
  message(4, 'assistant', 8, [text('Final answer text')]),
]

function mount(props: { run?: ConversationRun; inputs?: readonly RunInput[]; working?: boolean } = {}) {
  return render(<Transcript run={props.run ?? run()} entries={entries} inputs={props.inputs ?? []} working={props.working ?? false} startLabel="start" />)
}

beforeEach(() => { updatePreferences({ locale: 'zh-CN' }) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('turn process', () => {
  it('folds the process of a finished turn behind a summary and keeps the answer visible', () => {
    mount()
    const summary = screen.getByRole('button', { name: /用时 8 秒 · 1 次工具调用/ })
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('Final answer text')).toBeTruthy()
    expect(screen.getByText('Stage instruction text')).toBeTruthy()
    expect(screen.queryByText('bash')).toBeNull()
    fireEvent.click(summary)
    expect(summary.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('bash')).toBeTruthy()
    fireEvent.click(summary)
    expect(screen.queryByText('bash')).toBeNull()
  })

  it('shows the process of the latest turn without a summary while the Agent works', () => {
    mount({ run: run({ status: 'running' }), working: true })
    expect(screen.getByText('bash')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /用时/ })).toBeNull()
  })

  it('keeps the latest turn open under a plain summary when the Run needs attention', () => {
    mount({ run: run({ status: 'blocked' }) })
    const summary = screen.getByRole('button', { name: /用时 8 秒/ })
    expect((summary as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('bash')).toBeTruthy()
  })

  it('folds earlier turns even when the Run needs attention', () => {
    render(<Transcript run={run({ status: 'blocked' })} working={false} startLabel="start" inputs={[]}
      entries={[...entries, message(5, 'user', 20, [text('second stage')]), message(6, 'assistant', 22, [text('second answer')])]} />)
    expect(screen.getAllByRole('button', { name: /用时/ }).map(button => (button as HTMLButtonElement).disabled)).toEqual([false])
    expect(screen.queryByText('bash')).toBeNull()
  })

  it('reads durations and counts in the selected language', () => {
    updatePreferences({ locale: 'en' })
    mount()
    expect(screen.getByRole('button', { name: /Took 8 s · 1 tool call$/ })).toBeTruthy()
  })
})

describe('inputs', () => {
  const given = (patch: Partial<RunInput>): RunInput => ({ revision: 1, kind: 'input', at: at(4), consumed: true, value: 'also check the logs', ...patch })

  it('shows supplemental text between the turns it arrived in', () => {
    mount({ inputs: [given({})] })
    expect(screen.getByText('补充信息', { exact: false })).toBeTruthy()
    expect(screen.getByText('also check the logs')).toBeTruthy()
  })

  it('marks an input the Run has not consumed yet, only while the Run is open', () => {
    mount({ inputs: [given({ consumed: false })] })
    expect(screen.getByText('待处理')).toBeTruthy()
    cleanup()
    mount({ run: run({ status: 'succeeded', outcome: 'succeeded', terminalAt: at(30) }), inputs: [given({ consumed: false })] })
    expect(screen.queryByText('待处理')).toBeNull()
  })

  it('shows a structured reply as labelled lines and a boolean reply as the chosen action', () => {
    mount({ inputs: [given({ kind: 'response', value: { decision: 'approve', note: 'ship it' } }), given({ revision: 2, kind: 'response', value: false })] })
    expect(screen.getAllByText('确认回复', { exact: false })).toHaveLength(2)
    expect(screen.getByText('decision')).toBeTruthy()
    expect(screen.getByText('ship it', { exact: false })).toBeTruthy()
    expect(screen.getByText('拒绝')).toBeTruthy()
  })
})

describe('expand control', () => {
  function taller(height: number) {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(height)
  }

  it('clips tall content and expands it on request', () => {
    taller(400)
    const { container } = render(<Clamp maxHeight={120}><p>tall body</p></Clamp>)
    const body = container.querySelector<HTMLElement>('.tw-clamp-body')
    expect(body?.style.maxHeight).toBe('120px')
    const toggle = screen.getByRole('button', { name: '展开全部' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(body?.style.maxHeight).toBe('')
    expect(screen.getByRole('button', { name: '收起' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('shows no control for content within the limit', () => {
    taller(100)
    render(<Clamp maxHeight={120}><p>short body</p></Clamp>)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('collapses a long stage instruction', () => {
    taller(900)
    mount()
    expect(screen.getAllByRole('button', { name: '展开全部' })).toHaveLength(1)
  })
})
