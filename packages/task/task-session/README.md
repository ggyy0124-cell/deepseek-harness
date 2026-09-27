---
description: "Task Profile Session provider with task-owned mutation authorization."
kind: "package-reference"
---

# @deepseek-ai/dsh-task-session

English | [中文](README.zh.md)

## Summary

Provide the ordinary Session API inside Task Profile while requiring Task-owned authorization for Session creation, preparation, entry, forking, and writes. The store keeps the shared Session types and event behavior, so other Task providers can reuse the existing Agent and persistence interfaces without changing the shared package.

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

Task Profile mounts this provider in place of `dsh-session`. Task Local installs scoped mutation guards with `guardMutations()`; each guard identifies owned Session IDs and authorizes the requested operation. Code that requires the replacement uses `taskSessionStore(ctx)` and fails if another provider is mounted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`TaskSessionStore` subclasses the shared `SessionStore`, preserving Session identity and behavior. Creation and mutation methods evaluate active guards before delegating to the shared implementation. Guards are Cordis effects and disappear with their owning plugin scope.


No runtime invariant companion is published; guard registration and disposal update one private set through the same service.
-----

<a id="further-exploration"></a>
## Further Exploration

[Task subsystem](../../../docs/subsystems/task.md) defines Task ownership and lifecycle. The [provider-isolation decision](../../../.agents/notes/implemented/architecture/2026-09-11-task-profile-provider-isolation.md) explains why Task Profile replaces this provider.

-----

<a id="model-experience"></a>
## Model Experience

None, as this provider only authorizes Session lifecycle operations and delegates model history to Session consumers.

#### KV Cache effect

The provider does not alter messages, request headers, or cache prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Authorization covers supported provider entry points; a trusted in-process plugin that already holds a Session object can still call its methods directly.

<a id="dev-note"></a>
### Dev Note

None.
