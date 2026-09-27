/** Stable admission errors for administrative consumers. */

/** Rejected command categories independent of HTTP or RPC transports. */
export type TaskCommandErrorCode = 'not_found' | 'revision_conflict' | 'idempotency_conflict' | 'read_only' | 'stale_interaction'
  | 'invalid_state' | 'invalid_configuration' | 'unavailable'

/** A caller-correctable rejection; messages contain no submitted business content. */
export class TaskCommandError extends Error {
  /**
   * @param code - stable rejection category.
   * @param message - safe diagnostic description.
   * @param currentRevision - authoritative revision for optimistic concurrency conflicts.
   */
  constructor(readonly code: TaskCommandErrorCode, message: string, readonly currentRevision?: number) {
    super(message)
    this.name = 'TaskCommandError'
  }
}
