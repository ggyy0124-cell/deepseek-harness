// @vitest-environment jsdom
/** Display formatting of schedules, sizes and times. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zhCN } from '../src/i18n/zh-CN.ts'
import { en } from '../src/i18n/en.ts'
import {
  bytes, compactCount, describeCron, failureText, formatDuration, formatSpan, formatTime, intervalParts, relative, scheduleSummary,
} from '../src/support/format.ts'
import { updatePreferences } from '../src/support/preferences.ts'

afterEach(() => { vi.useRealTimers(); updatePreferences({ time: 'local' }) })

describe('schedules', () => {
  it('describes common cron expressions and falls back to the raw text', () => {
    expect(describeCron('0 17 * * 5', zhCN)).toBe('每周五 17:00')
    expect(describeCron('30 18 * * 1-5', zhCN)).toBe('工作日 18:30')
    expect(describeCron('0 9 * * *', en)).toBe('Daily 09:00')
    expect(describeCron('0 9 1 * *', en)).toBe('Monthly on day 1 09:00')
    expect(describeCron('*/10 * * * *', en)).toBe('Every 10 minutes')
    expect(describeCron('* * * * *', en)).toBe('Every minute')
    expect(describeCron('15 * * * *', en)).toBe('Hourly at minute 15')
    expect(describeCron('0 9 1-7 * 1', en)).toBeUndefined()
    expect(scheduleSummary({ kind: 'scheduled', cron: '0 9 1-7 * 1', timezone: 'UTC', misfire: 'skip', overlap: 'queue' }, en)).toBe('0 9 1-7 * 1 · UTC')
  })

  it('splits polling intervals into their largest exact unit', () => {
    expect(intervalParts(7200000)).toEqual({ value: 2, unit: 'hours' })
    expect(intervalParts(600000)).toEqual({ value: 10, unit: 'minutes' })
    expect(intervalParts(1500)).toEqual({ value: 1.5, unit: 'seconds' })
    expect(scheduleSummary({ kind: 'polling', intervalMs: 600000 }, zhCN)).toBe('每 10 分钟轮询')
    expect(scheduleSummary({ kind: 'manual' }, en)).toBe('Manual trigger')
  })
})

describe('values', () => {
  it('formats sizes and failures', () => {
    expect(bytes(512)).toBe('512 B')
    expect(bytes(18 * 1024)).toBe('18 KB')
    expect(bytes(1.25 * 1024 * 1024)).toBe('1.3 MB')
    expect(failureText({ kind: 'problem', code: 'stale_interaction', status: 409, detail: 'x' }, zhCN)).toBe('此确认已更新或已关闭')
    expect(failureText({ kind: 'problem', code: 'teapot', status: 418, detail: 'short' }, en)).toBe('Request rejected (teapot) short')
    expect(failureText({ kind: 'transport', detail: 'offline' }, en)).toBe('Cannot reach the Task service')
  })

  it('formats times in UTC on request, omitting today\'s date', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-03T06:30:00Z') })
    updatePreferences({ time: 'utc' })
    expect(formatTime('2026-10-03T06:05:09Z')).toBe('06:05')
    expect(formatTime('2026-10-03T06:05:09Z', { seconds: true })).toBe('06:05:09')
    expect(formatTime('2026-10-03T06:05:09Z', { weekdays: zhCN.weekdays, today: zhCN.time.today })).toBe('今天 06:05')
    expect(formatTime('2026-10-09T09:00:00Z', { weekdays: zhCN.weekdays })).toBe('10-09 周五 09:00')
    expect(formatTime('2025-12-31T23:00:00Z')).toBe('2025-12-31 23:00')
    expect(relative('2026-10-03T06:22:00Z', zhCN)).toBe('8 分钟前')
    expect(relative('2026-10-05T06:30:00Z', en)).toBe('in 2 d')
  })
})

describe('durations', () => {
  it('reads spans as seconds, minutes or hours and never below one second', () => {
    expect(formatDuration(0, zhCN)).toBe('1 秒')
    expect(formatDuration(42400, zhCN)).toBe('42 秒')
    expect(formatDuration(180000, zhCN)).toBe('3 分钟')
    expect(formatDuration(185000, en)).toBe('3 min 5 s')
    expect(formatDuration(7200000, en)).toBe('2 h')
    expect(formatDuration(7800000, zhCN)).toBe('2 小时 10 分钟')
  })
})

describe('table cells', () => {
  it('reads a span as milliseconds, tenths of seconds, minutes or hours without a language', () => {
    expect(formatSpan(0)).toBe('0ms')
    expect(formatSpan(850)).toBe('850ms')
    expect(formatSpan(999.4)).toBe('999ms')
    expect(formatSpan(999.6)).toBe('1.0s')
    expect(formatSpan(2300)).toBe('2.3s')
    expect(formatSpan(59_940)).toBe('59.9s')
    expect(formatSpan(59_960)).toBe('1m 00s')
    expect(formatSpan(185_000)).toBe('3m 05s')
    expect(formatSpan(3_599_600)).toBe('1h 00m')
    expect(formatSpan(7_380_000)).toBe('2h 03m')
  })

  it('shortens token counts to three significant digits with a k or M suffix', () => {
    expect(compactCount(0)).toBe('0')
    expect(compactCount(999)).toBe('999')
    expect(compactCount(1000)).toBe('1k')
    expect(compactCount(1234)).toBe('1.2k')
    expect(compactCount(15_400)).toBe('15.4k')
    expect(compactCount(123_456)).toBe('123k')
    expect(compactCount(999_499)).toBe('999k')
    expect(compactCount(999_500)).toBe('1M')
    expect(compactCount(2_500_000)).toBe('2.5M')
    expect(compactCount(123_456_789)).toBe('123M')
  })
})
