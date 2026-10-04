/** Application services shared by every page. */
import { createContext, useContext } from 'react'
import type { TaskConnection } from '../support/connection.ts'
import type { TaskEventHub } from '../support/events.ts'
import type { Resource } from '../support/resource.ts'
import type { Definition, Interaction, Run } from '../support/types.ts'

/** Settings modal sections. */
export type SettingsTab = 'general' | 'connection' | 'credentials' | 'devices' | 'about'

/** Services and commands reachable from any component. */
export interface AppValue {
  readonly connection: TaskConnection
  readonly events: TaskEventHub
  /** Show a transient banner. */
  readonly toast: (text: string, tone?: 'success' | 'error') => void
  /** Open the settings modal, optionally focusing a credential reference. */
  readonly openSettings: (tab?: SettingsTab, credential?: string) => void
  /** Open the manual trigger dialog, optionally preselecting a definition. */
  readonly openTrigger: (definitionId?: string) => void
}

/** Lists read by the frame and several pages; refreshed after Task events. */
export interface SharedData {
  readonly definitions: Resource<readonly Definition[]>
  readonly active: Resource<readonly Run[]>
  readonly interactions: Resource<readonly Interaction[]>
}

/** Application service context. */
export const AppContext = createContext<AppValue | null>(null)
/** Shared list context. */
export const SharedContext = createContext<SharedData | null>(null)

/** Read application services.
 * @returns services provided by the frame.
 */
export function useApp(): AppValue {
  const value = useContext(AppContext)
  if (value === null) throw new Error('useApp requires AppContext')
  return value
}

/** Read shared lists.
 * @returns definitions, active runs and waiting interactions.
 */
export function useShared(): SharedData {
  const value = useContext(SharedContext)
  if (value === null) throw new Error('useShared requires SharedContext')
  return value
}

/** Statuses of Runs that have not ended, including cleanup-blocked Runs. */
export const ACTIVE_STATUS_QUERY = 'provisioning,queued,running,waiting_input,waiting_retry,blocked,recovering,cancelling'
