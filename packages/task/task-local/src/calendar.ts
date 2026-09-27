/** Calendar occurrence enumeration; the durable scheduler owns every timer. */
import { Cron } from 'croner'
import type { TaskSchedule } from '@deepseek-ai/dsh-task'

/** Resolve the next calendar occurrence without installing a process-local cron timer.
 *
 * @param schedule - validated calendar rule.
 *
 * @param after - exclusive UTC timestamp.
 *
 * @returns next occurrence or null for an exhausted expression.
 */
export function nextCalendar(schedule: Extract<TaskSchedule, { kind: 'scheduled' }>, after: number): number | null {
  if (schedule.cron.trim().split(/\s+/u).length !== 5) throw new Error('task calendar requires a five-field cron expression')
  new Intl.DateTimeFormat('en', { timeZone: schedule.timezone }).format(after)
  const cron = new Cron(schedule.cron, { timezone: schedule.timezone, paused: true })
  try {
    let candidate = cron.nextRun(new Date(after))
    // Croner advances nonexistent wall times across a DST gap. Calendar tasks skip that occurrence.
    while (candidate !== null && !cron.match(candidate)) candidate = cron.nextRun(candidate)
    return candidate?.getTime() ?? null
  }
  finally { cron.stop() }
}
