/** Transcript loading: Session SSE for unfinished Runs, forward REST pages for ended Runs. */
import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../app/context.tsx'
import { describeFailure, isProblem, type RequestFailure } from './connection.ts'
import type { Run, TranscriptEntry, TranscriptRequest } from './types.ts'

/** Transcript feed state. */
export type TranscriptState = 'connecting' | 'live' | 'pending' | 'complete' | 'reconnecting'

/** Latest read failure and how many reads failed in a row since the last success. */
export interface TranscriptFailure {
  readonly error: RequestFailure
  readonly count: number
}

/** Feed of one Run's transcript. */
export interface TranscriptFeed {
  readonly entries: readonly TranscriptEntry[]
  /** Request headers (model configuration and tool schemas) in sequence order. */
  readonly requests: readonly TranscriptRequest[]
  readonly state: TranscriptState
  /** Present while reads keep failing; a Session that is not ready yet is not a failure. */
  readonly failure: TranscriptFailure | undefined
  /** Stop waiting and read again now. */
  readonly retry: () => void
}

const RETRY_MS = 2000

function merge<Item extends { readonly sequence: number }>(current: readonly Item[], items: readonly Item[]): readonly Item[] {
  if (items.length === 0) return current
  const known = new Set(current.map(entry => entry.sequence))
  const added = items.filter(entry => !known.has(entry.sequence))
  if (added.length === 0) return current
  return [...current, ...added].sort((left, right) => left.sequence - right.sequence)
}

/** Follow a Run's stored transcript.
 * @param run - execution; its terminal time selects the transport.
 * @returns messages and request headers in sequence order, the feed state, the latest read failure and a manual retry.
 */
export function useTranscript(run: Pick<Run, 'id' | 'terminalAt'> | undefined): TranscriptFeed {
  const { connection } = useApp()
  const [entries, setEntries] = useState<readonly TranscriptEntry[]>([])
  const [requests, setRequests] = useState<readonly TranscriptRequest[]>([])
  const [state, setState] = useState<TranscriptState>('connecting')
  const [failure, setFailure] = useState<TranscriptFailure | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const runId = run?.id
  const ended = run !== undefined && run.terminalAt !== null

  useEffect(() => { setEntries([]); setRequests([]); setState('connecting'); setFailure(undefined) }, [runId])

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
    const accept = (page: { readonly items: readonly TranscriptEntry[]; readonly requests: readonly TranscriptRequest[] }) => {
      setEntries(current => merge(current, page.items))
      setRequests(current => merge(current, page.requests))
    }
    const readPages = async () => {
      let cursor: string | undefined
      for (;;) {
        const page = await connection.call('getTranscript', { params: { runId }, query: cursor === undefined ? { limit: '200' } : { cursor, limit: '200' }, signal })
        setFailure(undefined)
        accept(page)
        cursor = page.nextCursor
        if (!page.hasMore) return
      }
    }
    const fail = (error: unknown) => {
      const pending = isProblem(error, 'session_unavailable')
      setState(pending ? 'pending' : 'reconnecting')
      setFailure(previous => (pending ? undefined : { error: describeFailure(error), count: (previous?.count ?? 0) + 1 }))
    }
    const follow = async () => {
      let cursor: string | undefined
      for (;;) {
        try {
          for await (const event of connection.client.sessionEvents({ runId, signal, ...(cursor === undefined ? {} : { cursor }) })) {
            if (event.kind === 'session_ready') { setState('live'); setFailure(undefined); continue }
            setFailure(undefined)
            accept(event.page)
            cursor = event.cursor
          }
        } catch (error) {
          if (signal.aborted) return
          if (isProblem(error, 'authentication_required')) { await connection.guard(() => Promise.reject(error)).catch(() => undefined); return }
          if (isProblem(error, 'cursor_stale', 'invalid_cursor')) { cursor = undefined; setEntries([]); setRequests([]) }
          fail(error)
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
          fail(error)
          await wait(RETRY_MS)
          if (aborted()) return
        }
      }
    }
    void run()
    return () => { controller.abort() }
  }, [connection, runId, ended, attempt])

  const retry = useCallback(() => { setAttempt(count => count + 1) }, [])
  return { entries, requests, state, failure, retry }
}
