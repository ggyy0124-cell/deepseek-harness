---
description: "用于持久插件业务流程及 Session 归属管理的任务包组。"
kind: "package-group"
---

# task/ — 持久业务任务

[English](README.md) | 中文

## 概述

使用轮询、日历调度和手动任务构建业务流程。特殊任务派发独立普通任务，同时保留来源和 preset。此包组提供服务接口、本地提供方及模型派发工具。业务流程位于外部插件中。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| Package | Role |
|---|---|
| [task-api-gateway](task-api-gateway/README.zh.md) | 经过认证的 REST 操作和凭据交换 |
| [task-api-protocol](task-api-protocol/README.zh.md) | 公共 JSON Schema 与 OpenAPI 生成 |
| [task-api-client](task-api-client/README.zh.md) | 无 Cordis 运行时的 Fetch 客户端 |
| [task](task/README.zh.md) | 执行类型、插件阶段、服务接口与 Session 一致性检查 |
| [task-session](task-session/README.zh.md) | Task Profile Session 修改授权 |
| [task-agent](task-agent/README.zh.md) | Task Profile Agent 创建授权 |
| [task-session-persistence-jsonl](task-session-persistence-jsonl/README.zh.md) | Task Profile JSONL 写入授权 |
| [task-agent-loop](task-agent-loop/README.zh.md) | 受权 Agent 命令与持久收件箱唤醒 |
| [task-agent-preset-registry](task-agent-preset-registry/README.zh.md) | 为任务恢复保留已记录版本的 preset 注册表 |
| [task-local](task-local/README.zh.md) | SQLite 调度、恢复、资源准入与任务所属 Agent Session |
| [tool-task-dispatch](tool-task-dispatch/README.zh.md) | 特殊任务模型派发 |

<a id="related-documentation"></a>
## 相关文档

- [Task 子系统](../../docs/subsystems/task.zh.md) — 执行与生命周期语义。
- [Task Profile](../bundle/task-app/README.zh.md) — 应用组合。
- [添加 Task 业务插件](../../docs/cookbook/adding-a-task-plugin.zh.md) — 可运行的手动派发示例。

<a id="dev-note"></a>
## 开发备注

None.
