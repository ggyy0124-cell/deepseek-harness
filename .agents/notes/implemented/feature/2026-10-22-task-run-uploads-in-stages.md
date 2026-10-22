# Agent Note: Run uploads reach Task stages through an upload provider

Status: implemented

English | [中文](2026-10-22-task-run-uploads-in-stages.zh.md)

## Problem

Task Web lets a person upload files to a Run, and the Task gateway stores them as immutable blobs with principal-scoped receipts under its own `attachmentRoot`. That directory is separate from the Task database and from the directories a stage owns, and its layout is private to the gateway. A business stage had no capability to read an upload, so a Run's Agent never saw a screenshot or log that a person attached in the supplement box. In the ZenTao bug-fix workflow, people copied such files by hand into the Run's attachment directory.

## Decision

`TaskStage.uploads()` returns the Run's current uploads as `TaskUpload` records (`id`, `name`, `mime`, `size`, `digest`, `createdAt`, `path`), oldest first. `path` names the immutable stored file: a stage may read or copy it and never modifies it.

`TaskService.registerUploadProvider(owner, provider)` attaches the one store that `uploads()` reads, on the owner's lifecycle like `registerNotificationProvider`. The Task gateway registers its attachment store when it starts. A second registration throws, so a misconfigured host fails at start. Without a provider `uploads()` returns an empty list, because nobody could have uploaded.

Uploads are read on demand and are not inputs. An upload does not wake the Run, change its input revision, or enter model context. The plugin chooses when to read, whether to copy a file and where, and records what it did in a durable operation so a replayed stage reuses the earlier result.

## Alternatives considered

**Deliver each upload as a stage input.** Rejected: any input to a running stage bumps the input revision and runs the stage again, so every upload would restart work, and each plugin's `parseInput` would need a file kind.

**Let the gateway copy uploads into a plugin directory.** Rejected: the gateway would need each plugin's directory layout and the engine's resource identities, which puts plugin-specific paths in the harness.

**Let plugins read the gateway's `attachmentRoot`.** Rejected: plugins would depend on the gateway's blob and receipt layout and on a setting they do not own.

**Inject the gateway into the Task provider as an optional service.** Rejected: provider registration avoids reload coupling between the two plugins, matching the notification providers.

## Consequences

A Run that sees uploads needs a business plugin that calls `stage.uploads()`; other plugins keep their behavior. Identical file content shares one stored file, so callers must not modify or delete a returned path. The gateway offers no deletion, so an upload stays available for as long as the operator retains `attachmentRoot`. A stage sees an upload only on its next read after the upload completes.
