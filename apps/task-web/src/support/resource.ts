/** Request hooks that refresh after Task events. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../app/context.tsx'
import { describeFailure, type RequestFailure } from './connection.ts'

/** Loading, value and failure of one gateway read. */
export interface Resource<Value> {
  readonly value: Value | undefined
  readonly error: RequestFailure | undefined
  readonly loading: boolean
  /** Fetch again now. */
  readonly reload: () => void
}

const EVENT_DEBOUNCE_MS = 250

/** Load a value and reload it after every Task baseline or journal event that `affects` accepts.
 * @param key - identity of the request; a change reloads.
 * @param load - gateway read; receives an abort signal.
 * @param options.live - reload after Task events (default true).
 * @param options.affects - event filter; default accepts every event.
 * @returns the current resource state.
 */
export function useResource<Value>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<Value>,
  options: { live?: boolean; affects?: (runId: string | null, event: string) => boolean } = {},
): Resource<Value> {
  const { events } = useApp()
  const [state, setState] = useState<{ key: string | null; value: Value | undefined; error: RequestFailure | undefined; loading: boolean }>(
    { key, value: undefined, error: undefined, loading: key !== null },
  )
  const [generation, setGeneration] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load
  const affectsRef = useRef(options.affects)
  affectsRef.current = options.affects
  const live = options.live ?? true

  const reload = useCallback(() => { setGeneration(value => value + 1) }, [])

  useEffect(() => {
    if (key === null) return
    const controller = new AbortController()
    setState(previous => ({ key, value: previous.key === key ? previous.value : undefined, error: undefined, loading: true }))
    loadRef.current(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setState({ key, value, error: undefined, loading: false }) },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState(previous => ({ key, value: previous.key === key ? previous.value : undefined, error: describeFailure(error),
          loading: false }))
      },
    )
    return () => { controller.abort() }
  }, [key, generation])

  useEffect(() => {
    if (!live || key === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = events.subscribe((signal) => {
      if (signal.kind === 'event' && affectsRef.current !== undefined && !affectsRef.current(signal.event.runId, signal.event.event)) return
      clearTimeout(timer)
      timer = setTimeout(reload, EVENT_DEBOUNCE_MS)
    })
    return () => { clearTimeout(timer); unsubscribe() }
  }, [events, live, key, reload])

  return { value: state.key === key ? state.value : undefined, error: state.error, loading: state.loading, reload }
}
