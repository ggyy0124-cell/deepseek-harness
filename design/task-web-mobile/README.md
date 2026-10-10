# Task Web phone prototype

English | [中文](README.zh.md)

This directory holds the clickable phone-width design prototype of the [Task Web client](../../apps/task-web/README.md). It extends the [desktop prototype](../task-web/README.md) to screens at most 760 px wide, and the client implements it as its [phone layout](../../apps/task-web/README.md#phone-layout).

## Contents

[`canvas/`](canvas/canvas.json) contains 10 artboards (`*.dc.html`) of 390 × 844 px and the `canvas.json` layout of a Claude Design canvas. Three rows cover sign-in, navigation and the overview; tasks and runs; and the inbox and settings. The note beside each row lists the layout rules its screens show. Artboard copy is Simplified Chinese.

[`generator/build.py`](generator/build.py) writes `canvas/`. It imports the tokens, icons, controls and sample data of the [desktop generator](../task-web/generator/build.py), so both prototypes share one set of design values and one data set.

## Regenerate

```sh
python3 design/task-web-mobile/generator/build.py
```

The build is deterministic; commit regenerated `canvas/` files with generator changes.

## View

Each artboard loads `support.js`, the Claude Design canvas runtime, which this repository does not ship. Import `canvas/` into a Claude Design project to view and click through the prototype; a plain browser shows unrendered template placeholders.
