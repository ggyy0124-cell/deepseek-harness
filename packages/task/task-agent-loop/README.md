---
description: "Task Profile Agent Loop with task-owned command authorization and durable-input wake."
kind: "package-reference"
---

# @deepseek-ai/dsh-task-agent-loop

English | [中文](README.zh.md)

## Summary

Drive Task Agents with the ordinary Agent Loop behavior while enforcing Task authorization around commands, cancellation, and maintenance. A dedicated wake operation starts work only after Task SQLite and the Session inbox have persisted the input.

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

Task Profile mounts this driver in place of `dsh-agent-loop`. Its public configuration matches the shared driver. Task Local calls `wakeTaskAgent(agent)` after it commits a uniquely identified inbox message and the matching model-operation intent.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The package copies the shared Agent Loop implementation and adds Task Session authorization before model-driving commands. Its explicit wake path schedules a turn without inserting another message. A source-parity test permits only the Task authorization and wake additions.


No runtime invariant companion is published; the shared Agent Loop companion owns the copied lifecycle relationships, and source parity rejects Task copy drift.
-----

<a id="further-exploration"></a>
## Further Exploration

[Task Local](../task-local/README.md) owns durable delivery. The [provider-isolation decision](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.md) explains source-copy maintenance.

-----

<a id="model-experience"></a>
## Model Experience

### Task Agent turn

#### What the model sees

The model receives the same logged system prompt, `user/message` entries, tool results, and prior assistant messages as the shared Agent Loop. Task input is already present in the durable inbox when the wake operation starts the turn.

#### Token effect

Authorization and wake add no content. Each admitted Task prompt and response contributes the same tokens as an ordinary Agent turn.

#### KV Cache effect

The loop preserves the shared request-series and cache-prefix behavior for the retained Task Session.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The copied implementation must follow compatible shared Agent Loop changes; the source-parity test rejects unexpected drift.

<a id="dev-note"></a>
### Dev Note

None.
