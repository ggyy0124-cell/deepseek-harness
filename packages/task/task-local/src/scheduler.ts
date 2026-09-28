/** Scheduler readiness follows recovery; disposal prevents late timer installation. */
import type { TaskDiagnostics } from '@deepseek-ai/dsh-task'

/** Own the recovery promise and timer until both are quiescent. */
export class TaskScheduler {
  private current: TaskDiagnostics['scheduler'] = 'starting'
  private pending: Promise<void> | undefined
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly intervalMs: number, private readonly recover: () => Promise<void>,
    private readonly tick: () => void, private readonly failure: (event: 'recovery' | 'tick') => void) {}

  /** Current recovery and timer availability. */
  get state(): TaskDiagnostics['scheduler'] { return this.current }

  /** Start once after the application tree is mounted.
   * @returns completion of recovery, with failures exposed through state and diagnostics.
   */
  start(): Promise<void> {
    if (this.pending !== undefined) return this.pending
    if (this.current !== 'starting') return Promise.resolve()
    this.pending = Promise.resolve().then(async () => {
      if (!this.canStart()) return
      try {
        await this.recover()
        if (!this.canStart()) return
        this.timer = setInterval(() => {
          try { this.tick() } catch { this.failure('tick') }
        }, this.intervalMs)
        this.current = 'running'
      } catch {
        if (this.current !== 'stopping') this.current = 'failed'
        this.failure('recovery')
      }
    })
    return this.pending
  }

  private canStart(): boolean { return this.current === 'starting' }

  /** Stop timer admission and await an already started recovery.
   * @returns recovery quiescence; stage draining belongs to the engine.
   */
  async close(): Promise<void> {
    this.current = 'stopping'
    clearInterval(this.timer)
    await this.pending
  }
}
