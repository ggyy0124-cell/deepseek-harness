# Task Web 原型

[English](README.md) | 中文

本目录保存面向 [Task REST 网关](../../packages/task/task-api-gateway/README.zh.md) 的 Task Web 客户端可点击设计原型。[Task Web 客户端](../../apps/task-web/README.zh.md) 实现了该原型，Task profile 在网关源上提供该客户端；[能力决策](../../.agents/notes/implemented/architecture/2026-10-03-task-web-client-capabilities.zh.md)记录了原型依赖的后端操作。

## 内容

[`canvas/`](canvas/canvas.json) 包含 20 个画板（`*.dc.html`）和 Claude Design 画布布局文件 `canvas.json`。四行画板依次覆盖接入与概览、任务定义、执行，以及待处理、设置和组件页。每行旁的便签列出该行界面使用的 API 操作。画板文案为简体中文。

[`generator/`](generator/build.py) 包含生成 `canvas/` 的 Python 源码。[`data.py`](generator/data.py) 保存与 `/api/task/v1` DTO 字段一致的示例任务和执行。[`base.py`](generator/base.py) 复制上游 Web 客户端 `ui-theme` 令牌中的颜色、圆角、字号和阴影取值，并在每次生成时从 `packages/client/ui-primitives` 读取图标图形。

## 重新生成与校验

```sh
python3 design/task-web/generator/build.py
python3 design/task-web/generator/verify.py
```

生成结果是确定的；修改生成器时一并提交重新生成的 `canvas/` 文件。[`verify.py`](generator/verify.py) 检查画布格式，例如标签闭合、模板占位、画板尺寸和链接目标。它还拒绝上游令牌之外的颜色、圆角、字号、字体栈和中性边框宽度。每个网关操作和公开 DTO 枚举值都必须在对应画板上有可见文字，每个应用内画板都必须能从概览页到达。Task API 的操作或 DTO 取值变化时，同步更新生成器及其覆盖表。

## 查看

每个画板都加载 Claude Design 画布运行时 `support.js`，本仓库不包含该文件。将 `canvas/` 导入 Claude Design 项目即可查看并点击浏览原型；普通浏览器只显示未渲染的模板占位。
