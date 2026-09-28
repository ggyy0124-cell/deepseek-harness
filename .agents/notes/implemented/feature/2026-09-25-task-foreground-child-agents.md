# Agent Note: Foreground child Agents inside Task model turns

Status: implemented

English | [中文](2026-09-25-task-foreground-child-agents.zh.md)

## Problem

A Task may need parallel analysis within one business stage, whether its Run is special or ordinary. Task dispatch creates independent ordinary Runs and Sessions, while a parent Agent's subagent tool previously failed Task Profile's Agent-creation guard. That left the business plugin to serialize branches or create unrelated Runs for work that belongs to one stage.

## Decision

Task Profile admits direct, foreground, in-process child Agents only while an owned `stage.model()` operation is active, independent of whether that Run is special or ordinary. The parent Agent chooses whether to call a child; delegation is optional, and a turn without a subagent call creates none. The shipped coding presets expose one-shot `subagent` and `subagent_fork` tools without background mode and with depth one. The Task Local provider reserves each requested child Session identity and its owning Run and model-operation key in SQLite before Agent creation, enforces a configurable per-Run live-child limit, and records creation and disposal in the Task journal. The child remains part of the same Task Run; only an explicit Task dispatch creates an ordinary Run.

The parent model turn waits for its children before confirming its result. Task cancellation propagates to live children and waits for their disposal before cleanup. The child Session remains readable after settlement, while generic write and Agent-control paths cannot reopen it outside its owning model operation. A host restart marks unfinished children interrupted. If their parent model operation has no confirmed result, automatic replay blocks and exposes the child Session identities to the business plugin through `stage.children` for reconciliation. The shipped Task presets disable worker-thread workflow and Ralph tools because their later child-start callbacks do not carry the model operation's foreground authority.

## Alternatives considered

**Dispatch every branch as an ordinary Task.** Rejected for work whose output is needed inside the current stage: it would create separate business executions and Session lifetimes where the parent needs joined analysis results.

**Allow background or continuable subagents.** Rejected because an independently resumed child can outlive the owning model operation, making Task completion, cancellation, preset retention, and recovery ambiguous. A later detached-child design would need its own durable owner and result-delivery rules.

**Replay an interrupted parent turn automatically.** Rejected because a child may have completed external work before the host stopped, even when the parent result was not confirmed. Re-running the turn could duplicate that work.

## Consequences

Parallel model branches return through ordinary subagent tool results and share the Run's status, cancellation, and cleanup. Each branch has an auxiliary Session for inspection, but it does not count as a dispatched ordinary Task. A business plugin must reconcile an interrupted child before it retries or advances the affected model operation. The per-Run limit bounds simultaneous child Agents; existing global and plugin concurrency limits still govern Task Runs rather than each child.
