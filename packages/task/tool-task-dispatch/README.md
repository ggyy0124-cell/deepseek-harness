---
description: "dsh-tool-task-dispatch: durable task configuration, execution, and recovery."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-task-dispatch

English | [中文](README.zh.md)

## Summary

Let a special-task model delegate business items for independent execution. Repeated discoveries associate with unfinished work according to the business plugin. Ordinary tasks cannot use this tool to create descendants. The special task may finish once dispatch receipts are durable.

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

Mount this consumer alongside the task provider; the `task` profile includes it. The tool is registered only for special-task Agents. `request_id` identifies a retried dispatch, and `input_json` carries business JSON validated by the owning plugin.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

The [tool implementation](src/index.ts) verifies the exact calling Agent and delegates admission to `ctx.tasks.dispatch`. Its registration is owned by both the Agent lifetime and the consumer plugin lifetime. No invariant companion is published: the provider owns execution admission and the Task companion owns Session relationships.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Task package group](../../../packages/task/README.md) explains ownership; [architecture](../../../docs/architecture.md) explains profile composition.

-----

<a id="model-experience"></a>
## Model Experience

### Dispatch tool

#### What the model sees

The [tool schema and descriptions](src/index.ts) expose `task_dispatch(request_id, input_json)`. Results report `created` or `associated`, task and Session identities, and whether the discovery changed existing work. The generic call card uses the persisted arguments.

#### Token effect

Special-task requests include the dispatch schema, call arguments, and receipt. Ordinary-task requests do not receive this schema.

#### KV Cache effect

The schema stays stable within a special Session; each call appends arguments and a result to its conversation.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Business JSON and association policy are plugin-specific; the tool cannot dispatch to another plugin or select a different child preset.

<a id="dev-note"></a>
### Dev Note

None.
