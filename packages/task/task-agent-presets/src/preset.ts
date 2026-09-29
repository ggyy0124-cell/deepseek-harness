/** Agent-preset vocabulary shared by discovery, mounting, and consumers. */

import type { Volatile } from '@deepseek-ai/cordis'
import type { PresetTrust } from './types.ts'

export type { PresetTrust } from './types.ts'

/** One preset directory that carries a mountable agent composition. */
export interface AgentPreset {
  /** Stable identifier; the preset directory's name. */
  readonly id: string
  /** Trust recorded from the root this preset was discovered under. */
  readonly trust: PresetTrust
  /** Absolute path of the preset's agent composition file. */
  readonly path: string
  /** Display name from the preset's own metadata; absent falls back to {@link id}. */
  readonly name?: string
  /** One sentence on what this preset is for, when it published one. */
  readonly description?: string
  /** Declared position within its group; absent sorts after those that declare one. */
  readonly order?: number
  /**
   * Why the preset cannot be mounted; absent when the discovery-time checks
   * passed. A broken preset is listed so a client can explain the problem, but
   * resolving it for a mount refuses.
   */
  readonly broken?: string
}

/**
 * Ids a preset directory may use.
 *
 * The id becomes a path segment, so this is a containment boundary rather than
 * a style rule: `..`, a separator, or an absolute-looking name would place the
 * composition outside the root the deployment authorised. Discovery shares it:
 * a directory whose name no copy could ever claim is not a preset slot.
 */
export const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** One directory scanned for preset subdirectories. */
export interface PresetRoot {
  /** Directory holding one subdirectory per preset; a leading `~` expands. */
  path: string
  /** Trust recorded on every preset discovered under this root. */
  trust: PresetTrust
}

/** Plugin config: which preset is the default, and where presets live. */
export interface Config {
  /** Preset id mounted when a caller names none. Missing at mount time fails loud. */
  default: string
  /** User-selected default over {@link default}; applies only while {@link modeSelectionEnabled} is true. */
  selectedDefault: Volatile<string | undefined>
  /** Whether the user-selected default governs unnamed new sessions. */
  modeSelectionEnabled: Volatile<boolean>
  /** Scanned roots in precedence order; an earlier root wins a duplicate id. */
  roots: PresetRoot[]
  /**
   * Prepend this package's bundled shipped presets as a `system` root, before
   * every configured root, so the shipped set always mounts and wins a
   * duplicate id. The default survives a whole-`config` patch replacement;
   * only an explicit `false` — a deployment supplying purely its own presets,
   * or an embedder using the roster as bare machinery — drops the set.
   */
  includeShippedRoot: boolean
  /**
   * Append the harness home's `USER_PRESET_DIR` as a `user` root, after every
   * configured root. False mounts a roster without the derived writable root.
   */
  includeUserRoot: boolean
}

/** Plugin config as `cordis.yml` supplies it, before schema defaults and volatile wrapping. */
export interface ConfigInput {
  /** Preset id mounted when a caller names none. */
  default: string
  /** Scanned roots in precedence order. */
  roots?: PresetRoot[]
  /** Prepend the bundled shipped presets as a `system` root. */
  includeShippedRoot?: boolean
  /** Append the harness home's user preset root. */
  includeUserRoot?: boolean
  /** User-selected default over {@link default}. */
  selectedDefault?: string
  /** Whether the user-selected default governs unnamed new sessions. */
  modeSelectionEnabled?: boolean
}
