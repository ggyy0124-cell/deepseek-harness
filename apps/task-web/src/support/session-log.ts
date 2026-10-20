/** Raw Session event view: loop grouping, stream chunk expansion, type filtering and the loader of `getSessionLog` pages. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { useApp } from '../app/context.tsx'
import { describeFailure, isProblem, type RequestFailure } from './connection.ts'
import type { SessionLogEntry } from './types.ts'

/** Grouping role of a row that has children. */
export type LogGroup = 'turn' | 'step' | 'stream' | 'block'

/** One row of the Session log tree: a stored event, or one stream chunk of an assistant message. */
export interface LogNode {
  readonly key: string
  /** Event type, or the chunk type for stream chunks. */
  readonly type: string
  /** Stored position; null for stream chunks. */
  readonly sequence: number | null
  /** ISO time of the event or chunk. */
  readonly at: string
  readonly summary: string
  /** Value the detail panel shows: the stored event, or the chunk. */
  readonly value: unknown
  readonly group: LogGroup | null
  readonly children: LogNode[]
}

/** One visible row after folding and filtering. */
export interface LogRow {
  readonly node: LogNode
  readonly depth: number
  /** Shown only because a descendant matches the filter. */
  readonly context: boolean
  readonly open: boolean
}

const SUMMARY_LIMIT = 240
const timeSchema = z.number()
const chunkSchema = z.looseObject({ type: z.string(), index: z.number().int().optional() })
const recordSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chunk'), time: timeSchema, chunk: chunkSchema }),
  z.object({ type: z.enum(['text-chunks', 'reasoning-chunks']), time0: timeSchema, index: z.number().int(), dt: z.array(timeSchema),
    texts: z.array(z.string()) }),
  z.looseObject({ type: z.literal('tool-call-chunks'), time0: timeSchema, index: z.number().int(), id: z.string(), name: z.string().optional(),
    dt: z.array(timeSchema), args: z.array(z.string()) }),
])
const streamSchema = z.object({ data: z.object({ stream: z.array(recordSchema) }) })
type Chunk = z.infer<typeof chunkSchema>

/** Timed chunks of an assistant message's stored stream, with batched deltas expanded one per chunk.
 * @param event - stored event.
 * @returns chunks in stream order; empty when the event has no stream in a known shape.
 */
export function expandStream(event: unknown): readonly { readonly time: number; readonly chunk: Chunk }[] {
  const parsed = streamSchema.safeParse(event)
  if (!parsed.success) return []
  return parsed.data.data.stream.flatMap((record) => {
    if (record.type === 'chunk') return [{ time: record.time, chunk: record.chunk }]
    const members = record.type === 'tool-call-chunks' ? record.args : record.texts
    let time = record.time0
    return members.map((member, position) => {
      if (position > 0) time += record.dt[position - 1] ?? 0
      const chunk: Chunk = record.type === 'tool-call-chunks'
        ? { type: 'tool-call-delta', index: record.index, id: record.id, ...(record.name === undefined ? {} : { name: record.name }), argumentsDelta: member }
        : { type: record.type === 'text-chunks' ? 'text-delta' : 'reasoning-delta', index: record.index, text: member }
      return { time, chunk }
    })
  })
}

/** One-line JSON of a value, shortened for a row.
 * @param value - JSON value.
 * @returns at most the summary limit of characters.
 */
export function compactJson(value: Record<string, unknown> | string): string {
  return shorten(JSON.stringify(value))
}

function shorten(text: string): string {
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT - 1)}…` : text
}

function eventSummary(entry: SessionLogEntry): string {
  const { type: _type, seq: _seq, time: _time, data, ...rest } = entry.event
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const { stream: _stream, ...visible } = data
    return compactJson(Object.keys(rest).length === 0 ? visible : { ...visible, ...rest })
  }
  return compactJson(data === undefined ? rest : { data, ...rest })
}

function chunkSummary(chunk: Chunk): string {
  const { type: _type, index: _index, ...rest } = chunk
  if (typeof rest['text'] === 'string') return rest['text']
  if (typeof rest['argumentsDelta'] === 'string') return rest['argumentsDelta']
  return compactJson(rest)
}

function streamChildren(entry: SessionLogEntry): LogNode[] {
  const children: LogNode[] = []
  const blocks = new Map<number, LogNode>()
  const texts = new Map<LogNode, string>()
  for (const [position, { time, chunk }] of expandStream(entry.event).entries()) {
    const node: LogNode = { key: `${entry.sequence}:${position}`, type: chunk.type, sequence: null, at: new Date(time).toISOString(),
      summary: chunkSummary(chunk), value: chunk, group: null, children: [] }
    const block = chunk.index === undefined ? undefined : blocks.get(chunk.index)
    if (chunk.type === 'block-start' && chunk.index !== undefined) {
      const opened: LogNode = { ...node, group: 'block' }
      blocks.set(chunk.index, opened)
      texts.set(opened, '')
      children.push(opened)
    } else if (block === undefined) children.push(node)
    else {
      block.children.push(node)
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta')
        texts.set(block, (texts.get(block) ?? '') + node.summary)
      if (chunk.type === 'block-end' && chunk.index !== undefined) blocks.delete(chunk.index)
    }
  }
  return children.map((child) => {
    const text = texts.get(child)
    if (text === undefined || text === '') return child
    const kind = (child.value as Chunk)['blockType']
    return { ...child, summary: shorten(`${typeof kind === 'string' ? kind : ''}: ${text}`) }
  })
}

/** Nest stored events by loop position: a `turn/start` row holds its turn, a `step/start` row its step, an assistant message its
 * stream chunks. A missing start is never invented; events outside a loaded turn stay at the root.
 * @param entries - events in position order.
 * @returns root rows.
 */
export function buildLogTree(entries: readonly SessionLogEntry[]): LogNode[] {
  const roots: LogNode[] = []
  let turn: LogNode | undefined
  let step: LogNode | undefined
  const container = (): LogNode[] => (step ?? turn)?.children ?? roots
  for (const entry of entries) {
    const stream = entry.type === 'assistant/message' ? streamChildren(entry) : []
    const group: LogGroup | null = entry.type === 'turn/start' ? 'turn' : entry.type === 'step/start' ? 'step' : stream.length > 0 ? 'stream' : null
    const node: LogNode = { key: String(entry.sequence), type: entry.type, sequence: entry.sequence, at: entry.at,
      summary: eventSummary(entry), value: entry.event, group, children: stream }
    switch (entry.type) {
      case 'turn/start':
        roots.push(node)
        turn = node
        step = undefined
        break
      case 'step/start':
        step = undefined
        container().push(node)
        step = node
        break
      case 'step/end':
        container().push(node)
        step = undefined
        break
      case 'turn/end':
        step = undefined
        container().push(node)
        turn = undefined
        break
      default:
        container().push(node)
    }
  }
  return roots
}

/** Whether a type matches a filter fragment: case-insensitive containment, where `*` stands for any text.
 * @param type - event or chunk type.
 * @param filter - typed fragment; empty matches everything.
 * @returns the match.
 */
export function matchesType(type: string, filter: string): boolean {
  const parts = filter.trim().toLowerCase().split('*').filter(part => part !== '')
  let from = 0
  const lower = type.toLowerCase()
  for (const part of parts) {
    const found = lower.indexOf(part, from)
    if (found < 0) return false
    from = found + part.length
  }
  return true
}

/** Open state of a row before the person toggles it: loop groups open, stream chunks folded.
 * @param node - row with children.
 * @returns whether its children show.
 */
export function openByDefault(node: LogNode): boolean {
  return node.group === 'turn' || node.group === 'step'
}

/** Visible rows in display order.
 * @param roots - tree from `buildLogTree`.
 * @param toggled - keys whose open state differs from the default.
 * @param filter - type fragment; with a filter every row with a matching descendant opens and shows as context.
 * @returns rows and the number that match the filter.
 */
export function flattenLog(roots: readonly LogNode[], toggled: ReadonlySet<string>, filter: string): { rows: LogRow[]; matches: number } {
  const rows: LogRow[] = []
  let matches = 0
  const filtering = filter.trim() !== ''
  const visit = (node: LogNode, depth: number): boolean => {
    const matched = matchesType(node.type, filter)
    if (!filtering) {
      const open = node.children.length > 0 && openByDefault(node) !== toggled.has(node.key)
      rows.push({ node, depth, context: false, open })
      matches++
      if (open) for (const child of node.children) visit(child, depth + 1)
      return true
    }
    const position = rows.length
    rows.push({ node, depth, context: !matched, open: false })
    let descendant = false
    for (const child of node.children) descendant = visit(child, depth + 1) || descendant
    if (!matched && !descendant) {
      rows.length = position
      return false
    }
    if (matched) matches++
    rows[position] = { node, depth, context: !matched, open: descendant }
    return true
  }
  for (const root of roots) visit(root, 0)
  return { rows, matches }
}

/** Load state of the Session log. */
export type SessionLogStatus = 'loading' | 'ready' | 'disabled' | 'pending' | 'failed'

/** Session log feed of one Run. */
export interface SessionLogFeed {
  readonly entries: readonly SessionLogEntry[]
  readonly status: SessionLogStatus
  readonly failure: RequestFailure | undefined
  /** More stored events exist after the loaded ones. */
  readonly hasMore: boolean
  readonly busy: boolean
  /** Load the next batch after the loaded events. */
  readonly loadMore: () => void
  /** Discard the loaded events and read from the start. */
  readonly reload: () => void
}

/** Events read before the view waits for the person to ask for more. */
export const SESSION_LOG_BATCH = 1000
const PAGE_LIMIT = '200'

/** Read a Run's stored Session events in forward pages.
 * @param runId - execution.
 * @param active - whether the view shows; nothing is read while hidden.
 * @param change - value that changes when the Session may have new events; at the end of the log a change reads the appended events.
 * @returns loaded events, the load state and the paging actions.
 */
export function useSessionLog(runId: string, active: boolean, change: string): SessionLogFeed {
  const { connection } = useApp()
  const [entries, setEntries] = useState<readonly SessionLogEntry[]>([])
  const [status, setStatus] = useState<SessionLogStatus>('loading')
  const [failure, setFailure] = useState<RequestFailure | undefined>(undefined)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [request, setRequest] = useState(0)
  const cursor = useRef<string | undefined>(undefined)
  const lifetime = useRef<AbortController | undefined>(undefined)
  const reading = useRef(false)
  const latestChange = useRef(change)
  latestChange.current = change
  // At the end of the log a Session change reads appended events; while more stored events wait the person pages on instead.
  const followed = useRef(change)
  if (!hasMore) followed.current = change
  const follow = followed.current

  useEffect(() => {
    cursor.current = undefined
    setEntries([]); setStatus('loading'); setFailure(undefined); setHasMore(false)
  }, [runId, generation])

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    lifetime.current = controller
    return () => {
      controller.abort()
      if (lifetime.current === controller) lifetime.current = undefined
      reading.current = false
      setBusy(false)
    }
  }, [connection, runId, active, generation])

  useEffect(() => {
    if (!active || reading.current) return
    const controller = lifetime.current
    if (controller === undefined || controller.signal.aborted) return
    const { signal } = controller
    reading.current = true
    setBusy(true)
    const read = async () => {
      let seenChange = latestChange.current
      let loaded = 0
      try {
        for (;;) {
          const page = await connection.call('getSessionLog', { params: { runId },
            query: cursor.current === undefined ? { limit: PAGE_LIMIT } : { cursor: cursor.current, limit: PAGE_LIMIT }, signal })
          if (signal.aborted) return
          cursor.current = page.nextCursor
          loaded += page.items.length
          setEntries(current => page.items.length === 0 ? current : [...current, ...page.items])
          setHasMore(page.hasMore)
          setStatus('ready')
          setFailure(undefined)
          if (page.hasMore) {
            if (loaded >= SESSION_LOG_BATCH) return
            continue
          }
          followed.current = seenChange
          if (seenChange === latestChange.current) return
          seenChange = latestChange.current
          loaded = 0
        }
      } catch (error) {
        if (signal.aborted) return
        if (isProblem(error, 'authentication_required')) { await connection.guard(() => Promise.reject(error)).catch(() => undefined); return }
        // A rewritten history restarts from the first event; a fresh read never carries a cursor, so this cannot repeat.
        if (cursor.current !== undefined && isProblem(error, 'cursor_stale', 'invalid_cursor')) { setGeneration(value => value + 1); return }
        setStatus(isProblem(error, 'session_log_disabled') ? 'disabled' : isProblem(error, 'session_unavailable') ? 'pending' : 'failed')
        setFailure(describeFailure(error))
      } finally {
        if (!signal.aborted) {
          reading.current = false
          setBusy(false)
        }
      }
    }
    void read()
  }, [connection, runId, active, generation, request, follow])

  const loadMore = useCallback(() => { setRequest(value => value + 1) }, [])
  const reload = useCallback(() => { setGeneration(value => value + 1) }, [])
  return { entries, status, failure, hasMore, busy, loadMore, reload }
}
