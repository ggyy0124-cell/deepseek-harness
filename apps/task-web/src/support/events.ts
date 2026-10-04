/** Task SSE subscription with cursor resumption, baseline signalling and reconnection. */
import type { TaskConnection } from './connection.ts'
import { isProblem } from './connection.ts'
import { Store } from './store.ts'
import type { TaskJournalEvent } from './types.ts'

/** Live connection indicator states. */
export type StreamState = 'connecting' | 'connected' | 'disconnected' | 'recovered'

/** Notification delivered to subscribers. */
export type StreamSignal =
  | { readonly kind: 'baseline' }
  | { readonly kind: 'event'; readonly event: TaskJournalEvent }

const RETRY_MS = [1000, 2000, 5000, 10000]
const RECENT_LIMIT = 40
const RECOVERED_MS = 4000

/** One Task event subscription shared by every page of the application. */
export class TaskEventHub {
  readonly state = new Store<StreamState>('connecting')
  readonly recent = new Store<readonly TaskJournalEvent[]>([])
  readonly cursor = new Store<string | null>(null)
  private readonly listeners = new Set<(signal: StreamSignal) => void>()
  private controller: AbortController | undefined
  private failures = 0

  constructor(private readonly connection: TaskConnection) {}

  /** Start or restart the subscription loop. */
  start(): void {
    this.stop()
    const controller = new AbortController()
    this.controller = controller
    void this.loop(controller.signal)
  }

  /** Stop the subscription and release the reader. */
  stop(): void {
    this.controller?.abort()
    this.controller = undefined
  }

  /** Reconnect immediately after a user request. */
  reconnect(): void {
    this.state.set('connecting')
    this.start()
  }

  /** Observe baselines and journal events.
   * @param listener - signal callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: (signal: StreamSignal) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(signal: StreamSignal): void {
    for (const listener of [...this.listeners]) listener(signal)
  }

  private async loop(signal: AbortSignal): Promise<void> {
    // Re-read after each await: cancellation arrives asynchronously.
    const aborted = () => signal.aborted
    while (!signal.aborted) {
      const resumed = this.failures > 0
      if (this.state.get() !== 'disconnected') this.state.set('connecting')
      try {
        const cursor = this.cursor.get()
        for await (const event of this.connection.client.events({ signal, ...(cursor === null ? {} : { cursor }) })) {
          this.cursor.set(event.cursor)
          if (event.kind === 'ready') {
            this.failures = 0
            if (resumed) {
              this.state.set('recovered')
              setTimeout(() => { if (this.state.get() === 'recovered') this.state.set('connected') }, RECOVERED_MS)
            } else this.state.set('connected')
            this.emit({ kind: 'baseline' })
            continue
          }
          this.recent.set([event, ...this.recent.get()].slice(0, RECENT_LIMIT))
          this.emit({ kind: 'event', event })
        }
      } catch (error) {
        if (aborted()) return
        if (isProblem(error, 'authentication_required')) { await this.connection.guard(() => Promise.reject(error)).catch(() => undefined); return }
        if (isProblem(error, 'cursor_stale', 'invalid_cursor')) this.cursor.set(null)
      }
      if (aborted()) return
      this.state.set('disconnected')
      const delay = RETRY_MS[Math.min(this.failures, RETRY_MS.length - 1)] ?? 10000
      this.failures++
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay)
        signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
      })
    }
  }
}
