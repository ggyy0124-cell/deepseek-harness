/** Minimal observable value for `useSyncExternalStore`. */
import { useSyncExternalStore } from 'react'

/** Holds one value and notifies subscribers after each replacement. */
export class Store<Value> {
  private readonly listeners = new Set<() => void>()
  constructor(private value: Value) {}
  /** Current value.
   * @returns latest snapshot.
   */
  get(): Value { return this.value }
  /** Replace the value and notify subscribers.
   * @param value - next snapshot.
   */
  set(value: Value): void {
    if (Object.is(value, this.value)) return
    this.value = value
    for (const listener of [...this.listeners]) listener()
  }
  /** Observe replacements.
   * @param listener - change callback.
   * @returns unsubscribe function.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

/** Read a store inside React.
 * @param store - observable value.
 * @returns current snapshot, re-rendering on change.
 */
export function useStore<Value>(store: Store<Value>): Value {
  return useSyncExternalStore(store.subscribe, () => store.get())
}
