---
description: "Task Profile Agent registry with task-owned creation authorization."
kind: "package-reference"
---

# @deepseek-ai/dsh-task-agent

English | [中文](README.zh.md)

## Summary

Provide the ordinary Agent registry inside Task Profile while authorizing Agent creation, resume, and scoped entry against Task ownership. The replacement preserves shared Agent handles and factory interfaces, allowing the Task Agent Loop and existing consumers to use one runtime type system.

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

Task Profile mounts this provider in place of `dsh-agent`. Task Local installs creation guards with `guardCreation()`. Each guard authorizes a proposed Session and Agent relationship before the shared registry creates, resumes, or enters it. Foreground children may be created only within the owning Task model operation; ordinary tasks remain independent runtime roots. `taskAgentRegistry(ctx)` asserts that the profile uses this replacement.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`TaskAgentRegistry` subclasses the shared `AgentRegistry` and delegates accepted operations unchanged. Guard registration is effect-scoped, so removing Task Local removes its policy without leaving process-global state.


No runtime invariant companion is published; guard registration and disposal update one private set through the same service.
-----

<a id="further-exploration"></a>
## Further Exploration

[Task subsystem](../../../docs/subsystems/task.md) describes execution admission. The [provider-isolation decision](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.md) records the replacement architecture.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Task Agent Loop that drives an Agent after this registry authorizes its creation or resume.

#### KV Cache effect

The registry does not alter model messages or request construction.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The registry authorizes supported creation and entry operations; business plugins remain trusted in-process code.

<a id="dev-note"></a>
### Dev Note

None.
