/** Task application flags, independent of the Web application's command provider. */
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
/** Task command provider identity. */
export const name = 'task-startup'
/** Application argument service. */
export const inject = ['cmdlineArgs']
/** Values consumed by Task application rows. */
export interface TaskStartup {
  readonly host: '127.0.0.1'
  readonly port: number
  readonly command: 'serve' | 'token-create' | 'token-revoke' | 'backup' | 'restore'
  readonly target: string
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    taskStartup: TaskStartup
  }
}
/** Publish validated invocation values; help does not start a server.
 * @param ctx - command provider owner.
 */
export function apply(ctx: Context): void {
  const program = new Command()
    .name('dsh --profile task')
    .description('Serve the DSH Task engine and API gateway.')
    .option('--host <host>', 'listen on loopback', '127.0.0.1')
    .option('--port <port>', 'listen port; 0 selects a free port', '3081')
    .option('--token-create', 'issue a native client credential without starting the server')
    .option('--token-revoke <id>', 'revoke a native client credential')
    .option('--backup <directory>', 'back up an inactive Task store to a new directory')
    .option('--restore <directory>', 'restore a verified backup into an empty Task store')
  program.action(() => {
    const flags = program.opts<{
      host: string
      port: string
      tokenCreate?: boolean
      tokenRevoke?: string
      backup?: string
      restore?: string
    }>()
    if (flags.host !== '127.0.0.1' || !/^\d+$/.test(flags.port) || Number(flags.port) > 65535)
      program.error('Task requires a loopback host and port 0–65535')
    if (
      [flags.tokenCreate, flags.tokenRevoke, flags.backup, flags.restore].filter(
        value => value !== undefined,
      ).length > 1
    )
      program.error('Choose one Task administration command')
    ctx.provide('taskStartup', {
      host: '127.0.0.1',
      port: Number(flags.port),
      command: flags.tokenCreate
        ? 'token-create'
        : flags.tokenRevoke !== undefined
          ? 'token-revoke'
          : flags.backup !== undefined
            ? 'backup'
            : flags.restore !== undefined
              ? 'restore'
              : 'serve',
      target: flags.tokenRevoke ?? flags.backup ?? flags.restore ?? '',
    } satisfies TaskStartup)
  })
  parseCmdline(ctx, program)
}
