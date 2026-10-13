/** Session statistics of a Run: the readings the footer under the Session shows and the hook that keeps them current. */
import { useEffect, useState } from 'react'
import { useApp } from '../app/context.tsx'
import type { RunStats } from './types.ts'

/** Loop counts and wall times of a Session. */
export type SessionFigures = NonNullable<RunStats['session']>
/** Provider-reported token buckets of a Session. */
export type UsageFigures = NonNullable<RunStats['usage']>
/** Estimated composition of the next request's context. */
export type CompositionFigures = NonNullable<RunStats['composition']>

/** Delay after the last transcript change before the statistics are read again, so a burst of messages costs one read. */
const REFRESH_DELAY_MS = 400

/** Output tokens per second over the steps that timed their decoding.
 * @param session - loop figures.
 * @returns the rate, or null when no step timed its decoding.
 */
export function tokensPerSecond(session: SessionFigures): number | null {
  return session.decodeMs > 0 ? session.decodeTokens / (session.decodeMs / 1000) : null
}

/** A rate as shown next to `tok/s`.
 * @param rate - non-negative tokens per second.
 * @returns whole numbers from 10 up, one decimal below.
 */
export function formatRate(rate: number): string {
  return rate >= 10 ? String(Math.round(rate)) : String(Math.round(rate * 10) / 10)
}

/** Prompt tokens of every request: uncached input, cache reads and cache writes.
 * @param usage - token buckets.
 * @returns the prompt total.
 */
export function promptTotal(usage: UsageFigures): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Share of prompt tokens served from the cache, never rounded up to a full hit.
 * @param usage - token buckets.
 * @returns a whole percentage, or the fewest decimals that keep a partial hit below 100; null without prompt tokens.
 */
export function cacheHitPercent(usage: UsageFigures): string | null {
  const prompt = promptTotal(usage)
  if (prompt === 0) return null
  if (usage.cacheReadTokens === prompt) return '100'
  const percent = (usage.cacheReadTokens / prompt) * 100
  for (let decimals = 0; decimals < 12; decimals++) {
    const scale = 10 ** decimals
    const rounded = Math.round(percent * scale) / scale
    if (rounded < 100) return rounded.toFixed(decimals)
  }
  return percent.toFixed(12)
}

/** Context occupancy of the next request. */
export interface Occupancy {
  /** Whole percentage of the context window, at most 100. */
  readonly percent: number
  /** Tokens the next request is expected to use. */
  readonly used: number
  readonly window: number
}

/** Occupancy from the figures of the latest request and model route.
 * @param context - context figures of the statistics.
 * @returns occupancy, or null until a request reported usage and the route advertised its context window.
 */
export function occupancy(context: RunStats['context']): Occupancy | null {
  const used = context?.projectedTokens ?? context?.pressureTokens ?? null
  const window = context?.contextWindow ?? null
  if (used === null || window === null) return null
  return { percent: Math.min(100, Math.round((used / window) * 100)), used, window }
}

/** Parts of the context, in bar order. */
export const COMPOSITION_PARTS = ['systemTokens', 'toolsTokens', 'messageTokens'] as const

/** One colored part of the occupancy bar. */
export interface BarSegment {
  readonly key: (typeof COMPOSITION_PARTS)[number] | 'total'
  /** Width as a percentage of the bar. */
  readonly width: number
}

/** Split the occupied part of the bar by the estimated composition; the bar's length stays the provider-anchored occupancy.
 * @param percent - occupancy percentage.
 * @param composition - estimated composition, or null.
 * @returns non-empty segments; one `total` segment without a composition.
 */
export function barSegments(percent: number, composition: CompositionFigures | null): readonly BarSegment[] {
  const total = composition === null ? 0 : COMPOSITION_PARTS.reduce((sum, key) => sum + composition[key], 0)
  const segments: readonly BarSegment[] = composition === null || total === 0
    ? [{ key: 'total', width: percent }]
    : COMPOSITION_PARTS.map(key => ({ key, width: (percent * composition[key]) / total }))
  return segments.filter(segment => segment.width > 0)
}

/** Keep a Run's statistics current while the Session is shown.
 * @param runId - execution.
 * @param version - changes whenever the stored transcript or the Run status changes, which schedules a new read.
 * @param enabled - false while the Session is not shown.
 * @returns the latest statistics; undefined before the first successful read of this Run.
 */
export function useRunStats(runId: string, version: string, enabled: boolean): RunStats | undefined {
  const { connection } = useApp()
  const [stats, setStats] = useState<{ readonly runId: string; readonly value: RunStats } | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      connection.call('getRunStats', { params: { runId }, signal: controller.signal }).then((value) => { setStats({ runId, value }) },
        // Statistics only supplement the Session: a Session not stored yet, a cancelled or a failed read keeps the last figures.
        (error: unknown) => { void error })
    }, REFRESH_DELAY_MS)
    return () => { clearTimeout(timer); controller.abort() }
  }, [connection, runId, version, enabled])
  return stats?.runId === runId ? stats.value : undefined
}
