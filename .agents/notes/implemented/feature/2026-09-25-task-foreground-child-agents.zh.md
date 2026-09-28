# Agent Note: Task 模型轮次中的前台子 Agent

Status: implemented

[English](2026-09-25-task-foreground-child-agents.md) | 中文

## Problem

无论执行是特殊 Run 还是普通 Run，Task 都可能需要在一个业务阶段内并行分析。Task 派发会创建独立的普通 Run 和 Session，而此前 Task Profile 的 Agent 创建守卫会拒绝父 Agent 使用子 Agent 工具。这迫使业务插件串行处理分支，或为本应属于同一阶段的工作创建无关的 Run。

## Decision

Task Profile 仅在受控的 `stage.model()` 操作执行期间允许创建直接的、前台的、进程内子 Agent，与所属 Run 是特殊还是普通无关。父 Agent 自行决定是否调用子 Agent；委派是可选的，没有调用子 Agent 工具的轮次不会创建子 Agent。随附的编码 preset 提供一次性 `subagent` 和 `subagent_fork` 工具，禁用后台模式，并将深度限制为一。Task Local 提供方在创建 Agent 之前，于 SQLite 中预留所请求的子 Session 身份、所属 Run 和模型操作键；它执行可配置的每 Run 在途子 Agent 上限，并把创建和退出写入 Task 日志。子 Agent 属于同一个 Task Run；只有明确的 Task 派发才创建普通 Run。

父模型轮次在确认结果前等待子 Agent 结束。Task 取消会传递给在途子 Agent，并在清理前等待其退出。子 Session 在完成后仍可读取，但通用写入和 Agent 控制路径不能在所属模型操作之外重新打开它。宿主重启会将未完成的子 Agent 标记为已中断。如果父模型操作尚无确认结果，自动重放会阻塞，并通过 `stage.children` 向业务插件提供子 Session 身份以便核对。随附的 Task preset 禁用 Worker 线程版 workflow 与 Ralph 工具，因为后续的子 Agent 创建回调不携带模型操作的前台准入权限。

## Alternatives considered

**将每个分支派发为普通任务。** 对于当前阶段需要其输出的工作，这会创建独立的业务执行和 Session 生命周期，而父阶段实际需要的是汇合后的分析结果，因此未采用。

**允许后台或可继续的子 Agent。** 独立恢复的子 Agent 可能超过所属模型操作的生命周期，使 Task 完成、取消、preset 保留和恢复语义不明确，因此未采用。未来若支持脱离父轮次的子 Agent，需要单独定义持久所有权和结果投递规则。

**自动重放中断的父轮次。** 宿主停止前，子 Agent 可能已经完成外部操作，即使父轮次的结果尚未确认。重放可能重复该操作，因此未采用。

## Consequences

并行模型分支通过普通子 Agent 工具结果返回，并共用 Run 的状态、取消和清理。每个分支都有可供检查的辅助 Session，但不算派发出的普通任务。业务插件在重试或推进受影响模型操作前必须核对中断的子 Agent。每 Run 上限限制同时运行的子 Agent；现有全局和插件并发上限仍控制 Task Run，而不是逐个子 Agent。
