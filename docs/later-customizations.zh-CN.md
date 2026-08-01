# Later 自研功能与配置清单

## 目的

这份文档回答 3 个问题：这个分支相对主仓增加了什么、每项能力依赖什么配置、以后改动时哪些行为不能丢。当前状态和上游基线见 [`PROJECT_STATE.md`](../PROJECT_STATE.md)。

## 功能总览

| 能力 | 用户价值 | 主要入口 | 最小验证 |
|---|---|---|---|
| 手机与 Mac 共用后端 | 两端看到同一 Session 和同一运行状态 | `deploy/`、`scripts/install-mobile-relay.sh` | `scripts/verify-mobile-relay.sh` |
| 可安装 PWA | iOS/Android 主屏启动、版本更新、离线提示 | `app/manifest.ts`、`components/PwaRegistration.tsx`、`public/sw.js` | manifest/SW 可访问，API 不进入 Cache Storage |
| 应用内登录 | PWA 不依赖不稳定的浏览器 Basic Auth 弹窗 | `proxy.ts`、`lib/web-auth.ts`、`app/login/` | `lib/web-auth.test.mjs` |
| 多账号 Cookie | 一个账号改密不误伤其他账号，支持短期/30 天登录 | `app/api/auth/session/route.ts` | 篡改、过期、改密、跳转测试 |
| Agent 完成推送 | 手机锁屏或后台时收到完成通知 | `lib/push-notifications.ts`、`app/api/push/route.ts` | `lib/push-notifications.test.mjs` + 真机测试 |
| 移动端工作区 | 390×844 等小屏可切项目、Session 和文件 | `MobileWorkspaceHeader.tsx`、`AppShell.tsx`、`app/globals.css` | `scripts/verify-mobile-ui.mjs` + 真机 |
| iOS 键盘/安全区修正 | 输入框不被键盘、刘海或 Home Indicator 挤偏 | `hooks/useVisualViewport.ts`、`lib/mobile-viewport.ts` | viewport 单测 + iOS PWA 聚焦/收键盘 |
| Extension 管理 | 全局启停扩展，并可在 Session 创建前决定加载范围 | `ExtensionsConfig.tsx`、`lib/extensions-service.ts` | 开关后核对资源加载与 Session 配置 |
| Provider Request 查看 | 把终端中的密集 JSON 变成可搜索、可放大的结构化视图 | `ProviderRequests.tsx`、`app/api/provider-requests/route.ts` | 小窗、全屏、长 JSON、错误响应 |
| 运行状态恢复 | 后台、断网或漏 SSE 后不会永久显示“运行中” | `hooks/useAgentSession.ts`、`lib/rpc-manager.ts` | SSE/reconciliation 测试 |
| 运维脚本 | 安装、启动、停止、日志和全链路检查可重复执行 | `scripts/manage-pi-web.sh`、`scripts/verify-mobile-relay.sh` | `status` 与健康检查均为 0 |
| 同终端多设备切换 | 在一个 origin、一个登录和一个 PWA 内原位切换执行设备；手机端 2 次点击直达目标设备，不整页刷新，同时保留设备本地 Session 边界和工作区记忆 | `MobileDeviceSwitcher.tsx`、`DeviceWorkspaceRoot.tsx`、`useDeviceWorkspace.ts`、`lib/device-workspace.ts`、`GET/POST /api/devices*` | 交互/状态机/回滚/快照测试 + 双向生产视口验收 |

## 配置矩阵

### 核心运行配置

| 变量 | 必需条件 | 作用 | 安全规则 |
|---|---|---|---|
| `PI_CODING_AGENT_DIR` | 使用非默认 Pi 目录时 | 指向包含 Sessions、模型和 Push 状态的 agent 目录 | 目录只能让运行用户访问 |
| `PI_WEB_DIST_DIR` | production 推荐 | 把 production 输出隔离到 `.next-mobile` | 开发期间不要让 build 写 `.next/` |
| `PI_WEB_HOSTNAME` | 自定义监听地址时 | 明确 Next.js 监听主机 | 公网部署仍建议仅监听 loopback，由代理暴露 |
| `PI_WEB_ALLOWED_HOSTS` | 外部域名与监听主机不同 | 允许精确的代理 Host，逗号分隔 | 不支持通配放开整个互联网 |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | 模型或上游 API 需代理时 | 服务端 fetch 代理 | loopback 和内部服务写入 `NO_PROXY` |
| `PI_WEB_DEVICE_ID` | 多设备时推荐 | 当前设备稳定小写 slug，例如 `linux-home` | 不放 IP、用户名或秘密 |
| `PI_WEB_DEVICE_NAME` | 多设备时推荐 | 手机/桌面显示名 | 最长 80 字符，不允许控制字符 |
| `PI_WEB_PUBLIC_URL` | 多设备时推荐 | 当前设备根 URL | 仅 `http(s)` origin，不带 path/query/credentials |
| `PI_WEB_DEVICE_GATEWAY_URL` | 同 origin 网关时 | 手机唯一入口；仅当请求 origin 与它相同时启用 gateway 模式 | 网关成员必须配置相同值 |
| `PI_WEB_DEVICES_FILE` | 配置 2 台以上时 | 非敏感 version 1 JSON 目录绝对路径 | 最大 64 KiB、最多 32 台；本地实际文件可忽略 |

### 应用登录配置

| 变量 | 推荐值/格式 | 说明 |
|---|---|---|
| `PI_WEB_AUTH_REQUIRED` | 公网为 `1` | 配置不完整时 fail closed；本地无认证变量时可关闭认证 |
| `PI_WEB_AUTH_CREDENTIALS_FILE` | 绝对路径、权限 `600` | `{"credentials":[{"username":"…","password":"…"}]}`；推荐多账号方式 |
| `PI_WEB_AUTH_SESSION_SECRET_FILE` | 独立随机文件、权限 `600` | Cookie 签名密钥；不能与登录密码共用 |
| `PI_WEB_AUTH_SESSION_DAYS` | 默认值或明确整数 | 持久登录有效天数 |
| `PI_WEB_AUTH_USERNAME` + `PI_WEB_AUTH_PASSWORD_FILE` | 仅旧部署兼容 | 单账号旧方式；不得与 credentials file 同时启用 |
| `PI_WEB_PASSWORD` | 仅简单非 PWA 部署 | 上游兼容的单密码 Basic Auth；不得与任何 `PI_WEB_AUTH_*` 同时启用 |

规则：Mac、Pop!_OS 与公网 installed PWA 使用 `PI_WEB_AUTH_*` 应用登录，不配置 `PI_WEB_PASSWORD`。账号文件、签名密钥、Provider Token、OAuth 凭据、`.env*` 和 `deploy/secrets/` 永不提交。密码轮换会使对应账号旧 Cookie 失效，这是预期行为。

### Web Push

| 项目 | 位置/配置 | 说明 |
|---|---|---|
| VAPID 与订阅存储 | `${PI_CODING_AGENT_DIR:-~/.pi/agent}/pi-web-push.json` | 首次使用生成；权限受限；应随 agent 目录备份 |
| `PI_WEB_PUSH_SUBJECT` | `mailto:admin@example.com` 等合法 subject | 可选；用于 VAPID 联系标识 |
| 浏览器条件 | HTTPS、已安装/支持 SW、用户主动授权 | iOS 必须从主屏 PWA 内授权通知 |
| 发送范围 | 当前登录账号的订阅 | 不是跨账号广播，不实现 RBAC 数据隔离 |

Push 内容只使用有界预览和 Session 深链，不发送完整对话。HTTP 404/410 的失效订阅会自动清理。

## 关键不变量

1. 选择某台设备后，同一页面生命周期内的 HTML、API、SSE 和静态资源必须到达该设备的同一个 Next.js 进程；复制 Session 文件不等于实时同步。
2. 浏览历史 Session 不应创建 `AgentSession`；只有发送命令才启动运行时。
3. Service Worker 不能缓存 `/api/*`、登录响应、Session HTML 或 SSE；只缓存版本化静态资源与离线提示。
4. 公网认证使用 Pi Web 登录 Cookie；Nginx 不再启用 `auth_basic`。
5. `AgentSession.fork()` 后必须立即销毁旧 registry wrapper，避免 parentSession 链损坏。
6. 同一个 Session 文件不能同时由原生 Pi CLI 和 Pi Web 写入。
7. 开发使用 `.next/`，production 使用 `.next-mobile/`；开发中禁止运行普通 `next build`。
8. 移动端高度在键盘关闭时由 CSS 控制，只有可编辑控件聚焦且确认为软键盘时才采用 Visual Viewport。
9. 同 origin 网关只切换后端路由，不迁移运行中的 Agent；`pi_web_device` 只能由受保护 API 写入，Nginx 只接受已知 id。控制面在兼容成员间故障转移，执行面绝不因设备离线静默换机。
10. 同一网关内的设备共享应用账号和 Cookie 签名密钥，但 Session、Provider/OAuth、项目文件、Push store 与 Agent 进程仍留在各设备。
11. gateway 模式切换不得调用 `window.location.reload/assign`；旧工作区必须先 unmount 完成连接清理，再修改路由 Cookie。目标探针失败要回滚原设备，切换成功只替换带 epoch key 的 React 工作区。
12. 所选设备离线时 `/api/devices` 仍须可读，health 返回结构化 `device_offline`；UI 不挂载离线工作区，必须显示离线状态、重新检查和显式切换入口。全部成员离线时云端仍返回本地恢复页，不能透传 Cloudflare 通用 502。
12. 每台设备的最后 Session/cwd、文件页签和右侧面板只存于当前浏览器的有界 `sessionStorage` 快照；解析时必须丢弃损坏或越界数据，不能把设备状态混写到另一台设备。
13. 手机设备入口属于一级导航：主界面点设备胶囊、设备面板点目标机器共 2 次点击。不得重新塞回“更多”菜单或叠加第二层下拉；切换提交前必须显示目标行忙碌状态，当前设备不可重复选择。
14. `PI_WEB_PASSWORD` Basic Auth 与 `PI_WEB_AUTH_*` 应用登录互斥；两者同时存在必须 fail closed。公网 installed PWA 始终选择应用登录，避免原生认证框与 API/SSE 恢复冲突。

## 文档导航

- Mac + 手机现有环境：[Pi Web 启动与手机服务器操作手册](./pi-web-service.zh-CN.md)
- 通用 Linux 新部署：[Linux 部署手册](./linux-deployment.zh-CN.md)
- 上游同步、提交和案例库：[维护与故障案例手册](./maintenance-playbook.zh-CN.md)
- Pi Web/Pi 两条发布线：[上游版本审计](./upstream-version-audit.zh-CN.md)
- PWA 安装：[PWA 指南](./PWA.md)
- Session/模型使用：[Pi Agent 手册](./pi-agent-model-usage.zh-CN.md) 与 [Codex 手册](./codex-session-model-usage.zh-CN.md)
- 多设备：[多设备接入架构 ADR](./multi-device-architecture.zh-CN.md)
- 跨设备主机访问与配置：[多设备控制手册](./device-access.zh-CN.md) 与 [设备新增/下线/密钥轮换](./device-onboarding.zh-CN.md)
- 手机交互待审核方案：[移动端 UX 审计](./mobile-ux-audit-2026-07-30.zh-CN.md)
