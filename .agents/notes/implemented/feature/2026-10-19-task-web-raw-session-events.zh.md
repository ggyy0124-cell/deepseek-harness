# Agent Note: 通过宿主参数在 Task Web 中查看原始 Session 事件

Status: implemented

[English](2026-10-19-task-web-raw-session-events.md) | 中文

## 问题

排查 Task Run 时，常常需要看已存储的 Session 事件本身：流式分片、`step/start` 或 `working-directory/change` 等生命周期事件、原始工具参数，以及被 transcript 投影丢弃的事件。DSH Web 通过可选的开发者工具组合包（`dsh-experimental-inspector-profile`）及其会话数据诊断展示这些事件，但该诊断是基于 DSH Web 的 Session、Chat 与 Sidebar 服务构建的 Web 客户端插件。Task Web 是独立的 Vite 应用，有严格的内容安全策略，没有 Cordis 客户端加载器；Task Profile 用 Task 自有提供方替换了共享 Session 服务，网关也只提供投影后的 transcript，因此两者都无法挂载这个诊断插件。

## 决策

`GET /runs/{runId}/session-log`（`getSessionLog`）返回 Run 未经投影的已存储事件：每项包含 `sequence`、ISO 时间 `at`、`type` 和持久化的 JSON `event`。它沿用 transcript 的只读句柄、归属检查和以前一事件指纹为锚点的前向游标，由 `limit` 和新的 `sessionLogPageBytes` 预算（默认 512 KiB）限制窗口大小；超过预算的单个事件独占一个窗口。由于这些值未经脱敏，除非设置网关的 `sessionLog` 选项，否则网关返回 `404 session_log_disabled`；Task 应用通过新的启动参数 `--session-log` 设置该选项，因此开启时不需要 Profile 补丁。

Task Web 新增第三个会话视图「原始事件」。它按循环位置嵌套事件，把助手消息的流式记录展开为逐个分片的行，归在所属内容块的 `block-start` 之下；按类型筛选时支持 `*` 通配符，并保留匹配行的父级作为上下文；选中一行时显示其存储的 JSON。它每次最多读取 1000 个事件，之后提供加载下一批；读到日志末尾后，每当有新的 transcript 消息或 Run 状态变化，就读取新追加的事件。宿主未开启、Session 尚未存储和读取失败各有独立的状态。分组方式参照会话数据诊断的日志视图，代码由 Task 自行维护。

## 考虑过的替代方案

**在 Task Profile 中挂载开发者工具组合包。** 否决：Task Web 没有 Web 客户端插件的宿主，会话数据诊断依赖 Task Profile 不运行的 DSH Web Session 与 Chat 服务。其 NodeJS 诊断还允许执行任意代码并采集未脱敏的 fetch 请求，部署的 Task 服务不能暴露这些能力。

**在独立的 DSH Web Profile 中打开 Task Session 文件的副本。** 仅保留为离线排查手段：需要复制文件，因为从 DSH Web 打开运行中的 Task Session 会取得其写入所有权，而且不保证 Task 特有事件能在那里正常显示。

**始终提供该路由。** 否决：原始事件包含工具参数和结果，其中有 transcript 投影省略的值，因此是否暴露应由运维人员在每次启动宿主时明确选择。

**直接复用会话数据诊断包的分组代码。** 否决：它是绑定 DSH Web Session 事件源和存储的客户端插件；把它导入 Task Web 会把这些服务带进打包产物，并让 Task 分支依赖一个上游实验包。

## 影响

运维人员使用 `--session-log` 重启宿主后，即可在 Task Web 中查看任一 Run 的已存储事件；不加该参数时行为不变。原始读取的开销与 transcript 读取相当，只是窗口更大。该视图只检查父 Run 的 Session，不列出子 agent 的 Session 和投影控制帧。`session-log.e2e.ts` 在使用该参数启动的宿主上回放录制的 `model-wait` Session，并操作该视图。
