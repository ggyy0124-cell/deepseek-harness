/** Gateway-owned credential identities for local provisioning callers. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Device revocation identity; it is not the device's bearer secret. */
export type TaskDeviceId = Branded<'TaskDeviceId'>
