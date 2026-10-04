/** Transcript loading: Session SSE for unfinished Runs, forward REST pages for ended Runs. */
import { useEffect, useState } from 'react'
import { useApp } from '../app/context.tsx'
import { isProblem } from './connection.ts'
import type { Run, TranscriptEntry } from './types.ts'

/** Transcript feed state. */
export type TranscriptState = 'connecting' | 'live' | 'pending' | 'complete' | 'reconnecting'

const RETRY_MS = 2000

function merge(current: readonly TranscriptEntry[], items: readonly TranscriptEntry[]): readonly TranscriptEntry[] {
  if (items.length === 0) return current
  const known = new Set(current.map(entry => entry.sequence))
  const added = items.filter(entry => !known.has(entry.sequence))
  if (added.length === 0) return current
  return [...current, ...added].sort((left, right) => left.sequence - right.sequence)
}

/** Follow a Run's stored transcript.
 * @param run - execution; its terminal time selects the transport.
 * @returns messages in sequence order and the feed state.
 */
export function useTranscript(run: Pick<Run, 'id' | 'terminalAt'> | undefined): { entries: readonly TranscriptEntry[]; state: TranscriptState } {
  const { connection } = useApp()
  const [entries, setEntries] = useState<readonly TranscriptEntry[]>([])
  const [state, setState] = useState<TranscriptState>('connecting')
  const runId = run?.id
  const ended = run !== undefined && run.terminalAt !== null

  useEffect(() => { setEntries([]); setState('connecting') }, [runId])

  useEffect(() => {
    if (runId === undefined) return
    const controller = new AbortController()
    const { signal } = controller
    // Re-read after each await: cancellation arrives asynchronously.
    const aborted = () => signal.aborted
    const wait = (ms: number) => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
    })
    const readPages = async () => {
      let cursor: string | undefined
      for (;;) {
        const page = await connection.call('getTranscript', { params: { runId }, query: cursor === undefined ? { limit: '200' } : { cursor, limit: '200' }, signal })
        setEntries(current => merge(current, page.items))
        cursor = page.nextCursor
        if (!page.hasMore) return
      }
    }
    const follow = async () => {
      let cursor: string | undefined
      for (;;) {
        try {
          for await (const event of connection.client.sessionEvents({ runId, signal, ...(cursor === undefined ? {} : { cursor }) })) {
            if (event.kind === 'session_ready') { setState('live'); continue }
            setEntries(current => merge(current, event.page.items))
            cursor = event.cursor
          }
        } catch (error) {
          if (signal.aborted) return
          if (isProblem(error, 'authentication_required')) { await connection.guard(() => Promise.reject(error)).catch(() => undefined); return }
          if (isProblem(error, 'cursor_stale', 'invalid_cursor')) { cursor = undefined; setEntries([]) }
          setState(isProblem(error, 'session_unavailable') ? 'pending' : 'reconnecting')
        }
        if (signal.aborted) return
        await wait(RETRY_MS)
      }
    }
    const run = async () => {
      for (;;) {
        try {
          if (ended) { await readPages(); setState('complete'); return }
          await follow()
          return
        } catch (error) {
          if (aborted()) return
          setState(isProblem(error, 'session_unavailable') ? 'pending' : 'reconnecting')
          await wait(RETRY_MS)
          if (aborted()) return
        }
      }
    }
    void run()
    return () => { controller.abort() }
  }, [connection, runId, ended])

  return { entries, state }
}
