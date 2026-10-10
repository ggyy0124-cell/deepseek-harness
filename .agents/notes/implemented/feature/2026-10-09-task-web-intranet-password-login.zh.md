# Agent Note: Task Web 以固定账号密码供内网访问

Status: implemented

[English](2026-10-09-task-web-intranet-password-login.md) | 中文

## 问题

Task 宿主原来只在 `127.0.0.1` 上提供 Task Web 和网关，浏览器只能通过 `dsh --profile task --launch-link` 登录，该凭据有效期 60 秒，必须从宿主上的 shell 带到每个浏览器。在一台内网机器上运行 Task 宿主、供其他机器上的同事使用时，这些机器没有可以打开的地址，每个新浏览器也都需要宿主的 shell 访问权。

支持的部署是一台内网机器，由其他内网机器通过固定地址以明文 HTTP 访问，使用一个共享账号和密码，不经过反向代理。[客户端托管决策](../architecture/2026-10-03-task-web-client-hosting.zh.md)把认证放在网关，因此改动位于 Task 启动参数、网关和 Task Web 客户端。

## 决策

三项新增都需要显式开启。不使用时，宿主监听回环地址，网关只接受当前来源，Task Web 只提供登录链接。

### 监听地址与可信主机

`task-startup` 接受 `--host 127.0.0.1`（默认）或 `--host 0.0.0.0`，即 `dsh-host-webserver` 支持的两个值，并接受可重复的 `--trusted-host <authority>`。`--host 0.0.0.0` 而没有可信主机时，在解析参数阶段退出，因为其他机器上的浏览器无法通过 Host 检查。随附的补丁把这些参数传入网关的 `trustedHosts`；对绕过这些参数的组合，网关在加载时拒绝同样的错误配置。

`trustedHosts` 列出在 `publicOrigin` 或回环来源之外接受的 authority（`host` 或 `host:port`；只写主机时取服务端口），协议取 `publicOrigin` 的协议或 `http`。`browserOrigins()` 返回这些来源；每个请求按 Host 匹配 authority 相同的来源，由该来源决定 Origin 检查、请求 URL 解析和 Cookie 的 `Secure` 属性。匹配是精确匹配，转发请求头不改变任何判断。启动时为每个可信主机输出一个 Web 地址。`--launch-link` 仍输出回环地址（或 `publicOrigin`）的 URL，不会输出 `0.0.0.0`。

### 密码登录

`passwordLogin.enabled` 增加 `POST /auth/login`，接受 `{ "username", "password" }` 和精确的可信 Origin。成功后打开与 `/auth/exchange` 相同的 HttpOnly、SameSite Strict Cookie 和 CSRF 会话，使用同一存储和同一 `sessionTtlMs`（30 天）。密码是 `passwordLogin.passwordRef` 凭据（默认 `TASK_WEB_PASSWORD`）的值，每次尝试时读取，并以常数时间比较摘要，因此修改密码后下一次登录即生效，无需重启。`PUT /credentials/{reference}` 以 `403 credential_reserved` 拒绝该引用；只有 `dsh --profile task --password-set` 能设置它，在终端中不回显地读取两次密码，或从管道输入读取一次。

失败次数在内存中按客户端地址和用户名分别计数。在 `failureWindowMs`（15 分钟）内达到 `maxFailures`（5）的那次尝试会把该地址或用户名锁定 `lockoutMs`（15 分钟），锁定期间的尝试返回 `429 login_throttled` 和 `Retry-After`。密码凭据未配置时所有登录以 401 失败，并记录 `password_unconfigured`。登录诊断记录结果和客户端地址，不记录提交的值。`passwordLogin.username` 默认为空，开启登录时必填。

无需认证的 `GET /auth/methods` 报告 `{ "password": boolean }`。Task Web 在没有会话时读取它，并显示用户名和密码表单；登录链接命令收在折叠的管理员入口下，用于忘记密码、凭据未配置或被锁定的情况。

### 配置

| 归属 | 字段 | 默认值 |
|---|---|---|
| `task-startup` 参数 | `--host` / `--trusted-host` | `127.0.0.1` / 无 |
| `task-startup` 参数 | `--password-set` | 管理命令 |
| 网关 | `trustedHosts` | `[]` |
| 网关 | `passwordLogin.enabled` / `username` / `passwordRef` | `false` / `''` / `TASK_WEB_PASSWORD` |
| 网关 | `passwordLogin.maxFailures` / `failureWindowMs` / `lockoutMs` | `5` / `900000` / `900000` |
| 管理行 | `passwordRef` | `TASK_WEB_PASSWORD`；须与网关的 `passwordLogin.passwordRef` 一致 |

Profile 补丁会替换一行的全部配置，因此开启密码登录的补丁需要重写 `attachmentRoot` 和 `trustedHosts: !!js ctx.taskStartup.trustedHosts`，见 [Task 应用 README](../../../../packages/bundle/task-app/README.zh.md#intranet-access)。

## 考虑过的替代方案

**去掉登录链接。** 否决：签发登录链接需要宿主上的 shell 和 `DSH_HOME` 的读取权限，不增加网络暴露；它也是忘记密码、凭据缺失或被锁定时唯一的恢复途径。去掉它还要重写管理命令、网关和浏览器验收测试，没有安全收益。

**在回环 Task 宿主前放置带 TLS 或单点登录的反向代理。** 本次部署不采用：它增加一个需要安装和维护的组件，而本次部署接受内网明文 HTTP。两者仍然兼容：`publicOrigin` 加 `trustedHosts` 无需改代码即可表达代理后的来源。

**按客户端地址放行、不要密码。** 否决：已登录的浏览器可以以 `danger-full-access` preset 触发执行，并替换禅道、Gerrit 和模型凭据，网络上的每台机器都将获得在宿主上执行代码的能力。

**由代理注入设备 Bearer 凭据。** 否决：`/auth/session` 拒绝 Bearer 调用方，Task Web 无法启动；而且注入的凭据作用于经过代理的每个请求，防跨站伪造只剩 Origin 检查。

**为密码登录单独设置更短的会话时长。** 部署负责人否决，选择沿用现有的 30 天 `sessionTtlMs`；日常使用的便利优先于缩短截获 Cookie 的可用时长。

**为每个人单独设账号密码。** 延后：一个共享账号满足本次部署；多用户需要用户管理、每个会话一个主体，以及补充输入和回复的操作人记录。会话存储记录一个主体，以后增加用户不需要改变 Cookie 格式。

**在 `dsh-host-webserver` 中内置 TLS。** 延后：本次部署接受明文 HTTP，证书配置和续期会改动所有 Profile 共用的 WebServer 包。

## 后果

内网浏览器通过固定地址打开宿主，用一个账号登录；除了设置密码或用登录链接恢复，不再需要宿主上的 shell。

已登录的浏览器可以以 `danger-full-access` preset 在宿主上执行代码。密码、把端口限制在内网网段的主机防火墙和专用系统账号是屏障。使用明文 HTTP 时，能抓取内网流量的人可以读到密码和有效期 30 天、不带 `Secure` 属性的会话 Cookie。所有用户共用一个主体，补充输入、回复和配置修改无法对应到具体的人。重启宿主会清除失败计数和锁定；按用户名的锁定在到期前也会挡住真正的用户。

上游 DSH 出于安全考虑拒绝 Web Profile 使用 `0.0.0.0`；`task-startup` 和网关偏离了这一立场，同步上游时涉及这些文件的改动需要手工合并。

网关单元测试覆盖可信主机匹配、协议继承、密码登录、限速、保留凭据和加载时的错误配置；`task-intranet-login.e2e.ts` 通过发布的 Profile 覆盖 `--password-set`、参数校验和经可信主机登录；`password-login.e2e.ts` 在浏览器中操作 Task Web 表单。
