/** In-memory failure counting for browser password login; counters reset when the gateway restarts. */

/** Failure budget per subject inside one window and the lock that follows it. */
export interface LoginThrottleOptions {
  readonly maxFailures: number
  readonly failureWindowMs: number
  readonly lockoutMs: number
  readonly clock: () => number
}

interface Subject {
  /** Start of the current failure window. */
  windowStart: number
  failures: number
  /** Lock end, or 0 while unlocked. */
  lockedUntil: number
}

/** Counts failed logins per subject (a client address or a username) and locks a subject that exhausts its budget. */
export class LoginThrottle {
  private readonly subjects = new Map<string, Subject>()
  constructor(private readonly options: LoginThrottleOptions) {}
  /** Report the longest remaining lock among the subjects.
   * @param keys - subjects of one attempt.
   * @returns remaining lock in milliseconds; 0 when every subject may try.
   */
  retryAfterMs(keys: readonly string[]): number {
    const now = this.prune()
    return Math.max(0, ...keys.map(key => (this.subjects.get(key)?.lockedUntil ?? 0) - now))
  }
  /** Count one failed attempt for each subject; the attempt that reaches the budget starts the lock.
   * @param keys - subjects of the failed attempt.
   */
  fail(keys: readonly string[]): void {
    const now = this.prune()
    for (const key of keys) {
      const subject = this.subjects.get(key) ?? { windowStart: now, failures: 0, lockedUntil: 0 }
      subject.failures++
      if (subject.failures >= this.options.maxFailures) {
        subject.lockedUntil = now + this.options.lockoutMs
        subject.failures = 0
        subject.windowStart = now
      }
      this.subjects.set(key, subject)
    }
  }
  /** Forget the failures of subjects after a successful login.
   * @param keys - subjects of the successful attempt.
   */
  clear(keys: readonly string[]): void {
    for (const key of keys) this.subjects.delete(key)
  }
  /** Drop expired windows and locks so the map holds only subjects that still constrain a login. */
  private prune(): number {
    const now = this.options.clock()
    for (const [key, subject] of this.subjects) {
      if (subject.lockedUntil > now) continue
      if (subject.lockedUntil !== 0 || now - subject.windowStart >= this.options.failureWindowMs) this.subjects.delete(key)
    }
    return now
  }
}
