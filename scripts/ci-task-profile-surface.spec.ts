import { describe, expect, it } from 'vitest'
import {
  DSH_CI_SURFACE_ENV,
  isTaskProfileCiSurface,
  TASK_PROFILE_CI_SURFACE,
  TASK_PROFILE_COVERAGE_INCLUDES,
  TASK_PROFILE_TEST_INCLUDES,
} from './ci-task-profile-surface.ts'

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
    expect(TASK_PROFILE_COVERAGE_INCLUDES.some(entry => entry.includes('packages/task/task/'))).toBe(true)
  })
})
