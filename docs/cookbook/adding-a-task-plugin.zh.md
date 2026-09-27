# 操作指南：添加 Task 业务插件

[English](adding-a-task-plugin.md) | 中文

这个本机示例注册一个手动特殊任务、派发一个普通任务，并通过 Task API 查看两次执行。示例不写入外部系统，也不调用模型。[Task 接口](../../packages/task/task/README.zh.md)定义阶段约定；[Task 应用](../../packages/bundle/task-app/README.zh.md)说明启动和凭据。

## 1. 创建插件

将下列内容保存为 `sample-business.mjs`，与 Task profile patch 放在同一目录。把 patch 中的 `workspace` 设为已经存在的绝对目录。每个插件实例只注册一个特殊任务定义；普通任务是该定义的处理器，不是另一个定义。

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

此冒烟测试定义不校验业务 JSON；真实插件应校验输入和检查点，并在重试前核对结果不确定的外部操作。这里的 `compareUpdate` 返回 `ignore`，因为示例没有变化的业务来源。注册归属于插件上下文，因此卸载会退出其执行并等待清理。

## 2. 挂载并启动

将此 patch 保存为插件旁边的 `task.patch.yml`，并替换工作目录路径。插入行中的相对插件名称以 patch 文件所在目录为基准解析。

```yaml
- insert:
    - id: sample-business
      name: ./sample-business.mjs
      config:
        workspace: /absolute/existing-workspace
```

在该目录运行 `dsh --profile task --patch ./task.patch.yml`，或在仓库检出目录使用 `pnpm dsh`。保持进程运行。启动时会输出 API 地址，默认通常为 `http://127.0.0.1:3081/api/task/v1/`。端口冲突时可使用 `--port <port>`；Task profile 不提供 HTML 页面。

## 3. 触发并查看

在使用相同 `DSH_HOME` 的另一个终端运行 `dsh --profile task --token-create`，妥善保管输出的 Bearer Token。将它作为下列请求的 `TASK_TOKEN` 提交；如果服务输出了其他端口，请替换 API 地址。

```sh
curl -fsS -X POST http://127.0.0.1:3081/api/task/v1/definitions/sample-business/runs \
  -H "Authorization: Bearer $TASK_TOKEN" \
  -H 'Idempotency-Key: sample-trigger-1' \
  -H 'Content-Type: application/json' \
  --data '{"input":null}'
curl -fsS http://127.0.0.1:3081/api/task/v1/runs \
  -H "Authorization: Bearer $TASK_TOKEN"
```

触发请求返回特殊任务执行。历史列表随后包含该执行，以及拥有独立 Session 和来源关联的已完成普通任务执行。使用相同幂等键重复 POST 会返回原受理结果。完成后使用 Token 创建时输出的 ID 执行 `dsh --profile task --token-revoke <device-id>`。

## 4. 替换或卸载业务代码

随附的 Task profile 监视自身和 home 的 patch 文件。实时修改时，把插件挂载到 `$DSH_HOME/profiles/task/cordis.patch.yml`；`--patch` 适合单次启动。卸载业务插件会停止接纳新工作，并取消未结束执行；必须等退出状态达到 `complete` 后才能移除已安装代码或依赖。清理失败时任务保持阻塞并占用资源。已结束 Session 仍可读取。恢复及退出规则见 [Task 本地提供方](../../packages/task/task-local/README.zh.md)；派发与确认示例见 [Profile 测试 fixture](../../apps/cli/tests/profiles/task/fixtures/business.mjs)。
