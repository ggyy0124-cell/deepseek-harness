---
description: "dsh-task: durable task configuration, execution, and recovery."
kind: "package-reference"
---

# @deepseek-ai/dsh-task

English | [中文](README.zh.md)

## Summary

Build polling, calendar, and manual business tasks that retain their execution identity across waits and restarts. Special tasks can dispatch independent ordinary tasks with the same preset. Business plugins decide stages, confirmation requirements, and completion; a provider owns durable admission and Session lifetime.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use this interface when business execution must survive the initiating special task. Mount [`dsh-task-local`](../task-local/README.md) to provide `ctx.tasks`; the abstract service is not an executable provider. Each business plugin registers exactly one definition through its own Cordis context.

Only an admitted special stage can dispatch ordinary work. A plugin supplies the business key and compares discoveries; unchanged data leaves existing work alone. Confirmation replies carry both wait identity and input revision, so an outdated approval cannot authorize changed work.

Within either special or ordinary runs, the parent Agent decides whether to use the captured preset's foreground in-process subagent tools. A model turn without delegation creates no child. A delegated child remains inside the same Task execution rather than becoming an ordinary run. After an interrupted model turn, `stage.children` identifies retained child Sessions so the plugin can reconcile uncertain work before selecting another model operation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

Cleanup receives an AbortSignal when its configured deadline expires. The plugin must stop owned work and settle; the engine retains resource locks after an overdue cleanup until a later cancellation successfully cleans them.

<details>
<summary>Implementation details</summary>

The [stage API](src/index.ts) separates model calls, durable external operations, dispatch, and business decisions. The [durable types](src/types.ts) carry configuration snapshots, checkpoints, source relationships, waits, and cleanup state. The [invariant companion](src/invariant.ts) compares task records with independently persisted Session events.

Administrative clients use `command` with a stable authenticated principal and retry key. Matching replays return the original admission snapshot, including after restart or task completion; changed commands conflict. Configuration and enable commands check the definition revision. Cancellation admission returns before cleanup; `cancel` remains the awaited cleanup operation for plugin retirement.

A definition may declare versioned `forms`, deterministic `migrateConfig`, and cancellation-aware `checkConfig`/`options`. Schemas use self-contained Draft 2020-12 and never deliver frontend code. The provider snapshots forms with the execution; model questions and tool approvals use durable revision-bound interactions.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Task package group](../../../packages/task/README.md) explains ownership; [architecture](../../../docs/architecture.md) explains profile composition; the [business-plugin cookbook](../../../docs/cookbook/adding-a-task-plugin.md) shows a runnable registration.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through business plugins and the task Session adapter, which own model instructions and tool use.

#### KV Cache effect

No direct prefix changes; the selected preset and business prompts determine cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The interface does not implement a business workflow or schedule provider. External effects require plugin-specific reconciliation before an uncertain operation can be retried.

<a id="dev-note"></a>
### Dev Note

None.
