---
description: "Task packages for durable plugin-defined business workflows and Session ownership."
kind: "package-group"
---

# task/ — Durable business tasks

English | [中文](README.zh.md)

## Summary

Build business workflows from polling, calendar, and manual tasks. Special tasks dispatch independent ordinary work while preserving its source and preset. This group supplies the service interface, local provider, and model dispatch tool. Business workflows live in external plugins.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [task-api-gateway](task-api-gateway/README.md) | Authenticated REST operations and credential exchange |
| [task-api-protocol](task-api-protocol/README.md) | Public JSON schemas and OpenAPI generation |
| [task-api-client](task-api-client/README.md) | Cordis-free Fetch client |
| [task](task/README.md) | Execution types, plugin stages, service interface, and Session consistency checks |
| [task-session](task-session/README.md) | Task Profile Session mutation authorization |
| [task-agent](task-agent/README.md) | Task Profile Agent creation authorization |
| [task-session-persistence-jsonl](task-session-persistence-jsonl/README.md) | Task Profile JSONL write authorization |
| [task-agent-loop](task-agent-loop/README.md) | Authorized Agent commands and durable inbox wake |
| [task-agent-preset-registry](task-agent-preset-registry/README.md) | Preset registry that retains recorded revisions for task recovery |
| [task-local](task-local/README.md) | SQLite scheduling, recovery, resource admission, and owned Agent Sessions |
| [tool-task-dispatch](tool-task-dispatch/README.md) | Special-task model dispatch |

<a id="related-documentation"></a>
## Related documentation

- [Task subsystem](../../docs/subsystems/task.md) — execution and lifecycle semantics.
- [Task Profile](../bundle/task-app/README.md) — application assembly.
- [Add a Task business plugin](../../docs/cookbook/adding-a-task-plugin.md) — a runnable manual-dispatch example.

<a id="dev-note"></a>
## Dev Note

None.
