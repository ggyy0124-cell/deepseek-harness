/** Readings of the Session statistics footer. */
import { describe, expect, it } from 'vitest'
import { barSegments, cacheHitPercent, formatRate, occupancy, promptTotal, tokensPerSecond } from '../src/support/stats.ts'

const usage = (uncachedInputTokens: number, cacheReadTokens: number, cacheWriteTokens = 0, outputTokens = 0) =>
  ({ uncachedInputTokens, cacheReadTokens, cacheWriteTokens, outputTokens })
const session = (decodeMs: number, decodeTokens: number) =>
  ({ turns: 1, steps: 1, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs, decodeTokens })

describe('Session statistics readings', () => {
  it('derive the output rate from the steps that timed their decoding', () => {
    expect(tokensPerSecond(session(0, 40))).toBeNull()
    expect(tokensPerSecond(session(2000, 608))).toBe(304)
    expect([formatRate(304.4), formatRate(9.94), formatRate(0.04)]).toEqual(['304', '9.9', '0'])
  })

  it('count every prompt bucket and never round a partial cache hit up to a full one', () => {
    expect(promptTotal(usage(10, 20, 5))).toBe(35)
    expect(cacheHitPercent(usage(0, 0))).toBeNull()
    expect(cacheHitPercent(usage(0, 50))).toBe('100')
    expect(cacheHitPercent(usage(16, 984))).toBe('98')
    expect(cacheHitPercent(usage(1, 999))).toBe('99.9')
    expect(cacheHitPercent(usage(1, 99_999))).toBe('99.999')
    expect(cacheHitPercent(usage(100, 0))).toBe('0')
  })

  it('prefer the projected size for occupancy and cap it at the window', () => {
    expect(occupancy(null)).toBeNull()
    expect(occupancy({ pressureTokens: null, projectedTokens: null, contextWindow: 1000 })).toBeNull()
    expect(occupancy({ pressureTokens: 400, projectedTokens: null, contextWindow: null })).toBeNull()
    expect(occupancy({ pressureTokens: 400, projectedTokens: null, contextWindow: 1000 })).toEqual({ percent: 40, used: 400, window: 1000 })
    expect(occupancy({ pressureTokens: 400, projectedTokens: 455, contextWindow: 1000 })).toEqual({ percent: 46, used: 455, window: 1000 })
    expect(occupancy({ pressureTokens: 1400, projectedTokens: 1500, contextWindow: 1000 })?.percent).toBe(100)
  })

  it('split the occupied bar by the estimated composition and drop empty parts', () => {
    expect(barSegments(40, null)).toEqual([{ key: 'total', width: 40 }])
    expect(barSegments(40, { systemTokens: 0, toolsTokens: 0, messageTokens: 0 })).toEqual([{ key: 'total', width: 40 }])
    expect(barSegments(0, null)).toEqual([])
    expect(barSegments(40, { systemTokens: 10, toolsTokens: 0, messageTokens: 30 })).toEqual([
      { key: 'systemTokens', width: 10 }, { key: 'messageTokens', width: 30 },
    ])
  })
})
