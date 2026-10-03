# Agent Note: Task Web 客户端的托管与浏览器会话

Status: implemented

[English](2026-10-03-task-web-client-hosting.md) | 中文

## 问题

[Task Web 原型](../../../../design/task-web/README.zh.md)需要一个随产品发布的客户端，而[能力决策](2026-10-03-task-web-client-capabilities.zh.md)推迟了由 Task 主机提供客户端。客户端必须通过输出的启动链接登录，支持直接打开执行与任务页面的深层链接，并在不增加第二个服务器的前提下满足 Task 网关的源、Host 与 CSRF 检查。

## 决策

客户端是 `apps/task-web` 中的工作区应用 `@deepseek-ai/dsh-task-web-frontend`，基于上游 `ui-primitives` 组件与 `ui-theme` 令牌样式，用 Vite 和 React 构建；它只通过 `dsh-task-api-client` 访问网关。Task 应用入口解析该包的 `dist/` 并占用 WebServer 的兜底路由，因此 `/` 与 API 同源，现有的 `--launch-link` 链接直接打开客户端。首页公开；认证发生在 `/auth/exchange` 与 HttpOnly Cookie 上，而不在资源服务器上。

已有文件直接返回，带指纹的 `assets/` 按不可变缓存，首页带同源内容安全策略与 `no-referrer`。缺失路径只在浏览器导航（`Accept: text/html`）时得到首页，因为 `demo.defects` 这样的任务标识看起来像文件名；脚本和资源请求缺失文件时仍返回 404。客户端在兑换前把 `#launch=` 片段从历史记录中移除，已打开标签页的片段变化也按同样方式处理；CSRF 被拒绝后重新读取一次 `/auth/session`，并用原来的幂等键重试命令。

## 考虑过的替代方案

**复用 `dsh-host-frontend-static`。** 已拒绝：它通过 Web Profile 的 Connection 服务授权首页，而 Task Profile 没有该服务；它也有意对客户端路由返回 404。

**按扩展名路由或使用哈希路由。** 已拒绝：按扩展名判断时带点的标识会得到 404，哈希路由又与 `#launch=` 片段冲突。

**把客户端做成 Web 外壳的 Cordis 客户端插件。** 已拒绝：Task Profile 没有客户端模块运行时，Task 客户端也不需要 Session 聊天界面。

## 影响

`pnpm run build` 在构建库之后构建 `dist/`；缺少 `dist/` 的源码检出对首页返回 404。[网关验收测试](../../../../apps/cli/tests/profiles/task/task-gateway.e2e.ts)检查提供的首页与策略，[浏览器测试](../../../../apps/task-web/tests/task-web.e2e.ts)针对发布的 Profile 执行登录、回复、触发、重试清理、配置、凭据与退出登录。
