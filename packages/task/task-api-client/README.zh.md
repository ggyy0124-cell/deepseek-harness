---
description: "在不依赖 Cordis 运行时的情况下通过 Fetch 调用 Task JSON 操作。"
kind: "package-library"
---

# @deepseek-ai/dsh-task-api-client

[English](README.md) | 中文

## 概述

使用标准 Fetch 调用已声明的 Task JSON 操作。客户端校验请求和响应，提供 Bearer 或 Cookie 认证并保留结构化错误。命令使用调用方拥有的幂等键；传输失败不会自动重试写操作。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

使用明确的 API 基础 URL、Fetch 实现和认证回调构造 `TaskApiClient`。按[协议目录](../task-api-protocol/README.zh.md)调用 `request(operationId, request)`。每次请求获取当前认证值。浏览器命令附带 CSRF；Bearer 请求不发送 Cookie。重定向会失败，避免凭据随请求转发到其他地址。

`TaskApiError.problem` 携带校验后的服务端诊断和版本冲突。调用方取消信号传递给 Fetch。非法参数、缺失写入标识、非预期响应状态和非协议错误均会拒绝。错误页面不会被复制到异常消息中。

**运行时不变量：** 不发布伴随插件。每个操作直接校验请求和响应；Fetch 测试覆盖认证和失败行为。

使用 `events({ signal, cursor? })` 接收 `ready` 和持久化 Task 事件。首次订阅时，等待 `ready` 后再读取 REST 基线，并在读取期间保留收到的事件。保存最后交付的游标，重连时传回；游标失效时重新订阅并读取基线。未知事件名会被忽略。`eventLimitBytes` 限制收到的完整事件帧，默认 262144，计入 UTF-8 编码及帧分隔字节。中止 signal 可打断正在等待的读取，结束迭代会释放 reader。自动重试和退避由调用应用负责。

使用 `request('getTranscript', { params: { runId }, query: { cursor, limit: '50' } })` 向前分页读取会话；首次读取省略游标。即使 `items` 为空，也保留返回的 `nextCursor`。此接口暴露已存储消息，实时 Session SSE 仍待实现。

<a id="model-experience"></a>
## 模型体验

无，因为本包只校验 HTTP 记录，不构造模型输入。

#### KV Cache 影响

无。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 调用者负责重连策略、上传重试标识和下载 Blob 生命周期。本库不启动 Host。

<a id="dev-note"></a>
### 开发备注

无。
