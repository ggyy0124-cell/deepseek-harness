# Agent Note: 从已存储的 Session 日志得到 Task Web 会话统计

Status: implemented

[English](2026-10-12-task-web-session-statistics.md) | 中文

## 问题

DSH Web 在输入框下方显示 Session 的统计：轮次和步数及输出速度、总 token 数及缓存命中比例，以及下一次请求的上下文占用，每项都能打开详情。Task Web 没有这些信息，查看 Task Run 的人无法知道一次执行花了多少 token、模型回答多快，以及 Session 离上下文窗口还有多远。Task Session 从存储读取，没有活动的 Session 或 Agent；Task Web 只加载公开的 transcript，其中不含重试的尝试、压缩的影子价格和路由容量记录。

## 决策

`GET /runs/{runId}/stats` 通过 `SessionProjectionRegistry.restore`（注册表为没有活动 Session 的日志提供的冷读取），用 Task 宿主注册的 Session 投影单元折叠整份已存储的日志。响应包含 `sessionStats`（`dsh-session-stats`）以及 `tokenUsage`、`contextPressure` 和 `contextBreakdown`（`dsh-token-meter`）的视图，因此这些数值与 DSH Web 对同一份日志显示的一致；未注册对应单元的数值为 null。Task 应用的补丁挂载 `dsh-session-stats`；Base 已挂载 `dsh-token-meter`。

网关在内存中为 `statsCacheRuns` 个 Run（默认 32）保留上一次折叠的检查点。之后的读取从检查点的最后一个事件开始，比较该事件的指纹，只折叠更新的事件；指纹改变、单元的行缺失或版本不符、检查点被淘汰时，从第一个事件重新折叠。

Task Web 在会话的输入框或只读说明下方显示三项统计；会话标签页显示时，每有新的 transcript 消息或执行状态变化，等待 400 ms 后重新读取统计，读取失败时保留上一次的数值。宽屏上每项在其上方打开详情，手机上以底部弹层打开；手机上的统计行省略输出速度并缩短缓存命中文字，使三项显示在同一行。

## 考虑过的替代方案

**在浏览器中根据 transcript 计算。** 否决：transcript 不含重试请求的 `assistant/attempt` 用量、压缩的影子价格和 `request/context` 容量记录，token 总数和上下文占用会与 DSH Web 不同，折叠逻辑也会成为投影单元的第二份副本。

**把统计放进每个 transcript 页或 Session SSE 帧。** 否决：一页只覆盖日志的一个窗口，而统计覆盖整份日志；transcript 游标限制为 2048 个字符，放不下投影状态。

**每次读取都不用检查点折叠整份日志。** 否决：运行中的 Run 每有新消息就重新读取一次，成本会随日志长度的平方增长。

**读取持久化的投影缓存。** 否决：其中的行最多落后日志 `writeEveryEvents` 个事件或 `writeIntervalMs`，而它的冷读取仍需要完整的日志。

## 后果

对同一个 Session，Task Web 与 DSH Web 报告相同的数值，包括重试的尝试和压缩。宿主启动后第一次读取某个 Run 时折叠整份日志，之后只折叠新的事件，内存中最多保留 `statsCacheRuns` 个 Run 的检查点。上下文的组成部分按字符估算，与提供方报告的占用之和不一致，面板中写明了这一点。Task 快照通过发布的 Profile 断言回放的 `model-wait` Session 的统计数值，`session-stats.e2e.ts` 在桌面和手机视口中打开各项统计及其详情。
