/** Demonstration business plugin for Task Web acceptance tests and local previews; it calls no external system.
 * Each Loader row registers the one definition named by `config.definition`, because a business plugin owns exactly one special task. */
export const inject = ['tasks']

const result = (title, body, extra = []) => ({
  format: 'task-result/v1',
  blocks: [{ kind: 'markdown', text: `### ${title}\n\n${body}` }, ...extra],
})

const pollingForms = {
  version: 2,
  business: {
    type: 'object',
    required: ['baseUrl', 'product'],
    properties: {
      baseUrl: { type: 'string', title: 'Tracker URL', description: 'Issue tracker address' },
      product: { type: 'string', title: 'Product', 'x-dsh-widget': 'options' },
      assignedToMe: { type: 'boolean', title: 'Only my issues' },
      severity: {
        type: 'array', title: 'Severity', uniqueItems: true,
        items: { oneOf: [{ const: 1, title: '1 Critical' }, { const: 2, title: '2 Major' }, { const: 3, title: '3 Normal' }, { const: 4, title: '4 Minor' }] },
      },
      notes: { type: 'string', title: 'Notes', 'x-dsh-widget': 'textarea' },
      token: { type: 'string', title: 'Access token', 'x-dsh-widget': 'credential' },
    },
  },
  input: {},
  supplement: { type: 'string' },
}

const manualForms = {
  version: 1,
  business: {},
  input: {
    type: 'object',
    required: ['period'],
    properties: {
      period: { type: 'string', title: 'Review period', enum: ['2026 Q3', '2026 Q2'] },
      focus: { type: 'string', title: 'Focus', 'x-dsh-widget': 'textarea' },
      review: { type: 'boolean', title: 'Review before submitting', default: true },
    },
  },
}

const scheduledForms = {
  version: 1,
  business: {
    type: 'object',
    properties: {
      template: { type: 'string', title: 'Template', enum: ['team', 'personal'] },
      publishToken: { type: 'string', title: 'Publish credential', 'x-dsh-widget': 'credential' },
    },
  },
  input: {},
}

export function apply(ctx, config) {
  const workspace = config.workspace
  const base = { concurrency: 2, preset: 'standard', permissionPreset: 'read-only', workspacePath: workspace }
  const common = {
    codeVersion: '1.0.0', parseInput: value => value, parseCheckpoint: value => value, priority: () => 0, resources: () => [],
    classifyError: (error, run) => ({ kind: 'block', checkpoint: run.checkpoint, reason: String(error instanceof Error ? error.message : error) }),
    cleanup: async () => {},
  }
  const issues = config.issues ?? ['BUG-4821', 'BUG-4826']

  const definitions = {}
  definitions.defects = () => ({
    ...common, id: 'demo.defects', title: 'Defect polling', forms: pollingForms,
    config: { ...base, schedule: { kind: 'polling', intervalMs: config.pollMs ?? 3600000 },
      business: { baseUrl: 'https://tracker.example', product: 'mobile', assignedToMe: true, severity: [1, 2], token: 'DEMO_TRACKER_TOKEN' } },
    checkConfig: async next => [`Product ${next.business?.product ?? '?'} is reachable`, 'The access token expires in 12 days'],
    options: async field => (field === 'product' ? [{ value: 'mobile', label: 'Mobile App' }, { value: 'web', label: 'Web Console' }] : []),
    businessKey: input => input.id,
    compareUpdate: () => 'ignore',
    runSpecial: async (stage) => {
      for (const id of issues) await stage.dispatch(`dispatch:${id}`, { id, title: `Issue ${id}` })
      return { kind: 'succeed', result: result('Poll finished', `Dispatched ${issues.length} issues.`) }
    },
    runOrdinary: async (stage) => {
      const response = stage.inputs.filter(input => input.kind === 'response').at(-1)?.value
      if (response === undefined) {
        return {
          kind: 'wait', checkpoint: 'plan',
          prompt: { title: `Confirm the fix plan for ${stage.run.input.id}`, body: 'Plan: normalize the **token expiry unit** in `session.ts` and add a regression test.' },
          schema: {
            type: 'object', required: ['decision'], properties: {
              decision: { oneOf: [{ const: 'approve', title: 'Approve and continue', description: 'Implement the plan' }, { const: 'reject', title: 'Reject', description: 'End the run' }] },
              note: { type: 'string' },
            },
          },
          expiresAt: Date.now() + 22 * 3600000,
        }
      }
      if (response.decision === 'reject') return { kind: 'fail', reason: 'Plan rejected by reviewer' }
      return {
        kind: 'succeed',
        result: result('Fix summary', `Fixed ${stage.run.input.id}.${response.note ? ` Note: ${response.note}` : ''}`, [
          { kind: 'table', columns: ['Item', 'Result'], rows: [['Unit tests', '128 passed'], ['Review', 'Change I8f3c2a1e']] },
          { kind: 'diff', text: '--- a/src/session.ts\n+++ b/src/session.ts\n@@ -1,3 +1,3 @@\n export function expiry(seconds) {\n-  return seconds\n+  return seconds * 1000\n }\n' },
          { kind: 'json', value: { issue: stage.run.input.id, status: 'resolved' } },
        ]),
      }
    },
  })

  definitions.weekly = () => ({
    ...common, id: 'demo.weekly', title: 'Weekly report', forms: scheduledForms,
    config: { ...base, concurrency: 1, schedule: { kind: 'scheduled', cron: config.cron ?? '0 17 * * 5', timezone: 'Asia/Shanghai', misfire: 'coalesce', overlap: 'queue' },
      business: { template: 'team', publishToken: 'WEEKLY_REPORT_TOKEN' } },
    runSpecial: async (stage) => {
      if (stage.inputs.some(input => input.kind === 'input')) return { kind: 'succeed', result: result('Weekly report', 'Published after the credential was configured.') }
      return { kind: 'block', checkpoint: 'publish', reason: 'Credential WEEKLY_REPORT_TOKEN is not configured' }
    },
  })

  definitions.review = () => ({
    ...common, id: 'demo.review', title: 'Performance review', forms: manualForms,
    config: { ...base, concurrency: 1, schedule: { kind: 'manual' }, business: {} },
    runSpecial: async (stage) => {
      const response = stage.inputs.filter(input => input.kind === 'response').at(-1)?.value
      if (stage.run.input?.review === true && response === undefined) {
        return { kind: 'wait', checkpoint: 'draft', prompt: { title: 'Submit the review draft?', body: `Draft for **${stage.run.input.period}**: ${stage.run.input.focus ?? ''}` }, schema: { type: 'boolean' } }
      }
      if (response === false) return { kind: 'fail', reason: 'Draft declined' }
      return { kind: 'succeed', result: result('Review submitted', `Period ${stage.run.input?.period ?? '?'}.`) }
    },
  })

  let cleanupFailures = config.cleanupFailures ?? 1
  definitions.cleanup = () => ({
    ...common, id: 'demo.cleanup', title: 'Cleanup drill', forms: { version: 1, business: {}, input: {} },
    config: { ...base, concurrency: 1, schedule: { kind: 'manual' }, business: {} },
    runSpecial: async () => ({ kind: 'fail', reason: 'Build failed after three attempts' }),
    cleanup: async () => {
      if (cleanupFailures > 0) { cleanupFailures--; throw new Error('worktree is still locked') }
    },
  })
  definitions.agent = () => ({
    ...common, id: 'demo.agent', title: 'Agent analysis', forms: { version: 1, business: {}, input: {} },
    config: { ...base, concurrency: 1, schedule: { kind: 'manual' }, business: {}, ...(config.permissionPreset === undefined ? {} : { permissionPreset: config.permissionPreset }) },
    runSpecial: async (stage) => {
      const answer = await stage.model('analyze', config.prompt ?? 'Analyze BUG-4821: users are signed out about 30 minutes after login. Ask before changing code.')
      return { kind: 'succeed', result: result('Analysis', answer) }
    },
  })

  const create = definitions[config.definition]
  if (create === undefined) throw new Error(`unknown demo definition ${String(config.definition)}`)
  ctx.tasks.register(ctx, create())
}
