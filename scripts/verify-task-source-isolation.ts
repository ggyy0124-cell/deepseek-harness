/** Reject Task changes to the original runtime providers and browser application sources. */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const protectedPrefixes = [
  'packages/bundle/base/', 'packages/bundle/web-app/', 'apps/web/',
  'packages/core/session/', 'packages/core/agent/', 'packages/core/agent-loop/',
  'packages/session/session-persistence-jsonl/', 'packages/preset/agent-preset-registry/', 'packages/preset/agent-preset/',
  'packages/host/webserver/', 'packages/credentials/', 'packages/client/',
]

/** Find protected tracked paths changed by the Task implementation.
 * @param paths - repository-relative paths from a NUL-delimited Git change listing.
 * @returns protected original module paths.
 */
export function taskProtectedChanges(paths: readonly string[]): string[] {
  return paths.filter(path => protectedPrefixes.some(prefix => path.startsWith(prefix)) &&
    !/\/README(?:\.zh)?\.(?:md|i18n\.yaml)$/.test(path))
}

/** Check staged and unstaged source changes against an explicit Git baseline.
 * @param baseline - commit or ref defining the unmodified original modules.
 */
export function verifyTaskSourceIsolation(baseline: string): void {
  const names = execFileSync('git', ['diff', '--name-only', '-z', baseline, '--'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  const blocked = taskProtectedChanges(names)
  if (blocked.length !== 0) throw new Error(`Task changes protected original modules:\n${blocked.join('\n')}`)
  process.stdout.write('verify-task-source-isolation: protected original modules have no tracked changes.\n')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyTaskSourceIsolation(process.argv[2] ?? 'HEAD')
}
