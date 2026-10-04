# `@deepseek-ai/dsh-task-web-frontend`

[English](README.md) | 中文

Task Web 客户端是 Task Profile 的浏览器控制台。它实现 [Task Web 原型](../../design/task-web/README.zh.md)，通过 [Task REST 网关](../../packages/task/task-api-gateway/README.zh.md) 访问数据，并由 Task 主机在网关源上提供，因此 `dsh --profile task` 同时提供 `/` 和 `/api/task/v1/`。

## 使用客户端

用 `dsh --profile task` 启动主机，再在另一个终端用 `dsh --profile task --launch-link` 输出登录链接。打开输出的 `http://127.0.0.1:3081/#launch=…` 链接后，客户端在 `/auth/exchange` 兑换其中的一次性密钥，从地址栏移除密钥，并保留 HttpOnly Cookie 会话；每次写操作都携带会话的 CSRF 密钥。已经打开客户端的标签页也接受新粘贴的链接。没有会话时页面显示登录命令；已使用或已过期的链接、已结束的会话、无法访问的主机和正在恢复的调度器各有对应状态。

| 页面 | 路径 | 操作 |
|---|---|---|
| 概览 | `/` | 待关注计数、最近执行、即将触发和执行名额 |
| 任务 | `/definitions` | 启用或暂停任务；触发手动任务 |
| 任务配置 | `/definitions/{id}` | 调度、执行和业务配置（生成的表单或 JSON）、插件检查、动态选项、修订冲突、执行记录和退役 |
| 执行记录 | `/runs` | 按状态、类型、任务、业务键和创建时间筛选，游标分页 |
| 执行详情 | `/runs/{id}` | 实时会话、回复、结果文档、附件、关联执行、取消、重试清理和补充输入 |
| 待处理 | `/inbox` | 所有执行中的业务确认、工具审批和 Agent 提问 |
| 诊断 | `/diagnostics` | 运行计数、存储、资源、退役和实时事件 |

设置包括语言（简体中文或英文）、浅色、深色或跟随系统的外观、本机时区或 UTC 时间显示、连接信息与退出登录、只写凭据、设备令牌命令和版本信息。偏好保存在浏览器的本地存储中。

业务插件不提供前端代码。表单来自插件的 JSON Schema：`x-dsh-widget: textarea` 显示多行字段，`credential` 保存凭据引用并链接到凭据编辑，`options` 通过 `POST …/config/options` 向插件请求选项。业务等待按回复 Schema 选择控件：封闭选项、带补充说明的选项、布尔值、文本或生成的表单。

## 构建与测试

```sh
pnpm run build:task-web
pnpm exec vitest run apps/task-web/tests
pnpm exec vitest run --config vitest.web.config.ts apps/task-web/tests/task-web.e2e.ts
```

`build:task-web` 写出 Task 应用提供的 `dist/`；`pnpm run build` 包含这一步。客户端使用 `dsh-task-api-client`、`dsh-task-api-protocol` 和 `dsh-client-ui-primitives` 的构建产物 `lib/`，以及 `dsh-client-ui-theme` 的 `--dsw-*` 令牌样式。单元测试覆盖 Cron 预览、格式化、配置合并、Schema 表单和会话状态机。浏览器测试需要构建好的客户端；它用 [示例业务插件](tests/fixtures/demo-business.mjs) 启动 Task Profile，通过启动链接登录，并执行待处理回复、手动触发、重试清理、配置编辑、凭据和退出登录。缺少 Playwright 固定版本的浏览器时，`DSH_PLAYWRIGHT_EXECUTABLE_PATH` 选择本机 Chromium。

需要带示例数据的本地预览时，在 `--patch` 文件中加入示例插件的行；其 `definition` 设置选择 `defects`、`weekly`、`review`、`cleanup` 或 `agent`。`pnpm --filter @deepseek-ai/dsh-task-web-frontend exec vite` 在 5180 端口提供热更新的客户端，并把 `/api/task/v1` 代理到 `DSH_TASK_WEB_GATEWAY`（默认 `http://127.0.0.1:3081`）；代理以网关自身的源发出请求，因此把输出的启动链接端口改为 5180 后打开即可。
