/** Local cron previews of calendar schedules. */
import { describe, expect, it } from 'vitest'
import { nextOccurrences, parseCron, validTimeZone } from '../src/support/cron.ts'

describe('parseCron', () => {
  it('expands lists, ranges, steps and names, folding weekday 7 into Sunday', () => {
    const spec = parseCron('*/15 9-11 1,15 JAN-MAR 5-7')
    expect(spec).toMatchObject({ minutes: [0, 15, 30, 45], hours: [9, 10, 11], days: [1, 15], months: [1, 2, 3], weekdays: [0, 5, 6] })
    expect(spec?.dayRestricted).toBe(true)
    expect(parseCron('0 17 * * MON')?.weekdays).toEqual([1])
    expect(parseCron('5/20 * * * *')?.minutes).toEqual([5, 25, 45])
  })

  it('rejects malformed expressions', () => {
    for (const expression of ['', '* * * *', '60 * * * *', '* 24 * * *', '*/0 * * * *', '5-1 * * * *', '* * * FOO *', 'a b c d e']) {
      expect(parseCron(expression)).toBeUndefined()
    }
  })
})

describe('nextOccurrences', () => {
  it('evaluates wall-clock times in the schedule zone', () => {
    const spec = parseCron('0 17 * * 5')
    if (spec === undefined) throw new Error('invalid test expression')
    // 2026-10-03 is a Saturday; Friday 17:00 in Shanghai is 09:00 UTC.
    const after = Date.parse('2026-10-03T06:00:00Z')
    expect(nextOccurrences(spec, 'Asia/Shanghai', after, 3).map(value => new Date(value).toISOString())).toEqual([
      '2026-10-09T09:00:00.000Z', '2026-10-16T09:00:00.000Z', '2026-10-23T09:00:00.000Z',
    ])
  })

  it('skips nonexistent daylight-saving times and keeps the earlier repeated instant', () => {
    const skipped = parseCron('30 2 8 3 *')
    const repeated = parseCron('30 1 1 11 *')
    if (skipped === undefined || repeated === undefined) throw new Error('invalid test expression')
    const start = Date.parse('2026-01-01T00:00:00Z')
    expect(nextOccurrences(skipped, 'America/New_York', start, 1).map(value => new Date(value).toISOString())).toEqual(['2027-03-08T07:30:00.000Z'])
    expect(nextOccurrences(repeated, 'America/New_York', start, 1).map(value => new Date(value).toISOString())).toEqual(['2026-11-01T05:30:00.000Z'])
  })

  it('applies day-of-month or day-of-week when both are restricted', () => {
    const spec = parseCron('0 0 1 * 1')
    if (spec === undefined) throw new Error('invalid test expression')
    const days = nextOccurrences(spec, 'UTC', Date.parse('2026-06-01T00:00:00Z'), 3).map(value => new Date(value).toISOString().slice(0, 10))
    expect(days).toEqual(['2026-06-08', '2026-06-15', '2026-06-22'])
  })
})

it('recognizes IANA zones', () => {
  expect(validTimeZone('Asia/Shanghai')).toBe(true)
  expect(validTimeZone('Mars/Olympus')).toBe(false)
})
