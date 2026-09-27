# Task Profile scope

Current delivery and acceptance cover the Task engine, scheduling, persistence, plugin interfaces, API gateway and protocol SDK. Business plugin implementations, Task Web UI and native client applications are deferred. Do not add frontend assets, browser launch flows or frontend build requirements without an explicit scope change. Preserve original Base/Web and shared provider sources; use Task-owned replacement providers.

Future frontends consume the shared API. Business plugins define business and configuration logic without frontend components. Follow the [application decision](../../.agents/notes/implemented/architecture/2026-09-13-task-independent-application.md) and [Task application reference](../bundle/task-app/README.md).
