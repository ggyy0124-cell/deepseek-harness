---
description: "经过认证的 Task REST 操作与浏览器、设备凭据管理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-task-api-gateway

[English](README.md) | 中文

## 概述

通过经过认证的 HTTP 接口配置 Task 定义和操作执行记录，同时避免暴露内部检查点。浏览器使用一次性登录凭据及受 CSRF 保护的 Cookie，原生客户端使用可撤销的 Bearer 凭据。这些路由供后续 Task Web UI 和原生客户端使用；当前 Profile 仅提供后端。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Task 应用通过未修改的 Host WebServer、Task 服务和 Credentials 提供者，在 `/api/task/v1` 挂载本包。本地应用代码通过 `ctx.taskGateway` 的 `createLaunchToken()` 或 `createDeviceToken()` 签发凭据，通过 `revokeDeviceToken()` 撤销设备后续请求的访问权。这些方法不是公共 HTTP 签发路由。调用者可以通过本地应用界面展示一次密钥，但不能将密钥写入诊断日志。

通过 `POST /auth/exchange`、准确的 Origin 请求头和 JSON `{ "token": "..." }` 交换登录凭据。响应设置 HttpOnly、SameSite Strict Cookie，并返回 CSRF 值和会话过期时间。经过认证的浏览器可通过 `GET /auth/session` 重新获取二者。Cookie 写请求必须携带相同 Origin 和 `X-CSRF-Token`；Bearer 请求使用 `Authorization`。所有 Task 状态变更都要求 `Idempotency-Key`。经过认证的 `GET /openapi.json` 描述已挂载的 JSON 操作及浏览器登录交换。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `publicOrigin` | 空 | 浏览器准确来源；空值解析为 HTTP 回环地址和实际服务端口 |
| `bodyLimitBytes` / `responseLimitBytes` | 1048576 / 4194304 | 完整 JSON 的字节上限 |
| `bodyTimeoutMs` | 30000 | 读取请求体的期限 |
| `pageSize` | 50 | 默认 Run 分页大小，上限为 200 |
| `transcriptPageBytes` | 131072 | 一个 transcript 窗口内已投影消息的 JSON 字节数上限，超出后窗口结束 |
| `launchTtlMs` / `sessionTtlMs` | 60000 / 2592000000 | 登录凭据和浏览器凭据有效期 |
| `credentialLimit` | 100 | 每种凭据最多保留的有效条目数 |
| `eventPollMs` / `eventHeartbeatMs` | 1000 / 15000 | 日志轮询和心跳间隔 |
| `eventBatchSize` / `eventBufferBytes` | 512 / 2097152 | 重放批量条数和完整套接字缓冲上限 |
| `eventDrainTimeoutMs` / `eventConnectionLimit` | 15000 / 32 | 发送阻塞期限和同时连接数上限 |

使用反向代理或非回环浏览器地址时，显式设置 `publicOrigin`。转发请求头不会改变信任判断。HTTPS 来源设置 Secure Cookie；TLS 终止由部署环境负责。

-----

<a id="understand-the-implementation"></a>

`POST /definitions/{definitionId}/retirement` 接受当前修订号和幂等键，停止接纳执行，并以 202 返回持久操作标识。移除或替换已安装的包前，通过同一 URL 的 `GET` 查询，等待 `state` 达到 `complete`。`blocked` 保留清理证据供修复后重试。`GET /diagnostics` 返回调度、队列、持久化、资源及磁盘计数，不包含业务载荷。

## 理解实现

<details>
<summary>实现细节</summary>

[认证存储](src/auth.ts) 通过 Credentials 串行更新授权记录，保存设备凭据和登录凭据的摘要。签名浏览器 Cookie 引用持久化且会过期的会话。每次请求重新读取授权记录，因此设备撤销无需等待网关重载。

[HTTP 消费者](src/index.ts) 执行 Host/Origin 检查、有界 JSON 解析、运行时协议校验和不包含业务内容的请求诊断。[操作分发](src/operations.ts) 使用引擎的原子命令回执，重放返回最初受理结果的投影。Run 分页保留首次查询的插入上界，排除后续新增记录。状态过滤反映当前状态；续页成员发生变化时返回 `cursor_stale`，客户端重新分页。

[投影](src/projection.ts) 排除执行记录的私有字段。未声明 forms 的定义暴露 Schema 版本零及通用 JSON 编辑；声明 forms 后使用 Draft 2020-12 校验、乐观配置版本和显式迁移。业务等待投影其持久化标识和版本。网关卸载时移除路由、关闭在途请求并等待处理完成。本包不发布不变量伴随插件：Task 包负责记录与 Session 的比较，本消费者直接校验 HTTP 输入和 DTO。

`GET /events` 先发布 `ready` 游标，再发送已经提交的 Task 日志通知。新客户端先订阅，再读取 REST 基线；重连客户端通过 `Last-Event-ID` 或 `cursor` 查询参数传回最后收到的游标。游标包含数据库标识，不兼容或超前的位置在开始流传输前返回 409。载荷只包含事件名、Run 标识和 UTC 时间，不包含日志详情。客户端收到通知后重新读取受影响的资源。有界 SQLite 分页和套接字缓冲避免离线客户端积累内存重放队列。发送阻塞超时、认证过期或插件卸载会关闭连接，客户端重连后从日志补读。网关在每批重放前重新检查认证。

`GET /runs/{runId}/transcript` 通过只读句柄读取现有 Session 持久化记录，不激活 Agent。`limit` 限制源事件数，`transcriptPageBytes` 限制已投影消息的 JSON 字节数，因此仅含内部事件的页面可以为空而游标仍会前进，页面也可能在达到 `limit` 之前结束；超过字节上限的单条消息独占一页。`hasMore` 为真时继续使用 `nextCursor`，并保留最终游标用于后续追加。锚点缺失或改变返回 `cursor_stale`。仅公开原始用户、助手和工具结果消息，排除仅供模型使用的替换、回放状态和工具私有元数据。图片及文件块公开展示元数据。每条消息带有记录它的循环 `turn` 和 `step`，回合首步之前和回合之间为 null。用户消息带有 `source`（`kind` 及该类型的字段），用于区分人工输入和注入的上下文。助手消息带有模型名称、提供方为该次请求报告的 token 计数、请求的 `startedAt`（所在步骤的开始时间）和 `firstTokenAt`；工具结果带有对应工具调用的 `startedAt`；不适用或日志中缺失的字段为 null。每页的 `requests` 列出窗口内记录的请求头：序号、时间、原因、调用选项和模型看到的工具 Schema。不透明游标还携带循环位置和最多四个尚无结果的工具调用，因此这些字段在分页和实时轮询中保持准确；调用 id 长于 128 个字符时没有开始时间。`/runs/{runId}/session-attachments/{sequence}/{index}` 验证可见消息的引用后，通过附件提供者传输字节。Session 尚未持久化时返回 `409 session_unavailable`；可见附件不存在时返回 404。网关卸载和客户端提前断开会中止下载并等待读取句柄关闭；响应成功写完后正常关闭。存储内部可能物化比请求窗口更多的数据。


`GET /runs/{runId}/inputs` 按到达顺序列出人工给 Run 的补充信息和业务等待回复，并给出到达时间及阶段是否已消费；插件派发和等待超时不在其中。`/runs/{runId}/events` 提供独立游标的 Session SSE，不激活 Agent。业务等待、工具审批和模型提问共用交互 API；`GET /interactions` 按创建顺序列出所有执行中等待回复的交互。取消及重启中断的运行时请求会撤销，插件恢复后需要重新请求工具批准。`POST /runs/{runId}/cleanup` 以开始结算时记录的终态重试被阻塞的清理，并返回 202。`/catalog` 提供模型、preset 和权限目录，preset 附带显示名称和说明；配置检查与动态选项获取接收取消信号。

`/runs/{runId}/attachments` 接收认证 multipart `files`，保存不可变 SHA-256 文件及主体范围内的重试回执，Run 处于取消中、清理受阻或终态时，以 `409 run_readonly` 拒绝新上传。下载按执行身份隔离，支持单个字节范围。`attachmentRoot` 必填；文件和请求默认上限分别为 52428800、209715200 字节，`attachmentUploadTimeoutMs` 默认 120000，`attachmentFileLimit` 默认 20。`configCheckTimeoutMs` 默认 60000，插件必须响应取消信号。

`GET /credentials` 列出已安装定义中 `x-dsh-widget: credential` 字段引用的凭据，附带引用它们的定义及不含值的状态。`GET /credentials/{reference}` 只返回是否配置及可写状态；`PUT` 以幂等赋值方式替换共享凭据，不回显值，不使用 Task 命令回执。Cookie 写操作需要 CSRF。`/health` 和 `/ready` 需要认证，`/ready` 仅在启动器与 Task 恢复成功、调度器运行后返回 200，否则返回 503；`/auth/logout` 撤销浏览器会话。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

[Task 子系统](../../../docs/subsystems/task.zh.md), [协议](../task-api-protocol/README.zh.md), [Fetch 客户端](../task-api-client/README.zh.md), [Task 应用](../../bundle/task-app/README.zh.md).

-----

<a id="model-experience"></a>
## 模型体验

通过 Task 命令间接影响模型；业务插件和 Session 适配器负责模型可见内容的投递。

#### KV Cache 影响

没有直接变化；所属 Task Session 保留其会话前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- Session SSE 传输已持久化消息，不包含临时 token 增量。Session 附件下载传输完整对象；任务上传附件的下载还支持单个字节范围。
- 任务历史使用带索引的 SQL 筛选和有界分页。附件列表扫描保留的上传回执；内容文件的保留策略由运维负责。
- 插件检查必须响应取消，任意业务 JSON 不能作为秘密检测机制。

<a id="dev-note"></a>
### 开发备注

无。
