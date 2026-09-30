// A preset row resolved relative to its declaring base: registers one tool and
// one prompt section, both named from config.
export const name = 'contribute'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx, config) {
  ctx.effect(() => ctx.tools.register({
    name: config.tool,
    description: `fixture tool ${config.tool}`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: () => Promise.resolve(config.tool),
  }))
  ctx.effect(() => ctx.systemPrompt.section({
    name: `preset:${config.tool}`,
    order: 10,
    text: `section for ${config.tool}`,
  }))
}
