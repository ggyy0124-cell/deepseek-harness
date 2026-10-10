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
  /** Listen host: loopback, or all interfaces for intranet browsers. */
  readonly host: '127.0.0.1' | '0.0.0.0'
  readonly port: number
  /** `--trusted-host` authorities in argument order, passed to the gateway's `trustedHosts`. */
  readonly trustedHosts: string[]
  readonly command: 'serve' | 'token-create' | 'token-revoke' | 'launch-link' | 'password-set' | 'backup' | 'restore'
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
    .option('--host <host>', 'listen host: 127.0.0.1, or 0.0.0.0 with --trusted-host', '127.0.0.1')
    .option('--port <port>', 'listen port; 0 selects a free port', '3081')
    .option('--trusted-host <authority...>', 'browser address host or host:port accepted besides loopback (repeatable)')
    .option('--token-create', 'issue a native client credential without starting the server')
    .option('--token-revoke <id>', 'revoke a native client credential')
    .option('--launch-link', 'issue a one-time browser launch link for the Task host on --port')
    .option('--password-set', 'store the browser sign-in password read from standard input')
    .option('--backup <directory>', 'back up an inactive Task store to a new directory')
    .option('--restore <directory>', 'restore a verified backup into an empty Task store')
  program.action(() => {
    const flags = program.opts<{
      host: string
      port: string
      trustedHost?: string[]
      tokenCreate?: boolean
      tokenRevoke?: string
      launchLink?: boolean
      passwordSet?: boolean
      backup?: string
      restore?: string
    }>()
    const host = flags.host === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'
    if (flags.host !== host || !/^\d+$/.test(flags.port) || Number(flags.port) > 65535)
      program.error('Task requires host 127.0.0.1 or 0.0.0.0 and port 0–65535')
    if (host === '0.0.0.0' && (flags.trustedHost ?? []).length === 0)
      program.error('Task on 0.0.0.0 requires --trusted-host <authority> for the address browsers open')
    if (
      [flags.tokenCreate, flags.tokenRevoke, flags.launchLink, flags.passwordSet, flags.backup, flags.restore].filter(
        value => value !== undefined,
      ).length > 1
    )
      program.error('Choose one Task administration command')
    ctx.provide('taskStartup', {
      host,
      port: Number(flags.port),
      trustedHosts: flags.trustedHost ?? [],
      command: flags.tokenCreate
        ? 'token-create'
        : flags.tokenRevoke !== undefined
          ? 'token-revoke'
          : flags.launchLink
            ? 'launch-link'
            : flags.passwordSet
              ? 'password-set'
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
