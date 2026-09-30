import { describe, expect, it } from 'vitest'
import {
  DSH_CI_SURFACE_ENV,
  isTaskProfileCiSurface,
  TASK_PROFILE_CI_SURFACE,
  TASK_PROFILE_COVERAGE_INCLUDES,
  TASK_PROFILE_COVERAGE_SUITES,
  TASK_PROFILE_TEST_INCLUDES,
} from './ci-task-profile-surface.ts'
import { ciSharedStaticGates, docQuickLeafGates, taskProfileStaticGates } from './run-gates.ts'

function withEnv<T>(name: string, value: string | undefined, action: () => T): T {
  const previous = process.env[name]
  if (value === undefined) Reflect.deleteProperty(process.env, name)
  else process.env[name] = value
  try {
    return action()
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = previous
  }
}

describe('ci-task-profile-surface', () => {
  it('activates only when the surface env matches task-profile', () => {
    expect(withEnv(DSH_CI_SURFACE_ENV, undefined, () => isTaskProfileCiSurface())).toBe(false)
    expect(withEnv(DSH_CI_SURFACE_ENV, TASK_PROFILE_CI_SURFACE, () => isTaskProfileCiSurface())).toBe(true)
  })

  it('lists Task Profile test and coverage roots', () => {
    expect(TASK_PROFILE_TEST_INCLUDES.some(entry => entry.includes('packages/task/'))).toBe(true)
    expect(TASK_PROFILE_COVERAGE_INCLUDES).toContain('packages/task/*/src/**')
    expect(TASK_PROFILE_COVERAGE_SUITES).toContain('packages/task/')
  })
})

describe('Task Profile static gates', () => {
  it('keep every shared upstream static gate and quick documentation gate', () => {
    const [taskGates, upstreamGates] = withEnv('npm_execpath', '/private/pnpm.cjs',
      () => [taskProfileStaticGates(), [...ciSharedStaticGates(), ...docQuickLeafGates()]])
    const task = new Set(taskGates.map(gate => gate.id))
    for (const gate of upstreamGates) expect(task, gate.id).toContain(gate.id)
    expect(task).toContain('task-source-isolation')
  })
})
