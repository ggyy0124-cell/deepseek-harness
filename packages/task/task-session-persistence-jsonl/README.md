---
description: "Task Profile JSONL Session persistence with task-owned write authorization."
kind: "package-reference"
---

# @deepseek-ai/dsh-task-session-persistence-jsonl

English | [中文](README.zh.md)

## Summary

Persist Task Profile Sessions in the ordinary JSONL format while requiring Task authorization when a writable record is created or opened. The replacement preserves the released Session storage layout and keeps Task lifecycle data in SQLite.

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

Task Profile mounts this provider with the same configuration used by `dsh-session-persistence-jsonl`. It requires `dsh-task-session`; opening a writable Session record calls the Task Session authorization policy before delegating to the shared backend.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`TaskJsonlSessionPersistence` subclasses the shared JSONL provider. Reads retain the ordinary behavior, while record creation and writable open paths call `TaskSessionStore.assertWritable()`. JSONL contains ordinary Session events; the Task SQLite database owns run status and run-to-Session association.


No runtime invariant companion is published; the shared JSONL companion owns storage checks, and this wrapper performs one authorization check before delegation.
-----

<a id="further-exploration"></a>
## Further Exploration

[Task subsystem](../../../docs/subsystems/task.md) describes the two stores. The [provider-isolation decision](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.md) records their responsibilities.

-----

<a id="model-experience"></a>
## Model Experience

None, as this provider changes write authorization without changing persisted model content.

#### KV Cache effect

The persisted message history and request headers are identical to the shared JSONL provider.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- SQLite and JSONL use separate commits; Task Local reconciles durable inbox identities and operation receipts after interruption.

<a id="dev-note"></a>
### Dev Note

None.
