---
description: "在不依赖 Cordis 运行时的情况下校验 Task JSON 命令并生成 OpenAPI 描述。"
kind: "package-library"
---

# @deepseek-ai/dsh-task-api-protocol

[English](README.md) | 中文

## 概述

在派发前校验配置更新、绑定版本的回复、资源标识、分页和 UTC 时间。使用同一份路由声明生成 JSON 操作的 OpenAPI 文档。本库导入 Zod，不注册 Cordis 插件。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

从包根导入请求 Schema 或 `createTaskOpenApi()`。解析器拒绝未知请求字段。已提交的 [OpenAPI 文档](openapi.json) 描述 JSON 操作、认证、SSE、附件和健康检查；协议测试检查文档是否与生成结果一致。[Task 子系统](../../../docs/subsystems/task.zh.md) 定义执行语义。

Run DTO 排除私有 checkpoint、初始输入和操作回执。它包含开始结算时记录的 `outcome`、轮询与日历执行的调度时刻 `occurrence`、重来已失败或已取消 Run 时的 `restartedFrom`，以及执行快照中的补充输入 schema。定义通过 `availability` 报告可用状态，并附带调度器给出的 `reason`；交互记录包含所属 Run、工具调用 ID、结构化问题或业务附件。执行查询接受逗号分隔的 `status` 和 `parentRunId`。插件注册必须单独编译并限制业务 JSON Schema。本库校验 API 外层字段，不判断任意业务 JSON 是否包含凭据。

[Task 网关](../task-api-gateway/README.zh.md) 挂载声明的路由并提供生成的文档。Task 和 Session 事件 Schema 校验 SSE 载荷。会话记录 Schema 公开原始消息及其循环位置、用户消息的来源、助手消息的模型、token 用量和计时、工具调用的开始时间，以及每页中记录的请求头，输入列表 Schema 公开人工给 Run 的补充信息和业务等待回复及其到达时间；Session 附件下载区分可见内容缺失（404）和 Session 持久化不可用（409）。

**运行时不变量：** 不发布伴随插件。Schema 与路由声明为静态定义；可执行测试覆盖请求拒绝和文档生成。

<a id="model-experience"></a>
## 模型体验

无，因为本包只校验 HTTP 记录，不构造模型输入。

#### KV Cache 影响

无。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 流式与二进制传输的执行约束由网关负责。导入本库不会安装路由或启动 HTTP 监听器。

<a id="dev-note"></a>
### 开发备注

无。
