# Agent Note: 在 Task Web 中显示 dsh-context 插件统计的上下文

Status: implemented

[English](2026-10-21-task-web-context-insight.md) | 中文

## 问题

调优 Task 需要知道模型上下文由什么构成：系统提示词和工具 Schema 占多少、工具结果怎样累积、何时发生了压缩、Agent 读写了哪些文件。DSH Web 用户通过第三方插件 [dsh-context](https://www.npmjs.com/package/dsh-context) 获得这些信息：它的宿主端用 Session 投影单元折叠 Session 日志，浏览器端在 DSH Web 中加上「上下文」标签、侧边栏面板和洞察页。Task Web 是独立的 Vite 应用，没有 Cordis 客户端加载器，也没有浏览器端所依赖的 DSH Web Session、侧边栏和设置服务，因此无法直接安装该插件。插件自己的 HTTP 路由还需要 DSH Web 的 `connection` 服务，而 Task Profile 不包含它。

## 决策

Task 宿主只加载插件的宿主端，按常规方式用 `dsh plugin --profile task add dsh-context` 安装；harness 不内置它，也不新增依赖。它的单元注册在 Task 宿主已有的投影注册表上；由于 `connection` 注入始终不会就绪，插件自己的路由不会出现。它注册的系统提示词前缀和后缀两段默认为空，提示词组装会丢弃空段，因此 Task Agent 的提示词不变。

`GET /runs/{runId}/context`（`getRunContext`）沿用 Run 统计的冷读取和按 Run 的折叠缓存，用已注册的单元折叠 Run 已存储的 Session，并按键原样以 JSON 返回插件的 `contextTimeline` 和 `contextHeaders` 视图。未安装插件时没有 `contextTimeline` 值，路由返回 `404 context_unavailable`。

Task Web 在「轨迹」旁边新增「上下文」视图。它用忽略未知字段的宽松 Schema 校验自己读取的字段，插件新版本增加字段时仍可使用；读取的字段改变形态时明确提示不兼容。卡片由 Task Web 自己的组件绘制：概览、当前上下文、标出压缩和裁剪的逐次请求趋势、上下文事件、文件活动和工具。未安装插件的宿主上显示安装命令。

## 曾考虑的替代方案

**在 Task Web 中加载插件的浏览器端。** 否决：Task Web 没有客户端插件加载器，浏览器端依赖 Task Web 不运行的 DSH Web 服务；为其做替身会把 Task Web 绑到插件内部的集成点上。

**在 Task 网关中重新实现上下文折叠。** 否决：插件的折叠逻辑跟踪大量 harness 事件形态，由上游维护，复制一份会逐渐偏离。读取它的投影值可以复用这些工作，并保持可选。

**把 dsh-context 打包进 Task 应用。** 暂不采用：这会把第三方包固定进 harness 发布版本，并把它的提示词钩子强加给每个 Task 宿主。按 Profile 安装把选择权留给运维人员。

**返回 Session 的全部投影值。** 否决：这样路由会暴露任何已安装插件注册的内容。只读取两个具名键，接口约定更明确。

## 影响

宿主安装 dsh-context 后，Task Web 可以查看任意 Run 的上下文；不安装则其他行为不变。视图读取的是插件的传输格式，插件发布版本若改变视图读取的字段形态，会显示不兼容提示，直到 Task Web 跟进；测试使用 dsh-context 0.74.0 生成的样本。缓存的折叠结果现在也包含插件的状态，比统计的状态更大，仍受同一个 `statsCacheRuns` 上限约束。DSH Web 中的逐次请求内容浏览、跨 Run 洞察和 Agent 网络不在本次范围内。
