# Task Web prototype

English | [中文](README.zh.md)

This directory holds the clickable design prototype of a Task Web client for the [Task REST gateway](../../packages/task/task-api-gateway/README.md). The [Task Web client](../../apps/task-web/README.md) implements it and the Task profile serves it on the gateway origin; the [capability decision](../../.agents/notes/implemented/architecture/2026-10-03-task-web-client-capabilities.md) records the backend operations the prototype depends on. The [phone prototype](../task-web-mobile/README.md) extends it to screens at most 760 px wide.

## Contents

[`canvas/`](canvas/canvas.json) contains 20 artboards (`*.dc.html`) and the `canvas.json` layout of a Claude Design canvas. Four rows cover access and overview, task definitions, runs, and the inbox, settings and component sheet. The note beside each row lists the API operations its screens use. Artboard copy is Simplified Chinese.

[`generator/`](generator/build.py) contains the Python sources that write `canvas/`. [`data.py`](generator/data.py) holds sample definitions and runs that follow the `/api/task/v1` DTO fields. [`base.py`](generator/base.py) copies color, radius, type and shadow values from the upstream Web client's `ui-theme` tokens and reads icon artwork from `packages/client/ui-primitives` on every build.

## Regenerate and verify

```sh
python3 design/task-web/generator/build.py
python3 design/task-web/generator/verify.py
```

The build is deterministic; commit regenerated `canvas/` files with generator changes. [`verify.py`](generator/verify.py) checks canvas format, such as balanced tags, template holes, board sizes and link targets. It also rejects colors, radii, font sizes, font stacks and neutral border widths that are absent from the upstream tokens. Each gateway operation and public DTO enum value must have visible text on its artboard, and every in-app artboard must be reachable from the overview. Update the generator and its coverage table when Task API operations or DTO values change.

## View

Each artboard loads `support.js`, the Claude Design canvas runtime, which this repository does not ship. Import `canvas/` into a Claude Design project to view and click through the prototype; a plain browser shows unrendered template placeholders.
