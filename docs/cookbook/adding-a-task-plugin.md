# Cookbook: add a Task business plugin

English | [中文](adding-a-task-plugin.zh.md)

Use this local example to register one manual special task, dispatch one ordinary task, and observe both executions through the Task API. The example makes no external writes and calls no model. The [Task interface](../../packages/task/task/README.md) owns the stage contracts; the [Task application](../../packages/bundle/task-app/README.md) owns startup and credentials.

## 1. Create the plugin

Save this file as `sample-business.mjs` beside a Task profile patch. Set the patch's `workspace` to an existing absolute directory. Each plugin instance registers exactly one special definition; ordinary work is a handler on that definition, not another definition.

```js
export const inject = ['tasks']

export function apply(ctx, config) {
  ctx.tasks.register(ctx, {
    id: 'sample-business', title: 'Sample business', codeVersion: '1',
    config: {
      schedule: { kind: 'manual' }, concurrency: 1, preset: 'standard',
      permissionPreset: 'read-only', workspacePath: config.workspace, business: null,
    },
    parseInput: value => value, parseCheckpoint: value => value,
    runSpecial: async stage => {
      await stage.dispatch('item-1', { id: 'item-1' })
      return { kind: 'succeed', result: 'dispatched' }
    },
    runOrdinary: async () => ({ kind: 'succeed', result: 'done' }),
    businessKey: input => input.id, compareUpdate: () => 'ignore',
    priority: () => 0, resources: () => [],
    classifyError: (_error, run) => ({
      kind: 'block', checkpoint: run.checkpoint, reason: 'repair required',
    }),
    cleanup: async () => {},
  })
}
```

This smoke definition accepts JSON without business validation; real plugins validate input and checkpoints and reconcile uncertain external operations before retrying. `compareUpdate` returns `ignore` here because the example has no changing business source. The registration is owned by the plugin context, so removal retires its executions and waits for cleanup.

## 2. Mount and start it

Save this patch as `task.patch.yml` beside the plugin, replacing the workspace path. Relative plugin names in an inserted row resolve from the patch file's directory.

```yaml
- insert:
    - id: sample-business
      name: ./sample-business.mjs
      config:
        workspace: /absolute/existing-workspace
```

Start `dsh --profile task --patch ./task.patch.yml` from that directory, or use `pnpm dsh` from a repository checkout. Keep the process running. Startup prints the API address, normally `http://127.0.0.1:3081/api/task/v1/`. A port conflict can be avoided with `--port <port>`; the Task profile serves no HTML page.

## 3. Trigger and inspect

In another terminal using the same `DSH_HOME`, run `dsh --profile task --token-create` and keep the printed bearer token private. Supply it in the following requests as `TASK_TOKEN`; replace the API address if the server printed another port.

```sh
curl -fsS -X POST http://127.0.0.1:3081/api/task/v1/definitions/sample-business/runs \
  -H "Authorization: Bearer $TASK_TOKEN" \
  -H 'Idempotency-Key: sample-trigger-1' \
  -H 'Content-Type: application/json' \
  --data '{"input":null}'
curl -fsS http://127.0.0.1:3081/api/task/v1/runs \
  -H "Authorization: Bearer $TASK_TOKEN"
```

The trigger returns the special execution. The history then contains that execution and an independently completed ordinary execution with its own Session and a source association. Repeating the POST with the same idempotency key returns the original admission result. Use `dsh --profile task --token-revoke <device-id>` with the ID printed by token creation when finished.

## 4. Replace or remove business code

The shipped Task profile watches its profile and home patch files. For live changes, mount the plugin in `$DSH_HOME/profiles/task/cordis.patch.yml`; `--patch` is useful for a one-off launch. Unmounting a business plugin stops new admission and cancels its unfinished executions; wait for retirement to report `complete` before removing the installed code or dependencies. Failed cleanup remains blocked with its resources held. Existing finished Sessions remain readable. See [Task local provider](../../packages/task/task-local/README.md) for recovery and retirement rules and the [profile test fixture](../../apps/cli/tests/profiles/task/fixtures/business.mjs) for a dispatch-and-confirmation example.
