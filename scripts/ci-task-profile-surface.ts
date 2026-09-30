/**
 * Task Profile fork CI surface: same gate types as the full harness, scoped to
 * Task Profile packages, CLI profiles, snapshots, and their workspace touch points.
 */

/** Environment variable selecting a narrowed CI surface. */
export const DSH_CI_SURFACE_ENV = 'DSH_CI_SURFACE'

/** Value that selects Task Profile scoped gates. */
export const TASK_PROFILE_CI_SURFACE = 'task-profile'

/** Fork repository that runs Task Profile scoped CI on pull requests. */
export const TASK_PROFILE_FORK_REPOSITORY = 'ggyy0124-cell/deepseek-harness'

/** @returns Whether the active process runs Task Profile scoped CI gates. */
export function isTaskProfileCiSurface(): boolean {
  return process.env[DSH_CI_SURFACE_ENV] === TASK_PROFILE_CI_SURFACE
}

/** Vitest file filters for Task Profile unit and profile tests. */
export const TASK_PROFILE_TEST_INCLUDES = [
  'packages/task/**/tests/**/*.spec.{ts,tsx}',
  'packages/bundle/task-app/tests/**/*.spec.ts',
  'packages/boot/app-boot/tests/profile.spec.ts',
] as const

/**
 * Per-file coverage scope for Task Profile owned runtime source. The shared
 * Vitest coverage excludes still apply, including the parity-pinned Task Agent
 * Loop copy and the Task App launcher entries.
 */
export const TASK_PROFILE_COVERAGE_INCLUDES = [
  'packages/task/*/src/**',
] as const

/** Vitest path filters selecting every Task Profile unit and profile test for the coverage run. */
export const TASK_PROFILE_COVERAGE_SUITES = [
  'packages/task/',
  'packages/bundle/task-app/tests/',
  'packages/boot/app-boot/tests/profile.spec.ts',
] as const

/** jscpd scan roots for Task Profile duplication checks. */
export const TASK_PROFILE_DUPLICATION_PATHS = [
  'packages/task',
  'packages/bundle/task-app',
  'packages/boot/app-boot/src/profile.ts',
  'scripts/verify-task-source-isolation.ts',
] as const

/** Recorded-session replay entry points for Task Profile. */
export const TASK_PROFILE_SNAPSHOT_PATH = 'snapshots/task'
