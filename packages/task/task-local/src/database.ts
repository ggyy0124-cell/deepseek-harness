/** Single-host transactional task persistence and durable Session flush outbox. */
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { mkdirSync, openSync, closeSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { TaskCommandError } from '@deepseek-ai/dsh-task'
import type { TaskRunQuery, TaskRunPage, TaskResourceRecord, TaskDiagnostics, TaskRetirement, TaskDefinitionId, TaskInteraction, TaskDefinitionView, TaskInput, TaskJournalEntry, TaskRun, TaskRunId, TaskStoreId } from '@deepseek-ai/dsh-task'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { retirementRecordSchema, definitionSchema, runSchema } from './schema.ts'

/** Monotonic database schema generation. */
export const SCHEMA_VERSION = 8

/** One foreground child belongs to one model operation of a Task Run. */
export interface TaskChildRecord {
  readonly sessionId: SessionId
  readonly runId: TaskRunId
  readonly modelKey: string
  readonly state: 'prepared' | 'active' | 'interrupted' | 'complete'
}

const childRowSchema = z.object({
  session_id: z.string().min(1),
  run_id: z.string().min(1),
  model_key: z.string().min(1),
  state: z.enum(['prepared', 'active', 'interrupted', 'complete']),
})

function childRecord(raw: unknown): TaskChildRecord {
  const row = childRowSchema.parse(raw)
  return {
    sessionId: brandString<SessionId>(row.session_id), runId: brandString<TaskRunId>(row.run_id),
    modelKey: row.model_key, state: row.state,
  }
}

const calendarScanSchema = z.object({
  from: z.number(), through: z.number(), count: z.number().int().nonnegative(), last: z.number().nullable(),
  pressured: z.boolean(),
})
/** A coalesced or skipped range remains durable while multiple bounded scans complete. */
export type CalendarScan = z.infer<typeof calendarScanSchema>

/** JSON row read through a fixed SELECT statement. */
type Document = { value: string }
/** One unacknowledged Session durability barrier. */
export interface OutboxEntry { readonly id: number; readonly run: TaskRun }

/** Own one SQLite connection and an OS-released exclusive writer lock. */
export class TaskDatabase {
  /** Stable identity retained across schema migrations and process restarts. */
  readonly id: TaskStoreId
  private transactionDepth = 0
  private readonly db: DatabaseSync
  private readonly lock: DatabaseSync | undefined
  private closed = false
  private commitObservers: (() => void)[] | undefined

  /**
   * @param path - local database file or :memory: for a transient provider.
   */
  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      // SQLite holds the lock until connection/process death. No heartbeat or stale-owner takeover.
      this.lock = new DatabaseSync(`${path}.owner`)
      try { this.lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE') }
      catch (error) { this.lock.close(); throw new Error('task database already has an active host', { cause: error }) }
      try { closeSync(openSync(path, 'ax', 0o600)) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { this.lock.close(); throw error }
      }
    }
    let opened: DatabaseSync | undefined
    try {
      opened = new DatabaseSync(path)
      this.db = opened
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0')
      const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
      if (version.user_version > SCHEMA_VERSION) throw new Error(`unsupported task database version ${version.user_version}`)
      if (version.user_version === 0) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE definitions(id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        CREATE TABLE runs(id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, definition_id TEXT NOT NULL,
          business_key TEXT, terminal_at REAL, value TEXT NOT NULL) STRICT;
        CREATE INDEX active_runs ON runs(terminal_at) WHERE terminal_at IS NULL;
        CREATE UNIQUE INDEX active_business ON runs(definition_id,business_key) WHERE terminal_at IS NULL AND business_key IS NOT NULL;
        CREATE TABLE requests(scope TEXT NOT NULL, id TEXT NOT NULL, input TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,id)) STRICT;
        CREATE TABLE inputs(run_id TEXT NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(run_id,revision)) STRICT;
        CREATE TABLE observations(run_id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        CREATE TABLE associations(parent_id TEXT NOT NULL, request_id TEXT NOT NULL, run_id TEXT NOT NULL, PRIMARY KEY(parent_id,request_id)) STRICT;
        CREATE TABLE operations(run_id TEXT NOT NULL, id TEXT NOT NULL, state TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(run_id,id)) STRICT;
        CREATE TABLE resources(name TEXT PRIMARY KEY, run_id TEXT NOT NULL) STRICT;
        CREATE TABLE journal(sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, event TEXT NOT NULL, at REAL NOT NULL, details TEXT NOT NULL) STRICT;
        CREATE TABLE session_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, value TEXT NOT NULL) STRICT;
        PRAGMA user_version=1;
        COMMIT;
      `)
      if (version.user_version < 2) this.transaction(() => {
        this.db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
        this.db.prepare('INSERT INTO metadata VALUES (?,?)').run('store_id', randomUUID())
        this.db.exec('PRAGMA user_version=2')
      })
      if (version.user_version < 3) this.transaction(() => {
        this.db.exec('CREATE TABLE calendar_scans(definition_id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT; PRAGMA user_version=3')
      })
      if (version.user_version < 4) this.transaction(() => {
        this.db.exec('CREATE TABLE interactions(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, value TEXT NOT NULL) STRICT; CREATE INDEX interactions_run ON interactions(run_id); PRAGMA user_version=4')
      })
      if (version.user_version < 5) this.transaction(() => {
        this.db.exec(`CREATE TABLE retirements(definition_id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
          ALTER TABLE resources RENAME TO resources_v4;
          CREATE TABLE resources(name TEXT NOT NULL, run_id TEXT NOT NULL, PRIMARY KEY(name,run_id)) STRICT;
          INSERT INTO resources SELECT * FROM resources_v4;
          DROP TABLE resources_v4;
          CREATE INDEX resource_owners ON resources(run_id);
          PRAGMA user_version=5`)
      })
      if (version.user_version < 6) this.transaction(() => {
        this.db.exec('CREATE TABLE managed_resources(run_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(run_id,key)) STRICT; PRAGMA user_version=6')
      })
      if (version.user_version < 7) this.transaction(() => {
        this.db.exec(`CREATE INDEX run_definition_history ON runs(definition_id);
          CREATE INDEX run_status_history ON runs((value->>'status'));
          CREATE INDEX run_created_history ON runs((value->>'createdAt'));
          CREATE INDEX run_kind_history ON runs((value->>'kind'));
          CREATE INDEX run_business_history ON runs(business_key);
          PRAGMA user_version=7`)
      })
      if (version.user_version < 8) this.transaction(() => {
        this.db.exec(`CREATE TABLE task_children(session_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
          model_key TEXT NOT NULL, state TEXT NOT NULL) STRICT;
          CREATE INDEX task_children_run ON task_children(run_id,model_key);
          PRAGMA user_version=8`)
      })
      const identity = this.db.prepare("SELECT value FROM metadata WHERE key='store_id'").get()
      this.id = brandString<TaskStoreId>(z.object({ value: z.uuid() }).parse(identity).value)
    } catch (error) { opened?.close(); this.lock?.close(); throw error }
  }

  /** Commit a synchronous operation atomically.
   * @param operation - no awaited work.
   * @returns its result.
   */
  transaction<T>(operation: () => T): T {
    if (this.commitObservers !== undefined) {
      const observers = this.commitObservers
      const offset = observers.length
      const savepoint = `nested_${this.transactionDepth++}`
      this.db.exec(`SAVEPOINT ${savepoint}`)
      try {
        const result = operation()
        this.db.exec(`RELEASE ${savepoint}`)
        return result
      } catch (error) {
        this.db.exec(`ROLLBACK TO ${savepoint}`)
        this.db.exec(`RELEASE ${savepoint}`)
        observers.length = offset
        throw error
      } finally { this.transactionDepth-- }
    }
    this.db.exec('BEGIN IMMEDIATE')
    this.commitObservers = []
    let result: T
    let observers: (() => void)[]
    try { result = operation(); this.db.exec('COMMIT'); observers = this.commitObservers }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
    finally { this.commitObservers = undefined }
    for (const observer of observers) observer()
    return result
  }
  /** Publish operational diagnostics only after the owning transaction commits.
   *
   * @param observer - nonthrowing diagnostic callback.
   */
  afterCommit(observer: () => void): void {
    if (this.commitObservers === undefined) observer()
    else this.commitObservers.push(observer)
  }
  /** Save private code-loading evidence for crash recovery.
   * @param id - business definition.
   * @param value - JSON configuration and original module identity.
   */
  putPluginSource(id: TaskDefinitionId, value: JsonValue): void {
    this.db.prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`plugin_source:${id}`, JSON.stringify(value))
  }
  /** Read untrusted code-loading evidence from durable storage.
   * @param id - business definition.
   * @returns parsed JSON, validated by the recovery consumer.
   */
  pluginSource(id: TaskDefinitionId): unknown {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(`plugin_source:${id}`)
    return row === undefined ? undefined : JSON.parse(String(row['value']))
  }
  /** Select one bounded insertion-order history page in SQLite.
   * @param query - typed filters and pagination anchors.
   * @returns validated runs without materializing unrelated payloads.
   */
  queryRuns(query: TaskRunQuery): TaskRunPage {
    const head = (query.head === undefined
      ? this.db.prepare('SELECT rowid,id FROM runs ORDER BY rowid DESC LIMIT 1').get()
      : this.db.prepare('SELECT rowid,id FROM runs WHERE id=?').get(query.head)) as { rowid: number; id: TaskRunId } | undefined
    if (head === undefined) {
      if (query.head !== undefined) throw new TaskCommandError('invalid_state', 'Task page anchor is unavailable')
      return { items: [], head: null, hasMore: false }
    }
    const where = ['rowid<=?']
    const args: (string | number)[] = [head.rowid]
    for (const [column, value] of [
      ['definition_id', query.definitionId], ["value->>'status'", query.status], ["value->>'kind'", query.kind], ['business_key', query.businessKey],
    ] as const) if (value !== undefined) { where.push(`${column}=?`); args.push(value) }
    if (query.createdFrom !== undefined) { where.push("value->>'createdAt'>=?"); args.push(query.createdFrom) }
    if (query.createdTo !== undefined) { where.push("value->>'createdAt'<=?"); args.push(query.createdTo) }
    if (query.after !== undefined) {
      const after = this.db.prepare(`SELECT rowid FROM runs WHERE ${where.join(' AND ')} AND id=?`).get(...args, query.after) as { rowid: number } | undefined
      if (after === undefined) throw new TaskCommandError('invalid_state', 'Task page membership changed; restart pagination')
      where.push('rowid<?'); args.push(after.rowid)
    }
    const rows = this.db.prepare(`SELECT value FROM runs WHERE ${where.join(' AND ')} ORDER BY rowid DESC LIMIT ?`)
      .all(...args, query.limit + 1) as Document[]
    return { items: rows.slice(0, query.limit).map(row => runSchema.parse(JSON.parse(row.value))),
      head: head.id, hasMore: rows.length > query.limit }
  }
  /** Read one execution's durable owned resources.
   * @param runId - resource owner.
   * @returns validated records in acquisition order.
   */
  managedResources(runId: TaskRunId): TaskResourceRecord[] {
    return (this.db.prepare('SELECT value FROM managed_resources WHERE run_id=? ORDER BY rowid').all(runId) as Document[])
      .map(row => resourceSchema.parse(JSON.parse(row.value)) as TaskResourceRecord)
  }
  /** Persist acquisition or cleanup evidence before publishing its result.
   * @param record - owned resource state.
   */
  putResource(record: TaskResourceRecord): void {
    this.db.prepare('INSERT INTO managed_resources VALUES (?,?,?) ON CONFLICT(run_id,key) DO UPDATE SET value=excluded.value')
      .run(record.runId, record.key, JSON.stringify(resourceSchema.parse(record)))
  }
  /** Aggregate history without loading business payloads.
   * @param capacities - configured capacity overrides.
   * @returns counters and current resource holders.
   */
  diagnostics(capacities: Readonly<Record<string, number>>): Omit<TaskDiagnostics, 'scheduler' | 'concurrency' | 'activePermits' | 'storage'> {
    const counts = this.db.prepare(`SELECT count(*) totalRuns,
      coalesce(sum(terminal_at IS NULL),0) activeRuns,
      coalesce(sum(terminal_at IS NOT NULL),0) completedRuns,
      coalesce(sum(terminal_at IS NULL AND value->>'status' IN ('provisioning','queued','recovering')),0) queuedRuns,
      min(CASE WHEN terminal_at IS NULL AND value->>'status' IN ('provisioning','queued','recovering') THEN value->>'createdAt' END) oldestQueuedAt,
      coalesce(sum(terminal_at IS NULL AND value->>'status'='blocked'),0) recoveryErrors,
      coalesce(sum(value->>'cleanup'='blocked'),0) cleanupFailures FROM runs`).get() as
      Pick<TaskDiagnostics, 'totalRuns' | 'activeRuns' | 'completedRuns' | 'queuedRuns' | 'oldestQueuedAt' | 'recoveryErrors' | 'cleanupFailures'>
    const outbox = this.db.prepare("SELECT count(*) outboxPending, min(value->>'updatedAt') oldestOutboxAt FROM session_outbox").get() as
      Pick<TaskDiagnostics, 'outboxPending' | 'oldestOutboxAt'>
    const inputs = this.db.prepare(`SELECT (SELECT count(*) FROM inputs WHERE consumed=0) +
      (SELECT count(*) FROM interactions WHERE value->>'state'='waiting') +
      (SELECT count(*) FROM runs WHERE terminal_at IS NULL AND value->>'status'='waiting_input') pendingInputs`).get() as { pendingInputs: number }
    const owners = this.db.prepare('SELECT name,run_id FROM resources ORDER BY name,run_id').all() as { name: string; run_id: TaskRunId }[]
    const resources = new Map<string, TaskRunId[]>()
    for (const owner of owners) resources.set(owner.name, [...(resources.get(owner.name) ?? []), owner.run_id])
    return { ...counts, ...outbox, ...inputs,
      resources: [...resources].map(([name, runIds]) => ({ name, capacity: capacities[name] ?? 1, runIds })),
      retirements: this.retirements().filter(value => value.state !== 'complete') }
  }
  /** Read retained runtime interactions.
   * @param runId - execution filter, or all records during recovery.
   * @returns validated interaction records.
   */
  interactions(runId?: TaskRunId): TaskInteraction[] {
    const rows = (runId === undefined ? this.db.prepare('SELECT value FROM interactions').all()
      : this.db.prepare('SELECT value FROM interactions WHERE run_id=?').all(runId)) as Document[]
    return rows.map(row => interactionRecord.parse(JSON.parse(row.value)) as TaskInteraction)
  }
  /** Persist the latest state of one runtime request.
   * @param value - validated request and response state.
   */
  putInteraction(value: TaskInteraction): void {
    this.db.prepare('INSERT INTO interactions VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(value.id, value.runId, JSON.stringify(interactionRecord.parse(value)))
  }
  /** Read definitions.
   * @returns validated snapshots.
   */
  definitions(): TaskDefinitionView[] {
    return (this.db.prepare('SELECT value FROM definitions ORDER BY id').all() as Document[]).map(row => definitionSchema.parse(JSON.parse(row.value)))
  }
  /** Persist one definition.
   * @param value - resolved definition.
   */
  putDefinition(value: TaskDefinitionView): void {
    this.db.prepare('INSERT INTO definitions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(value.id, JSON.stringify(definitionSchema.parse(value)))
  }
  /** Read durable retirement intents, including completed removal evidence.
   * @returns validated lifecycle operations.
   */
  retirements(): TaskRetirement[] {
    return (this.db.prepare('SELECT value FROM retirements ORDER BY definition_id').all() as Document[])
      .map(row => retirementRecordSchema.parse(JSON.parse(row.value)))
  }
  /** Persist retirement before aborting any owned operation.
   * @param value - lifecycle intent or settlement.
   */
  putRetirement(value: TaskRetirement): void {
    this.db.prepare('INSERT INTO retirements VALUES (?,?) ON CONFLICT(definition_id) DO UPDATE SET value=excluded.value')
      .run(value.definitionId, JSON.stringify(retirementRecordSchema.parse(value)))
  }
  /** Locate the current retirement of one definition.
   * @param id - stable business identity.
   * @returns the latest recorded removal, when present.
   */
  retirement(id: TaskDefinitionId): TaskRetirement | undefined {
    return this.retirements().find(value => value.definitionId === id)
  }
  /** Read an unfinished missed-range scan.
   * @param id - business definition.
   * @returns the accumulated range if scanning is in progress.
   */
  calendarScan(id: string): CalendarScan | undefined {
    const row = this.db.prepare('SELECT value FROM calendar_scans WHERE definition_id=?').get(id) as Document | undefined
    return row === undefined ? undefined : calendarScanSchema.parse(JSON.parse(row.value))
  }
  /** Persist scan progress together with the schedule cursor.
   * @param id - business definition.
   * @param scan - accumulated range, or null after completion.
   */
  putCalendarScan(id: string, scan: CalendarScan | null): void {
    if (scan === null) this.db.prepare('DELETE FROM calendar_scans WHERE definition_id=?').run(id)
    else this.db.prepare('INSERT INTO calendar_scans VALUES (?,?) ON CONFLICT(definition_id) DO UPDATE SET value=excluded.value')
      .run(id, JSON.stringify(scan))
  }
  /** Read executions.
   * @returns validated immutable-by-copy snapshots.
   */
  runs(): TaskRun[] {
    return (this.db.prepare('SELECT value FROM runs ORDER BY rowid').all() as Document[]).map(row => runSchema.parse(JSON.parse(row.value)))
  }
  /** Read unfinished executions without scanning retained history.
   * @returns active snapshots.
   */
  activeRuns(): TaskRun[] {
    return (this.db.prepare('SELECT value FROM runs WHERE terminal_at IS NULL ORDER BY rowid').all() as Document[]).map(row => runSchema.parse(JSON.parse(row.value)))
  }
  /** Locate the first run retaining a shared preset revision.
   * @param run - execution whose configuration was inherited.
   * @returns revision owner, or the supplied run before insertion.
   */
  revisionOwner(run: TaskRun): TaskRun {
    const row = this.db.prepare(`SELECT value FROM runs WHERE definition_id=?
      AND json_extract(value,'$.configRevision')=? AND json_extract(value,'$.codeVersion')=? ORDER BY rowid LIMIT 1`)
      .get(run.definitionId, run.configRevision, run.codeVersion) as Document | undefined
    return row === undefined ? run : runSchema.parse(JSON.parse(row.value))
  }
  /** Resolve Session ownership through its unique index.
   * @param id - Session identity.
   * @returns owning execution.
   */
  forSession(id: string): TaskRun | undefined {
    const row = this.db.prepare('SELECT value FROM runs WHERE session_id=?').get(id) as Document | undefined
    return row === undefined ? undefined : runSchema.parse(JSON.parse(row.value))
  }
  /** Read one execution.
   * @param id - run identity.
   * @returns its snapshot if present.
   */
  run(id: TaskRunId): TaskRun | undefined {
    const row = this.db.prepare('SELECT value FROM runs WHERE id=?').get(id) as Document | undefined
    return row === undefined ? undefined : runSchema.parse(JSON.parse(row.value))
  }
  /** Persist a run and require its Session to reach a durability barrier.
   * @param run - next snapshot.
   */
  putRun(run: TaskRun): void {
    const value = JSON.stringify(runSchema.parse(run))
    this.db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET terminal_at=excluded.terminal_at,value=excluded.value')
      .run(run.id, run.sessionId, run.definitionId, run.businessKey, run.terminalAt, value)
    this.db.prepare('INSERT INTO session_outbox(run_id,value) VALUES (?,?)').run(run.id, value)
  }
  /** Reserve child identity before its Session can be created.
   * @param child - durable parent and operation identity.
   */
  reserveChild(child: TaskChildRecord): void {
    this.db.prepare('INSERT INTO task_children VALUES (?,?,?,?)')
      .run(child.sessionId, child.runId, child.modelKey, child.state)
  }
  /** Read a child Session's Task owner.
   * @param id - child Session identity.
   * @returns saved child relation, if any.
   */
  child(id: SessionId): TaskChildRecord | undefined {
    const raw = this.db.prepare('SELECT session_id,run_id,model_key,state FROM task_children WHERE session_id=?').get(id)
    return raw === undefined ? undefined : childRecord(raw)
  }
  /** Read all children of one model operation, including settled history.
   * @param runId - owning Task execution.
   * @param modelKey - durable model operation identity.
   * @returns children in reservation order.
   */
  children(runId: TaskRunId, modelKey: string): readonly TaskChildRecord[] {
    const rows = this.db.prepare('SELECT session_id,run_id,model_key,state FROM task_children WHERE run_id=? AND model_key=? ORDER BY rowid').all(runId, modelKey)
    return rows.map(childRecord)
  }
  /** Read every child retained by one Task execution.
   * @param runId - owning Task execution.
   * @returns durable child identities in reservation order.
   */
  childrenForRun(runId: TaskRunId): readonly TaskChildRecord[] {
    const rows = this.db.prepare('SELECT session_id,run_id,model_key,state FROM task_children WHERE run_id=? ORDER BY rowid').all(runId)
    return rows.map(childRecord)
  }
  /** Count children whose lifecycle has not reached quiescent disposal.
   * @param runId - owning Task execution.
   * @returns outstanding child count across model operations.
   */
  activeChildCount(runId: TaskRunId): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM task_children WHERE run_id=? AND state IN ('prepared','active')").get(runId) as { count: number }
    return row.count
  }
  /** Preserve evidence of child turns interrupted by host restart.
   * @returns number of interrupted children.
   */
  interruptChildren(): number {
    return Number(this.db.prepare("UPDATE task_children SET state='interrupted' WHERE state IN ('prepared','active')").run().changes)
  }
  /** Record publication or quiescent disposal.
   * @param id - reserved child identity.
   * @param state - confirmed lifecycle state.
   */
  setChildState(id: SessionId, state: 'active' | 'complete'): void {
    this.db.prepare('UPDATE task_children SET state=? WHERE session_id=?').run(state, id)
  }
  /** Read an idempotency receipt and reject key reuse with changed input.
   *
   * @param scope - owning operation namespace.
   * @param id - retry key.
   * @param input - exact request data.
   *
   * @returns recorded JSON result.
   */
  receipt(scope: string, id: string, input: JsonValue): JsonValue | undefined {
    const row = this.db.prepare('SELECT input,value FROM requests WHERE scope=? AND id=?').get(scope, id) as { input: string; value: string } | undefined
    if (row === undefined) return undefined
    if (canonicalJson(z.json().parse(JSON.parse(row.input))) !== canonicalJson(input)) throw new TaskCommandError('idempotency_conflict', 'task request identity was reused with different input')
    return z.json().parse(JSON.parse(row.value))
  }
  /** Write one command receipt.
   * @param scope - namespace.
   * @param id - key.
   * @param input - request.
   * @param value - response.
   */
  putReceipt(scope: string, id: string, input: JsonValue, value: JsonValue): void {
    this.db.prepare('INSERT INTO requests VALUES (?,?,?,?)').run(scope, id, JSON.stringify(input), JSON.stringify(value))
  }
  /** Record which dispatching run and request created an associated run.
   * @param parent - dispatching run.
   * @param request - retry key.
   * @param child - associated run.
   */
  associate(parent: TaskRunId, request: string, child: TaskRunId): void {
    this.db.prepare('INSERT INTO associations VALUES (?,?,?)').run(parent, request, child)
  }
  /** Read ordered business inputs.
   * @param id - run.
   * @param includeConsumed - include committed stage inputs when repairing the Session log.
   * @returns inputs ordered by revision.
   */
  inputs(id: TaskRunId, includeConsumed = false): TaskInput[] {
    return (this.db.prepare('SELECT value FROM inputs WHERE run_id=? AND (? OR consumed=0) ORDER BY revision').all(id, Number(includeConsumed)) as Document[])
      .map(row => z.object({ id: z.string(), revision: z.number().int(), kind: z.enum(['input', 'response', 'update']), value: z.json() }).parse(JSON.parse(row.value)) as TaskInput)
  }
  /** Append incoming data.
   * @param id - run.
   * @param input - next ordered input.
   */
  putInput(id: TaskRunId, input: TaskInput): void {
    this.db.prepare('INSERT INTO inputs(run_id,revision,value) VALUES (?,?,?)').run(id, input.revision, JSON.stringify(input))
  }
  /** Commit input consumption with the stage result.
   * @param id - run.
   * @param through - inclusive revision.
   */
  consume(id: TaskRunId, through: number): void {
    this.db.prepare('UPDATE inputs SET consumed=1 WHERE run_id=? AND revision<=?').run(id, through)
  }
  /** Read the latest discovery.
   * @param id - run.
   * @returns data or null before first observation.
   */
  observation(id: TaskRunId): JsonValue {
    const row = this.db.prepare('SELECT value FROM observations WHERE run_id=?').get(id) as Document | undefined
    return row === undefined ? null : z.json().parse(JSON.parse(row.value))
  }
  /** Remember discovery independently of its consumption.
   * @param id - run.
   * @param value - business data.
   */
  observe(id: TaskRunId, value: JsonValue): void {
    this.db.prepare('INSERT INTO observations VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET value=excluded.value').run(id, JSON.stringify(value))
  }
  /** Acquire the entire lock set or leave it unchanged.
   * @param run - candidate.
   * @param transient - stage-only exclusive resources.
   * @param capacities - configured capacities; an undeclared key is exclusive.
   * @returns whether all resources are owned.
   */
  acquire(run: TaskRun, transient: readonly string[] = [], capacities: Readonly<Record<string, number>> = {}): boolean {
    const resources = [...new Set([...run.resources, ...transient])].sort()
    for (const name of resources) {
      const owners = this.db.prepare('SELECT run_id FROM resources WHERE name=?').all(name) as { run_id: string }[]
      if (!owners.some(owner => owner.run_id === run.id) && owners.length >= (capacities[name] ?? 1)) return false
    }
    for (const name of resources) this.db.prepare('INSERT OR IGNORE INTO resources VALUES (?,?)').run(name, run.id)
    return true
  }
  /** Release stage-only reservations after work becomes quiescent.
   * @param run - execution whose retained resource keys survive a wait.
   */
  releaseStage(run: TaskRun): void {
    this.db.prepare('DELETE FROM resources WHERE run_id=? AND name NOT IN (SELECT value FROM json_each(?))')
      .run(run.id, JSON.stringify(run.resources))
  }
  /** Release locks after quiescent cleanup only.
   * @param id - run.
   */
  release(id: TaskRunId): void { this.db.prepare('DELETE FROM resources WHERE run_id=?').run(id) }
  /** Read an external operation.
   * @param id - run.
   * @param key - operation identity.
   * @returns prepared or confirmed result.
   */
  operation(id: TaskRunId, key: string): { state: 'prepared' | 'confirmed'; value: JsonValue } | undefined {
    const row = this.db.prepare('SELECT state,value FROM operations WHERE run_id=? AND id=?').get(id, key) as { state: string; value: string } | undefined
    if (row === undefined) return undefined
    const value: unknown = JSON.parse(row.value)
    return z.object({ state: z.enum(['prepared', 'confirmed']), value: z.json() }).parse({ state: row.state, value })
  }
  /** Persist an operation checkpoint before or after its side effect.
   *
   * @param id - run.
   * @param key - identity.
   * @param state - effect state.
   * @param value - evidence.
   */
  putOperation(id: TaskRunId, key: string, state: 'prepared' | 'confirmed', value: JsonValue): void {
    this.db.prepare('INSERT INTO operations VALUES (?,?,?,?) ON CONFLICT(run_id,id) DO UPDATE SET state=excluded.state,value=excluded.value').run(id, key, state, JSON.stringify(value))
  }
  /** Add a durable diagnostic inside its state transaction.
   *
   * @param runId - optional run.
   * @param event - stable event name.
   * @param at - wall time.
   * @param details - safe identity/state data.
   */
  log(runId: TaskRunId | null, event: string, at: number, details: JsonValue): void {
    this.db.prepare('INSERT INTO journal(run_id,event,at,details) VALUES (?,?,?,?)').run(runId, event, at, JSON.stringify(details))
  }
  /** Read audit history.
   * @param after - exclusive cursor.
   * @param limit - maximum records, or -1 for the legacy complete journal.
   * @returns ordered records.
   */
  journal(after: number, limit = -1): TaskJournalEntry[] {
    const rows = this.db.prepare('SELECT sequence,run_id,event,at,details FROM journal WHERE sequence>? ORDER BY sequence LIMIT ?').all(after, limit)
    return rows.map(row => ({ sequence: Number(row['sequence']), runId: row['run_id'] as TaskRunId | null, event: String(row['event']), at: Number(row['at']), details: z.json().parse(JSON.parse(String(row['details']))) }))
  }
  /** Read the committed journal head, including the empty database position.
   * @returns inclusive sequence.
   */
  journalHead(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS sequence FROM journal').get()
    return z.object({ sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).parse(row).sequence
  }
  /** Read the durable notification replay position.
   * @param providerId - destination identity; the built-in log retains its original cursor.
   * @returns last acknowledged journal sequence.
   */
  notificationCursor(providerId = 'log'): number {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(providerId === 'log' ? 'notification_cursor' : `notification_cursor:${providerId}`)
    return row === undefined ? 0 : z.number().int().nonnegative().parse(JSON.parse(String(row['value'])))
  }
  /** Acknowledge notification delivery or an irrelevant journal record.
   * @param sequence - successfully consumed journal position.
   * @param providerId - destination identity.
   */
  acknowledgeNotification(sequence: number, providerId = 'log'): void {
    this.db.prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(providerId === 'log' ? 'notification_cursor' : `notification_cursor:${providerId}`, JSON.stringify(sequence))
  }
  /** Read pending Session durability barriers.
   * @param id - run.
   * @returns committed entries.
   */
  outbox(id: TaskRunId): OutboxEntry[] {
    const rows = this.db.prepare('SELECT id,value FROM session_outbox WHERE run_id=? ORDER BY id').all(id)
    return rows.map(row => ({ id: Number(row['id']), run: runSchema.parse(JSON.parse(String(row['value']))) }))
  }
  /** Find executions whose Session durability barrier remains unacknowledged.
   *
   * @returns latest execution snapshots, including terminal executions.
   */
  pendingSessions(): TaskRun[] {
    return (this.db.prepare('SELECT value FROM runs WHERE id IN (SELECT run_id FROM session_outbox) ORDER BY rowid').all() as Document[])
      .map(row => runSchema.parse(JSON.parse(row.value)))
  }
  /** Acknowledge a barrier only after Session flush.
   * @param id - barrier identity.
   */
  acknowledge(id: number): void { this.db.prepare('DELETE FROM session_outbox WHERE id=?').run(id) }
  /** Release database and process lock after workers drain. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
    this.lock?.close()
  }
}

/** Object key order does not change a JSON command's identity. */
function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : 1)
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}

const interactionRecord = z.object({
  id: z.string(), runId: z.string(), revision: z.number().int().nonnegative(),
  source: z.enum(['tool_approval', 'agent_question']), title: z.string(), description: z.string(), schema: z.json(),
  createdAt: z.number(), expiresAt: z.number().nullable(), state: z.enum(['waiting', 'answered', 'withdrawn']), answer: z.json(),
})

const resourceSchema = z.object({ runId: z.string().min(1), key: z.string().min(1), type: z.string().min(1),
  request: z.json(), value: z.json(), state: z.enum(['prepared','ready','cleaning','released','blocked']) })
