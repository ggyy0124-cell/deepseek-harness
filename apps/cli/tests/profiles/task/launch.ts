/** One source-or-built launcher for Task profile acceptance tests. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { resolveExampleLaunch, type ExampleMode } from '@deepseek-ai/dsh-loader-smoke'
const repository = fileURLToPath(new URL('../../../../../', import.meta.url))
/** Resolve the shipped Task profile without adding a private application entrypoint.
 * @param args - Task application and launcher arguments.
 * @param mode - source or built artifacts; omission follows the test lane.
 * @returns executable, arguments and source-loader environment.
 */
export function taskProfileLaunch(args: readonly string[], mode?: ExampleMode) {
  return resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'), tsconfigPath: join(repository, 'tsconfig.json'),
    sourceImport: 'tsx/esm', configArgs: ['--profile', 'task', ...args], ...(mode === undefined ? {} : { mode }) })
}
