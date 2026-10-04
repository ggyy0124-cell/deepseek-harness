/** Locale selection for the Task Web client. */
import { useStore } from '../support/store.ts'
import { preferences, type Locale } from '../support/preferences.ts'
import { en } from './en.ts'
import { zhCN, type Messages } from './zh-CN.ts'

export type { Messages } from './zh-CN.ts'

const dictionaries: Record<Locale, Messages> = { 'zh-CN': zhCN, en }

/** Copy for a locale.
 * @param locale - interface language.
 * @returns typed dictionary.
 */
export function messagesFor(locale: Locale): Messages {
  return dictionaries[locale]
}

/** Copy of the current preference, re-rendering on language change.
 * @returns typed dictionary.
 */
export function useT(): Messages {
  return dictionaries[useStore(preferences).locale]
}
