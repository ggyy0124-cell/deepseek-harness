/** Browser origin of a Task listener. */
import { isIPv6 } from 'node:net'

/** Origin a browser opens to reach a listener directly.
 * @param host - listen address.
 * @param port - listen port.
 * @returns the HTTP origin, with IPv6 addresses in brackets.
 */
export function directOrigin(host: string, port: number): string {
  return `http://${isIPv6(host) ? `[${host}]` : host}:${port}`
}
