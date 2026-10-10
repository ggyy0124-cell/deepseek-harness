# Task Web 手机原型

[English](README.md) | 中文

本目录保存 [Task Web 客户端](../../apps/task-web/README.zh.md)在手机宽度下的可点击设计原型。它把[桌面原型](../task-web/README.zh.md)扩展到宽度不超过 760 px 的屏幕，客户端以[手机布局](../../apps/task-web/README.zh.md#phone-layout)实现了该原型。

## 内容

[`canvas/`](canvas/canvas.json) 包含 10 个 390 × 844 px 的画板（`*.dc.html`）和 Claude Design 画布布局文件 `canvas.json`。三行画板依次覆盖登录、导航与概览，任务与执行，以及待处理与设置。每行旁的便签列出该行界面体现的布局规则。画板文案为简体中文。

[`generator/build.py`](generator/build.py) 生成 `canvas/`。它导入[桌面生成器](../task-web/generator/build.py)的令牌、图标、控件和示例数据，因此两个原型共用同一组设计取值和同一份数据。

## 重新生成

```sh
python3 design/task-web-mobile/generator/build.py
```

生成结果是确定的；修改生成器时一并提交重新生成的 `canvas/` 文件。

## 查看

每个画板都加载 Claude Design 画布运行时 `support.js`，本仓库不包含该文件。将 `canvas/` 导入 Claude Design 项目即可查看并点击浏览原型；普通浏览器只显示未渲染的模板占位。
