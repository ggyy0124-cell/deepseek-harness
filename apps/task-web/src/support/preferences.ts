/** Per-browser display preferences: language, appearance and time zone of displayed times. */
import { Store } from './store.ts'

/** Supported interface languages. */
export type Locale = 'zh-CN' | 'en'
/** Appearance choice. */
export type Appearance = 'light' | 'dark' | 'system'
/** Time zone used for displayed times; API times are always UTC. */
export type TimeDisplay = 'local' | 'utc'

/** Display preferences stored in this browser. */
export interface Preferences {
  readonly locale: Locale
  readonly appearance: Appearance
  readonly time: TimeDisplay
}

const KEY = 'dsh-task-web.preferences'

function initial(): Preferences {
  const fallback: Preferences = {
    locale: navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en',
    appearance: 'system',
    time: 'local',
  }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return fallback
    const value = JSON.parse(raw) as Partial<Preferences>
    return {
      locale: value.locale === 'en' || value.locale === 'zh-CN' ? value.locale : fallback.locale,
      appearance: value.appearance === 'light' || value.appearance === 'dark' || value.appearance === 'system' ? value.appearance : fallback.appearance,
      time: value.time === 'utc' ? 'utc' : 'local',
    }
  } catch {
    return fallback // Storage may be unavailable or hold a value from another version.
  }
}

/** Shared preference store. */
export const preferences = new Store<Preferences>(initial())

/** Update and persist preferences.
 * @param patch - changed fields.
 */
export function updatePreferences(patch: Partial<Preferences>): void {
  const next = { ...preferences.get(), ...patch }
  preferences.set(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage may be unavailable in private windows; the preference still applies to this page.
  }
}

/** Apply appearance and document language, following later preference and system changes. */
export function applyPreferences(): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    const value = preferences.get()
    const dark = value.appearance === 'dark' || (value.appearance === 'system' && media.matches)
    document.body.toggleAttribute('data-ds-dark-theme', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    document.documentElement.lang = value.locale
  }
  apply()
  preferences.subscribe(apply)
  media.addEventListener('change', apply)
}
