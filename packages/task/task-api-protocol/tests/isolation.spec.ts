/** The source-isolation check rejects each original provider and allows Task-owned files. */
import { describe, expect, it } from 'vitest'
import { taskProtectedChanges } from '../../../../scripts/verify-task-source-isolation.ts'

describe('Task protected source policy', () => {
  it.each([
    'packages/bundle/base/src/index.ts', 'packages/bundle/web-app/cordis.patch.yml', 'apps/web/src/main.ts',
    'packages/core/session/src/index.ts', 'packages/core/agent/src/index.ts', 'packages/core/agent-loop/src/index.ts',
    'packages/session/session-persistence-jsonl/src/index.ts', 'packages/preset/agent-presets/src/index.ts',
    'packages/host/webserver/src/index.ts', 'packages/credentials/credentials-local/src/index.ts',
    'packages/client/ui-primitives/src/Button.tsx', 'packages/client/web/src/index.ts',
  ])('rejects original module changes: %s', (path) => {
    expect(taskProtectedChanges([path])).toEqual([path])
  })
  it('allows Task ownership and shared assembly metadata', () => {
    expect(taskProtectedChanges([
      'packages/task/task-session/src/index.ts', 'packages/task/task-api-client/src/index.ts',
      'packages/bundle/task-app/cordis.patch.yml',
      'packages/boot/app-boot/src/profile.ts', 'tsconfig.base.json', 'pnpm-lock.yaml',
    ])).toEqual([])
  })
  it('allows documentation updates without changing protected module code', () => {
    expect(taskProtectedChanges([
      'packages/bundle/base/README.md', 'packages/bundle/base/README.zh.md',
      'packages/bundle/base/README.i18n.yaml',
    ])).toEqual([])
  })
})
