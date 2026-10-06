/** Display formatting for times, sizes, schedules and failures. */
import type { Messages } from '../i18n/index.ts'
import type { RequestFailure } from './connection.ts'
import { parseCron } from './cron.ts'
import { preferences, type TimeDisplay } from './preferences.ts'
import type { Definition, Run, Schedule } from './types.ts'

interface Parts { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }

const cache = new Map<string, Intl.DateTimeFormat>()
function parts(instant: number, display: TimeDisplay): Parts {
  const zone = display === 'utc' ? 'UTC' : undefined
  const key = zone ?? 'local'
  let formatter = cache.get(key)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      ...(zone === undefined ? {} : { timeZone: zone }), hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
    })
    cache.set(key, formatter)
  }
  const values = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]))
  return {
    year: Number(values['year']), month: Number(values['month']), day: Number(values['day']),
    hour: Number(values['hour']), minute: Number(values['minute']), second: Number(values['second']),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values['weekday'] ?? ''),
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Format an API timestamp compactly: time today, month-day otherwise, with year when it differs.
 * @param iso - UTC timestamp.
 * @param options.weekdays - weekday names inserted after the date.
 * @param options.today - label replacing the date of today's times.
 * @param options.seconds - include seconds.
 * @param options.full - always include the date.
 * @returns display text in the preferred time zone.
 */
export function formatTime(iso: string | number,
  options: { weekdays?: readonly string[]; today?: string; seconds?: boolean; full?: boolean } = {}): string {
  const instant = typeof iso === 'number' ? iso : Date.parse(iso)
  const display = preferences.get().time
  const value = parts(instant, display)
  const now = parts(Date.now(), display)
  const clock = `${pad(value.hour)}:${pad(value.minute)}${options.seconds === true ? `:${pad(value.second)}` : ''}`
  const sameDay = value.year === now.year && value.month === now.month && value.day === now.day
  if (sameDay && options.full !== true && options.today !== undefined) return `${options.today} ${clock}`
  if (sameDay && options.full !== true && options.weekdays === undefined) return clock
  const date = `${value.year === now.year ? '' : `${value.year}-`}${pad(value.month)}-${pad(value.day)}`
  const weekday = options.weekdays === undefined ? '' : ` ${options.weekdays[value.weekday] ?? ''}`
  return `${date}${weekday} ${clock}`
}

/** Wall-clock time of a recorded instant, to the millisecond.
 * @param instant - epoch milliseconds.
 * @returns text such as "14:03:27.512" in the preferred time zone.
 */
export function formatClock(instant: number): string {
  const value = parts(instant, preferences.get().time)
  return `${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}.${String(Math.floor(instant) % 1000).padStart(3, '0')}`
}

/** Date and wall-clock time of a recorded instant, to the millisecond.
 * @param instant - epoch milliseconds.
 * @returns text such as "2026-10-06 14:03:27.512" in the preferred time zone.
 */
export function formatInstant(instant: number): string {
  const value = parts(instant, preferences.get().time)
  return `${value.year}-${pad(value.month)}-${pad(value.day)} ${formatClock(instant)}`
}

/** UTC hover text for a displayed time.
 * @param iso - API timestamp.
 * @returns ISO string.
 */
export function utcTitle(iso: string): string {
  return new Date(iso).toISOString().replace('.000Z', 'Z')
}

/** Relative distance from now.
 * @param iso - API timestamp.
 * @param t - copy.
 * @returns text such as "8 minutes ago" or "in 2 days".
 */
export function relative(iso: string | number, t: Messages): string {
  const delta = (typeof iso === 'number' ? iso : Date.parse(iso)) - Date.now()
  const minutes = Math.round(Math.abs(delta) / 60000)
  if (minutes < 1) return delta >= 0 ? t.time.soon : t.time.justNow
  if (minutes < 60) return delta >= 0 ? t.time.inMinutes(minutes) : t.time.minutesAgo(minutes)
  const hours = Math.round(minutes / 60)
  if (hours < 24) return delta >= 0 ? t.time.inHours(hours) : t.time.hoursAgo(hours)
  const days = Math.round(hours / 24)
  return delta >= 0 ? t.time.inDays(days) : t.time.daysAgo(days)
}

/** Elapsed duration as minutes or hours.
 * @param from - start timestamp.
 * @param t - copy.
 * @returns short duration text.
 */
export function elapsed(from: string, t: Messages): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(from)) / 60000))
  if (minutes < 60) return `${minutes} ${t.schedule.units.minutes}`
  return `${Math.floor(minutes / 60)} ${t.schedule.units.hours} ${minutes % 60} ${t.schedule.units.minutes}`
}

/** Length of a finished span as seconds, minutes or hours.
 * @param ms - span length; anything shorter than a second reads as one second.
 * @param t - copy.
 * @returns text such as "42 s", "3 min 5 s" or "2 h 10 min".
 */
export function formatDuration(ms: number, t: Messages): string {
  const total = Math.max(1, Math.round(ms / 1000))
  const { seconds, minutes, hours } = t.schedule.units
  if (total < 60) return `${total} ${seconds}`
  if (total < 3600) {
    const rest = total % 60
    return `${Math.floor(total / 60)} ${minutes}${rest === 0 ? '' : ` ${rest} ${seconds}`}`
  }
  const rest = Math.floor((total % 3600) / 60)
  return `${Math.floor(total / 3600)} ${hours}${rest === 0 ? '' : ` ${rest} ${minutes}`}`
}

/** Length of one request or tool call in a table cell, independent of the interface language.
 * @param ms - span length.
 * @returns text such as "850ms", "2.3s", "3m 05s" or "1h 02m".
 */
export function formatSpan(ms: number): string {
  if (Math.round(ms) < 1000) return `${Math.round(ms)}ms`
  const tenths = Math.round(ms / 100)
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`
  const minutes = Math.floor(seconds / 60)
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`
}

/** Length of one request or tool call in the sidebar and timeline tooltips, with the unit names of the interface language.
 * @param ms - span length.
 * @param t - copy.
 * @returns text such as "850 ms" or "2.31 s".
 */
export function formatMillis(ms: number, t: Messages): string {
  const unit = t.run.trajectory.unit
  if (Math.round(ms) < 1000) return unit.milliseconds(String(Math.round(ms)))
  return unit.seconds((ms / 1000).toFixed(ms < 10_000 ? 2 : 1))
}

/** Token count in a table cell.
 * @param value - non-negative count.
 * @returns the count itself below 1000, otherwise a rounded value with a "k" or "M" suffix.
 */
export function compactCount(value: number): string {
  const scale = (size: number, suffix: string): string => {
    const scaled = value / size
    return `${scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10}${suffix}`
  }
  if (value >= 999_500) return scale(1_000_000, 'M')
  if (value >= 1000) return scale(1000, 'k')
  return String(value)
}

/** Human file size.
 * @param bytes - byte count.
 * @returns text in B, KB, MB or GB.
 */
export function bytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`
}

/** Split a polling interval into a value and the largest exact unit.
 * @param intervalMs - polling interval.
 * @returns value and unit.
 */
export function intervalParts(intervalMs: number): { value: number; unit: 'seconds' | 'minutes' | 'hours' } {
  if (intervalMs % 3600000 === 0) return { value: intervalMs / 3600000, unit: 'hours' }
  if (intervalMs % 60000 === 0) return { value: intervalMs / 60000, unit: 'minutes' }
  return { value: intervalMs / 1000, unit: 'seconds' }
}

/** Unit size in milliseconds. */
export const UNIT_MS = { seconds: 1000, minutes: 60000, hours: 3600000 } as const

/** Describe common five-field cron expressions.
 * @param expression - cron text.
 * @param t - copy.
 * @returns description, or undefined for expressions without a short reading.
 */
export function describeCron(expression: string, t: Messages): string | undefined {
  const spec = parseCron(expression)
  if (spec === undefined) return undefined
  const fields = expression.trim().split(/\s+/)
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string]
  if (fields.every(item => item === '*')) return t.schedule.everyMinutes(1)
  const step = /^\*\/(\d+)$/.exec(minute)
  if (step !== null && hour === '*' && day === '*' && month === '*' && weekday === '*') return t.schedule.everyMinutes(Number(step[1]))
  if (/^\d+$/.test(minute) && hour === '*' && day === '*' && month === '*' && weekday === '*') return t.schedule.hourly(Number(minute))
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || month !== '*') return undefined
  const time = `${pad(Number(hour))}:${pad(Number(minute))}`
  if (day === '*' && weekday === '*') return t.schedule.daily(time)
  if (day === '*' && (weekday === '1-5' || weekday.toUpperCase() === 'MON-FRI')) return t.schedule.weekdays(time)
  if (day === '*' && spec.weekdays.length === 1) return t.schedule.weekly(t.weekdays[spec.weekdays[0] as number] as string, time)
  if (/^\d+$/.test(day) && weekday === '*') return t.schedule.monthly(Number(day), time)
  return undefined
}

/** One-line schedule summary.
 * @param schedule - definition schedule.
 * @param t - copy.
 * @returns text such as "every 10 minutes" or "Fridays 17:00 · Asia/Shanghai".
 */
export function scheduleSummary(schedule: Schedule, t: Messages): string {
  switch (schedule.kind) {
    case 'manual': return t.schedule.manual
    case 'polling': {
      const { value, unit } = intervalParts(schedule.intervalMs)
      return t.schedule.everyMs(value, t.schedule.units[unit])
    }
    case 'scheduled': return `${describeCron(schedule.cron, t) ?? schedule.cron} · ${schedule.timezone}`
  }
}

/** Display name of a Run: its business key, or its kind and creation time.
 * @param run - execution.
 * @param t - copy.
 * @returns short name.
 */
export function runName(run: Pick<Run, 'businessKey' | 'kind' | 'createdAt'>, t: Messages): string {
  if (run.businessKey !== null) return run.businessKey
  return `${t.runs.execution(t.kind[run.kind])} · ${formatTime(run.createdAt)}`
}

/** Short prefix of an opaque identity for tables.
 * @param id - Run identity.
 * @returns first eight characters.
 */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

/** Title of a definition by identity.
 * @param definitions - known definitions.
 * @param id - definition identity.
 * @returns title, or the identity itself.
 */
export function definitionTitle(definitions: readonly Definition[] | undefined, id: string): string {
  return definitions?.find(definition => definition.id === id)?.title ?? id
}

/** Localized failure message.
 * @param failure - problem or transport failure.
 * @param t - copy.
 * @returns message naming the problem.
 */
export function failureText(failure: RequestFailure | undefined, t: Messages): string {
  if (failure === undefined) return ''
  if (failure.kind === 'transport') return t.errors.transport
  return t.errors.codes[failure.code] ?? `${t.errors.unknown(failure.code)} ${failure.detail}`
}
