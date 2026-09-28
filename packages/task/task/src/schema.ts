/** Pure execution configuration validation shared by storage and HTTP clients. */
import { z } from 'zod'

/** Non-secret execution choices resolved before admission. */
export const executionConfigSchema = z.strictObject({
  schedule: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('manual') }),
    z.strictObject({ kind: z.literal('polling'), intervalMs: z.number().int().positive() }),
    z.strictObject({
      kind: z.literal('scheduled'),
      cron: z.string().min(1),
      timezone: z.string().min(1),
      misfire: z.enum(['all', 'coalesce', 'skip']),
      overlap: z.enum(['queue', 'allow']),
    }),
  ]),
  concurrency: z.number().int().positive(),
  preset: z.string().min(1),
  permissionPreset: z.string().min(1),
  workspacePath: z.string().min(1),
  business: z.json(),
  model: z.strictObject({ provider: z.string().min(1), model: z.string().min(1) }).optional(),
})
