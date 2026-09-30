---
description: "保留已记录 preset 版本的 Task Profile Agent preset 注册表。"
kind: "package-reference"
---

# @deepseek-ai/dsh-task-agent-preset-registry

[English](README.md) | 中文

## 概述

与其他 profile 一样，用 `@deepseek-ai/dsh-agent-preset` 行声明 Task preset，并让每次 Task 执行始终使用其启动时的组合。一次执行只记录一次所选 preset 的声明插件列表；等待、重启、保留的子 Agent 与派发的普通任务都会重新挂载这一记录版本，即使声明之后发生了变化。

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

Task Profile 在相同的 `agentPresets` 服务键下挂载此注册表，替代 `dsh-agent-preset-registry`；随附的 Task preset 由 [Task App](../../bundle/task-app/README.zh.md) 组合包声明。Task 代码通过 `taskAgentPresetRegistry(ctx)` 访问 Task API。`captureRevision()` 以 `TaskPresetRevision` 返回可用 preset 的当前声明：entry-list YAML 形式的声明子插件列表、声明行的解析基址以及 SHA-256 摘要。[Task Local](../task-local/README.zh.md) 将该记录存入数据库，读回时用 `parseTaskPresetRevision()` 校验。`mountRevision()` 把尚未发布的 Agent 绑定到已记录的版本，并返回声明的 preset id。

名册、选择、Remote 端点、Session 投影与子 Agent 继承均沿用共享注册表。`defaultId`、`selectedDefault` 与 `default` 字段的行为与其他 profile 相同。

-----

<a id="understand-the-implementation"></a>
## 理解实现

摘要与当前声明一致的版本会加入该声明的运行中插件树。其他版本以保留的 `task-revision:` id，根据已记录的插件列表与解析基址注册一个私有定义；记录了同一版本的 Agent 共享该定义。最后一个挂载它的 Agent 离开时撤回私有定义，继承它的子 Agent 也离开后，由共享注册表释放其插件树。名册读取会省略私有定义，`composedPreset()` 与 `composeFrom()` 报告声明的 preset id，因此子 Session 头记录的是声明的 preset。

挂载时，若版本中的行失败，或在 Host 插件树完成结算后仍在等待服务，则拒绝该版本；失败的私有挂载会在错误抛出前释放。声明行不能使用保留的 id 前缀。

不发布运行时不变量 companion；共享注册表的 companion 负责挂载关系，已记录的版本只决定 Agent 绑定到哪个定义。

-----

<a id="further-exploration"></a>
## 延伸阅读

共享的 [preset 注册表](../../preset/agent-preset-registry/README.zh.md)负责声明与版本；[声明式 preset 决策](../../../.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.zh.md)说明其设计。[Task 合并记录](../../../.agents/notes/implemented/architecture/2026-09-29-task-profile-upstream-0-1-7-merge.zh.md)说明 Task 执行为何在声明之上记录版本。

-----

<a id="model-experience"></a>
## 模型体验

已记录的 preset 插件为每个 Task Agent 提供系统指令与工具，因此此包间接影响模型体验。

#### KV Cache 影响

一次执行保持同一个已记录的组合，因此系统提示与工具前缀在等待、重启与声明修改前后保持稳定。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 版本记录的是声明的插件列表，而非插件代码；恢复要求列表中的每个包仍已安装。

<a id="dev-note"></a>
### 开发备注

None.
