/** Durable interaction admission paired with exactly one live answerer lifetime. */
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  TaskCommandError,
  type TaskInteraction,
  type TaskRunId,
  type TaskWaitId,
} from '@deepseek-ai/dsh-task'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { TaskDatabase } from './database.ts'
import { validateForm } from './forms.ts'

/** Persists requests and resolves the corresponding in-process waiter only after response commit. */
export class RuntimeInteractions {
  private readonly waiters = new Map<
    TaskWaitId,
    { resolve: (value: JsonValue) => void; reject: (error: Error) => void }
  >()
  constructor(
    private readonly db: TaskDatabase,
    private readonly clock: () => number,
    private readonly audit: (run: TaskRunId, event: string) => void,
  ) {
    db.transaction(() => {
      for (const request of db.interactions())
        if (request.state === 'waiting') {
          db.putInteraction({ ...request, state: 'withdrawn' })
          audit(request.runId, 'interaction.interrupted')
        }
    })
  }
  /** Determine whether a reply addresses a runtime interaction.
   * @param id - interaction identity.
   * @returns whether a retained record exists.
   */
  has(id: TaskWaitId): boolean {
    return this.db.interactions().some(value => value.id === id)
  }
  /** Persist one runtime question before exposing it to clients.
   * @param runId - live owning execution.
   * @param request - question fields excluding storage-owned identity and status.
   * @param signal - tool lifetime; withdrawal rejects the waiter.
   * @returns the first committed valid answer.
   */
  async ask(
    runId: TaskRunId,
    request: Pick<TaskInteraction, 'source' | 'title' | 'description' | 'schema' | 'callId' | 'questions' | 'expiresAt'>,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    signal.throwIfAborted()
    const run = this.db.run(runId)
    if (run === undefined || run.status !== 'running')
      throw new Error('Task interaction requires an admitted stage')
    const id = brandString<TaskWaitId>(randomUUID())
    const record: TaskInteraction = {
      ...request,
      id,
      runId,
      revision: run.inputRevision,
      createdAt: this.clock(),
      state: 'waiting',
      answer: null,
    }
    const answer = new Promise<JsonValue>((resolve, reject) => {
      this.waiters.set(id, { resolve, reject })
    })
    // Observe early withdrawal even when durable admission itself fails.
    void answer.catch(() => {})
    const abort = () => {
      this.withdraw(id)
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      this.db.transaction(() => {
        this.db.putInteraction(record)
        this.audit(runId, 'interaction.opened')
      })
      signal.throwIfAborted()
      return await answer
    } finally {
      signal.removeEventListener('abort', abort)
      this.waiters.delete(id)
    }
  }
  /** Commit one version-bound answer; the enclosing command transaction owns the retry receipt.
   * @param runId - execution selected by the route.
   * @param id - exact interaction.
   * @param revision - observed input revision.
   * @param answer - schema-validated decision or question answers.
   */
  respond(runId: TaskRunId, id: TaskWaitId, revision: number, answer: JsonValue): void {
    const request = this.db.interactions(runId).find(value => value.id === id)
    const run = this.db.run(runId)
    if (
      request === undefined ||
      request.state !== 'waiting' ||
      !this.waiters.has(id) ||
      run?.status !== 'running' ||
      run.inputRevision !== revision ||
      request.revision !== revision ||
      (request.expiresAt !== null && request.expiresAt <= this.clock())
    ) {
      throw new TaskCommandError('stale_interaction', 'Task interaction is stale or withdrawn')
    }
    validateForm(request.schema, answer)
    this.db.putInteraction({ ...request, state: 'answered', answer })
    this.audit(runId, 'interaction.answered')
    this.db.afterCommit(() => {
      this.waiters.get(id)?.resolve(answer)
    })
  }
  /** Withdraw obsolete or expired questions without changing the owning stage state. */
  expire(): void {
    for (const request of this.db.interactions()) {
      if (request.state !== 'waiting') continue
      const run = this.db.run(request.runId)
      if (
        run?.status !== 'running' ||
        run.inputRevision !== request.revision ||
        (request.expiresAt !== null && request.expiresAt <= this.clock())
      )
        this.withdraw(request.id)
    }
  }
  private withdraw(id: TaskWaitId): void {
    const request = this.db.interactions().find(value => value.id === id)
    if (request?.state === 'waiting')
      this.db.transaction(() => {
        this.db.putInteraction({ ...request, state: 'withdrawn' })
        this.audit(request.runId, 'interaction.withdrawn')
      })
    this.waiters.get(id)?.reject(new Error('Task interaction withdrawn'))
  }
}
