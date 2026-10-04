/** Five-field cron evaluation for local previews of calendar schedules; the server remains authoritative. */

/** Parsed cron fields as allowed value sets. */
export interface CronSpec {
  readonly minutes: readonly number[]
  readonly hours: readonly number[]
  readonly days: readonly number[]
  readonly months: readonly number[]
  readonly weekdays: readonly number[]
  readonly dayRestricted: boolean
  readonly weekdayRestricted: boolean
}

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function field(text: string, min: number, max: number, names?: readonly string[], nameBase = 0): number[] | undefined {
  const values = new Set<number>()
  const value = (raw: string): number | undefined => {
    const index = names?.indexOf(raw.toUpperCase()) ?? -1
    if (index >= 0) return index + nameBase
    if (!/^\d+$/.test(raw)) return undefined
    return Number(raw)
  }
  for (const part of text.split(',')) {
    const match = /^(\*|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)(?:\/(\d+))?$/.exec(part)
    if (match === null) return undefined
    const range = match[1] as string
    const step = match[2] === undefined ? 1 : Number(match[2])
    if (step < 1) return undefined
    let from = min
    let to = max
    if (range !== '*') {
      const [start, end] = range.split('-')
      const first = value(start as string)
      const last = end === undefined ? (match[2] === undefined ? first : max) : value(end)
      if (first === undefined || last === undefined) return undefined
      from = first
      to = last
    }
    if (from < min || to > max || from > to) return undefined
    for (let item = from; item <= to; item += step) values.add(item)
  }
  return [...values].sort((left, right) => left - right)
}

/** Parse a five-field expression; day-of-week 7 is Sunday.
 * @param expression - `minute hour day month weekday`.
 * @returns allowed values, or undefined when the expression is invalid.
 */
export function parseCron(expression: string): CronSpec | undefined {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return undefined
  const [minute, hour, day, month, weekday] = parts as [string, string, string, string, string]
  const minutes = field(minute, 0, 59)
  const hours = field(hour, 0, 23)
  const days = field(day, 1, 31)
  const months = field(month, 1, 12, MONTH_NAMES, 1)
  const weekdayValues = field(weekday, 0, 7, DAY_NAMES)
  if (minutes === undefined || hours === undefined || days === undefined || months === undefined
    || weekdayValues === undefined) return undefined
  return {
    minutes, hours, days, months,
    weekdays: [...new Set(weekdayValues.map(item => item % 7))].sort((left, right) => left - right),
    dayRestricted: day !== '*',
    weekdayRestricted: weekday !== '*',
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function wallClock(instant: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  let formatter = formatters.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    })
    formatters.set(timeZone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]))
  return { year: Number(parts['year']), month: Number(parts['month']), day: Number(parts['day']), hour: Number(parts['hour']),
    minute: Number(parts['minute']) }
}

/** Convert a wall-clock time in a zone to an instant; nonexistent local times return undefined.
 * @returns epoch milliseconds, preferring the earlier of repeated local times.
 */
function zoned(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number | undefined {
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const candidates = new Set<number>()
  for (const probe of [wall - 14 * 3600000, wall, wall + 14 * 3600000]) {
    const local = wallClock(probe, timeZone)
    const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - probe
    candidates.add(wall - offset)
  }
  const valid = [...candidates].filter((instant) => {
    const local = wallClock(instant, timeZone)
    return local.year === year && local.month === month && local.day === day && local.hour === hour && local.minute === minute
  }).sort((left, right) => left - right)
  return valid[0]
}

/** Whether a time zone name is accepted by the browser.
 * @param timeZone - IANA zone name.
 * @returns true when Intl can format in the zone.
 */
export function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false // Intl throws RangeError for unknown zone names.
  }
}

/** Compute upcoming occurrences after a given instant.
 * @param spec - parsed expression.
 * @param timeZone - IANA zone of the schedule.
 * @param after - exclusive lower bound in epoch milliseconds.
 * @param count - number of occurrences.
 * @returns ascending instants; fewer when none exist within five years.
 */
export function nextOccurrences(spec: CronSpec, timeZone: string, after: number, count: number): number[] {
  const out: number[] = []
  const start = wallClock(after, timeZone)
  const base = Date.UTC(start.year, start.month - 1, start.day)
  for (let offset = 0; offset < 366 * 5 && out.length < count; offset++) {
    const date = new Date(base + offset * 86400000)
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    const day = date.getUTCDate()
    if (!spec.months.includes(month)) continue
    const dayMatch = spec.days.includes(day)
    const weekdayMatch = spec.weekdays.includes(date.getUTCDay())
    const matches = spec.dayRestricted && spec.weekdayRestricted ? dayMatch || weekdayMatch : dayMatch && weekdayMatch
    if (!matches) continue
    for (const hour of spec.hours) {
      for (const minute of spec.minutes) {
        const instant = zoned(year, month, day, hour, minute, timeZone)
        if (instant !== undefined && instant > after) out.push(instant)
        if (out.length >= count) return out
      }
    }
  }
  return out
}
