/** Whole-log figures of a Run's Session, folded from the stored log by the Session projection units the Task host registered. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError, type SessionHandle, type SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionCheckpoint, ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
// Type-only: the `sessionStats`, `tokenUsage`, `contextPressure` and `contextBreakdown` projection key merges.
import type {} from '@deepseek-ai/dsh-session-stats/types'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { TaskRunId, TaskService } from '@deepseek-ai/dsh-task'
import type { runStatsSchema } from '@deepseek-ai/dsh-task-api-protocol'
import type { z } from 'zod'
import { HttpProblem } from './http.ts'
import { fingerprint } from './transcript.ts'

type RunStats = z.input<typeof runStatsSchema>

/** Projection state of one Session at a log position, kept so the next read folds only the events stored after it. */
interface Fold {
  readonly checkpoint: ProjectionCheckpoint
  /** Sequence of the last folded event; -1 before any event. */
  readonly endSeq: number
  /** Fingerprint of the event at `endSeq`, which the next read compares to detect a rewritten log. */
  readonly anchor: string
}

/** Last fold per Session, evicting the least recently read Session beyond the configured count. */
export class RunStatsCache {
  private readonly folds = new Map<string, Fold>()
  /** @param limit - Sessions whose fold is kept. */
  constructor(private readonly limit: number) {}
  /** Take the fold of a Session and mark it most recently used.
   * @param sessionId - Session identity.
   * @returns the stored fold, or undefined.
   */
  take(sessionId: string): Fold | undefined {
    const fold = this.folds.get(sessionId)
    if (fold !== undefined) {
      this.folds.delete(sessionId)
      this.folds.set(sessionId, fold)
    }
    return fold
  }
  /** Store the newest fold of a Session.
   * @param sessionId - Session identity.
   * @param fold - checkpoint at the end of the folded log.
   */
  put(sessionId: string, fold: Fold): void {
    this.folds.delete(sessionId)
    this.folds.set(sessionId, fold)
    for (const oldest of this.folds.keys()) {
      if (this.folds.size <= this.limit) break
      this.folds.delete(oldest)
    }
  }
}

/** Fold the log from a stored checkpoint, or from the first event when the checkpoint no longer matches the log. */
async function foldLog(projections: Pick<SessionProjectionRegistry, 'restore' | 'restoreFloor'>, handle: SessionHandle,
  cached: Fold | undefined, signal: AbortSignal): Promise<{ snapshot: ProjectionSnapshot; fold: Fold }> {
  const checkpoint = cached?.checkpoint ?? {}
  const floor = cached === undefined ? 0 : projections.restoreFloor(checkpoint) ?? 0
  const read = await handle.read(floor, undefined, { signal })
  signal.throwIfAborted()
  const first = read.events[0]
  // The checkpoint describes a different log when the event it ended at changed or is gone; refold from the start.
  if (cached !== undefined && (floor !== cached.endSeq || first === undefined || first.seq !== cached.endSeq
    || fingerprint(first) !== cached.anchor)) {
    return foldLog(projections, handle, undefined, signal)
  }
  const restored = projections.restore(checkpoint, read.events, SessionLogOffset(floor), handle.header, handle.inheritedEventCount)
  const last = read.events.at(-1)
  const fold = last === undefined
    ? { checkpoint: restored.checkpoint, endSeq: -1, anchor: '' }
    : { checkpoint: restored.checkpoint, endSeq: last.seq, anchor: fingerprint(last) }
  return { snapshot: restored.snapshot, fold }
}

/** Read the whole-log figures of a Run without preparing its Session or activating an Agent.
 * @param tasks - Task ownership lookup; arbitrary Session identities are never accepted.
 * @param persistence - existing read-only Session storage access.
 * @param projections - registry whose units fold the log; a figure is null when its unit is not registered.
 * @param cache - last fold per Session, so repeated reads of a growing log fold only the new events.
 * @param runId - execution selected by the authenticated owner.
 * @param signal - caller lifetime, including gateway disposal.
 * @returns figures as of the last stored event.
 */
export async function readRunStats(
  tasks: Pick<TaskService, 'getRun'>,
  persistence: Pick<SessionPersistence, 'open'>,
  projections: Pick<SessionProjectionRegistry, 'restore' | 'restoreFloor'>,
  cache: RunStatsCache,
  runId: string,
  signal: AbortSignal,
): Promise<RunStats> {
  signal.throwIfAborted()
  const run = tasks.getRun(brandString<TaskRunId>(runId))
  if (run === undefined) throw new HttpProblem(404, 'not_found', 'Task execution not found')
  try {
    await using handle = await persistence.open(run.sessionId, 'read', { signal })
    const { snapshot, fold } = await foldLog(projections, handle, cache.take(run.sessionId), signal)
    cache.put(run.sessionId, fold)
    const { sessionStats, tokenUsage, contextPressure, contextBreakdown } = snapshot.values
    return {
      runId: run.id,
      sessionId: run.sessionId,
      asOfSeq: snapshot.asOfSeq,
      session: sessionStats ?? null,
      usage: tokenUsage ?? null,
      context: contextPressure === undefined ? null : {
        pressureTokens: contextPressure.pressureTokens ?? null,
        projectedTokens: contextPressure.projectedTokens ?? null,
        contextWindow: contextPressure.contextWindow ?? null,
      },
      composition: contextBreakdown ?? null,
    }
  } catch (error) {
    if (error instanceof SessionPersistenceNotFoundError)
      throw new HttpProblem(409, 'session_unavailable', 'Task Session is not available yet')
    throw error
  }
}
