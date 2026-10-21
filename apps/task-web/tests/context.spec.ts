/** Context insight: validation of the dsh-context views and the figures derived from them. The fixture is the response of
 * `GET /runs/{runId}/context` for a three-turn Session folded by dsh-context 0.74.0.
 */
import { describe, expect, it } from 'vitest'
import {
  billedTokens, cacheHit, fileActivity, parseContext, sharePercent, shrinkMarkers, toolRows, turnCount, type ContextEvent,
  type ContextRequest, type FileOp,
} from '../src/support/context.ts'
import type { RunContext } from '../src/support/types.ts'
import { recordedContext } from './context-fixtures.ts'

const response: RunContext = recordedContext

describe('Context insight', () => {
  it('reads the views dsh-context 0.74.0 serves', () => {
    const insight = parseContext(response)
    expect(insight).toBeDefined()
    const { timeline, tools } = insight!
    expect(timeline).toMatchObject({ model: 'deepseek-chat', contextWindow: 128000, humanInputs: 3 })
    expect(timeline.current).toMatchObject({ system: 384, tools: 566, tool: 1872, total: 3347 })
    expect(timeline.requests).toHaveLength(12)
    expect(turnCount(timeline.requests)).toBe(3)
    expect(tools.map(tool => [tool.name, tool.plugin])).toEqual([
      ['read', '@deepseek-ai/dsh-tool-fs'], ['write', '@deepseek-ai/dsh-tool-fs'], ['bash', '@deepseek-ai/dsh-tool-bash']])
  })

  it('reports a shape it cannot read instead of guessing, and accepts a host without the header unit', () => {
    expect(parseContext({ ...response, timeline: { ...response.timeline, current: 'full' } })).toBeUndefined()
    expect(parseContext({ ...response, headers: { headers: 'none' } })).toBeUndefined()
    expect(parseContext({ ...response, headers: null })?.tools).toEqual([])
    const { skill: _skill, ...older } = response.timeline['current'] as Record<string, number>
    expect(parseContext({ ...response, timeline: { ...response.timeline, current: older } })?.timeline.current.skill).toBe(0)
  })

  it('sums billing buckets over providers, models and pricing periods', () => {
    const buckets = (uncached: number, cacheRead: number) => ({ uncached, cacheRead, cacheWrite: 1, output: 2 })
    expect(billedTokens(undefined)).toBeNull()
    const billed = billedTokens({ a: { m: { peak: buckets(10, 30), off: buckets(5, 5) } }, b: { n: { off: buckets(1, 0) } } })
    expect(billed).toEqual({ uncached: 16, cacheRead: 35, cacheWrite: 3, output: 6 })
    expect(cacheHit(billed!)).toBe(64)
    expect(cacheHit({ uncached: 0, cacheRead: 0, cacheWrite: 0, output: 9 })).toBeNull()
    expect(billedTokens(parseContext(response)!.timeline.cost)).toEqual({ uncached: 21960, cacheRead: 50400, cacheWrite: 0, output: 1290 })
  })

  it('shows small shares as below one percent', () => {
    expect([sharePercent(1, 0), sharePercent(0, 10), sharePercent(1, 1000), sharePercent(384, 3347)]).toEqual(['0', '0', '<1', '11'])
  })

  it('places compactions and prunes before the next request', () => {
    const request = (seq: number) => ({ seq, time: 0, system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, total: 0 })
    const event = (seq: number, kind: string) => ({ seq, time: 0, kind }) as ContextEvent
    const requests: ContextRequest[] = [request(5), request(10), request(20)]
    expect(shrinkMarkers(requests, [event(7, 'compaction'), event(8, 'inject'), event(15, 'prune'), event(30, 'compaction')]))
      .toEqual([{ index: 1, event: event(7, 'compaction') }, { index: 2, event: event(15, 'prune') }, { index: 3, event: event(30, 'compaction') }])
    expect(turnCount([{ ...request(1), turn: 2 }, request(2)])).toBe(1)
  })

  it('groups file operations by file and keeps search patterns apart', () => {
    const op = (seq: number, path: string, kind: FileOp['kind'], extra: Partial<FileOp> = {}) =>
      ({ seq, path, kind, tool: kind, err: false, added: 0, removed: 0, ...extra }) as FileOp
    expect(fileActivity([
      op(1, 'a.ts', 'read'), op(2, 'b.ts', 'write', { added: 3, removed: 1 }), op(3, 'a.ts', 'write', { added: 2, err: true }),
      op(4, 'a.ts', 'search', { pattern: true }), op(5, 'b.ts', 'read'),
    ])).toEqual([
      { path: 'b.ts', pattern: false, reads: 1, writes: 1, searches: 0, added: 3, removed: 1, errors: 0, latest: 5 },
      { path: 'a.ts', pattern: false, reads: 1, writes: 1, searches: 0, added: 2, removed: 0, errors: 1, latest: 3 },
      { path: 'a.ts', pattern: true, reads: 0, writes: 0, searches: 1, added: 0, removed: 0, errors: 0, latest: 4 },
    ])
    expect(fileActivity(parseContext(response)!.timeline.fileOps ?? [])).toEqual([
      expect.objectContaining({ path: 'src/app.ts', reads: 3, writes: 3, added: 6 }),
    ])
  })

  it('joins tool schemas with their calls, most expensive schema first', () => {
    const insight = parseContext(response)!
    expect(toolRows(insight).map(row => [row.name, row.tokens, row.calls])).toEqual([['write', 194, 3], ['read', 191, 3], ['bash', 188, 3]])
    const timing = { ...insight.timeline.timing!, tools: { b: { calls: 1, ms: 5 }, a: { calls: 1, ms: 2 }, c: { calls: 4, ms: 1 } } }
    const extra = { ...insight, tools: [], timeline: { ...insight.timeline, timing } }
    expect(toolRows(extra).map(row => [row.name, row.tokens, row.calls])).toEqual([['c', null, 4], ['a', null, 1], ['b', null, 1]])
    expect(toolRows({ ...insight, timeline: { ...insight.timeline, timing: undefined } }).every(row => row.calls === 0)).toBe(true)
  })
})
