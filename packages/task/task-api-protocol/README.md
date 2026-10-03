---
description: "Validate Task JSON commands and generate their OpenAPI description without a Cordis runtime."
kind: "package-library"
---

# @deepseek-ai/dsh-task-api-protocol

English | [中文](README.zh.md)

## Summary

Validate configuration updates, revision-bound replies, resource identifiers, pagination and UTC timestamps before dispatch. Generate the JSON operation OpenAPI document from the same route declarations. This library imports Zod and registers no Cordis plugin.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Import request schemas or `createTaskOpenApi()` from the package root. Parsers reject unknown request fields. The committed [OpenAPI document](openapi.json) describes JSON operations, authentication, SSE, attachments and health checks; the protocol test verifies its freshness. [Task subsystem](../../../docs/subsystems/task.md) owns execution semantics.

The Run DTO excludes private checkpoints, initial input and operation receipts. It carries the `outcome` recorded when settlement begins, the schedule `occurrence` of polling and calendar runs, and the supplemental input schema captured by the run. Definitions report `availability` with the scheduler's `reason`; interactions carry their Run, tool call identity, structured questions or business attachments. Run queries accept comma-separated `status` values and `parentRunId`. Plugin registration must compile and constrain business JSON Schema separately. This library checks the API envelope, not whether arbitrary business JSON contains credentials.

The [Task gateway](../task-api-gateway/README.md) mounts the declared routes and serves the generated document. Task and Session event schemas validate SSE payloads. Transcript schemas expose original messages; Session attachment downloads distinguish missing visible content (404) from unavailable Session persistence (409).

**Runtime invariant:** No companion is published. Schemas and route declarations are immutable; request rejection and document generation are covered by executable tests.

<a id="model-experience"></a>
## Model Experience

None, as this package validates HTTP records without constructing model input.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Streaming and binary transfer enforcement belongs to the gateway. Importing this library does not install routes or start an HTTP listener.

<a id="dev-note"></a>
### Dev Note

None.
