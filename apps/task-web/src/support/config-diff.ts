/** Field-level comparison and merge of execution configurations for unsaved-change counts and conflict reapplication. */
import type { Json, TaskConfig } from './types.ts'

/** One changed leaf path with its previous and next value. */
export interface ConfigChange {
  readonly path: readonly string[]
  readonly before: Json | undefined
  readonly after: Json | undefined
}

function isRecord(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function walk(before: Json | undefined, after: Json | undefined, path: readonly string[], out: ConfigChange[]): void {
  if (isRecord(before) && isRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) walk(before[key], after[key], [...path, key], out)
    return
  }
  // A schedule kind change replaces its whole object; other non-object leaves compare by value.
  if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ path, before, after })
}

/** List changed leaves between two configurations.
 * @param before - saved configuration.
 * @param after - edited configuration.
 * @returns changed paths in key order.
 */
export function configChanges(before: TaskConfig, after: TaskConfig): ConfigChange[] {
  const out: ConfigChange[] = []
  walk(toJson(before), toJson(after), [], out)
  return out
}

/** Apply changed leaves onto another configuration.
 * @param base - latest saved configuration.
 * @param changes - edits made against an older revision.
 * @returns merged configuration.
 */
export function applyChanges(base: TaskConfig, changes: readonly ConfigChange[]): TaskConfig {
  const root = toJson(base) as { [key: string]: Json }
  for (const change of changes) {
    let node: { [key: string]: Json } = root
    for (const segment of change.path.slice(0, -1)) {
      const next = node[segment]
      if (!isRecord(next)) node[segment] = {}
      node = node[segment] as { [key: string]: Json }
    }
    const last = change.path.at(-1)
    if (last === undefined) continue
    if (change.after === undefined) Reflect.deleteProperty(node, last)
    else node[last] = structuredClone(change.after)
  }
  return JSON.parse(JSON.stringify(root)) as TaskConfig
}

/** Copy a configuration as plain JSON.
 * @param config - execution configuration.
 * @returns detached JSON value.
 */
export function toJson(config: TaskConfig): Json {
  return JSON.parse(JSON.stringify(config)) as Json
}
