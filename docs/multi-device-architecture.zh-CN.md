# Pi Web 多设备接入架构 ADR

> 状态：同源粘性网关与离线故障转移已部署（2026-08-01）
>
> 原则：手机只感知一个用户、一个 URL、一个登录和一个 Pi Web；设备是当前终端里的执行位置，不是另一套管理界面。

## 1. 问题定义

用户在一台手机上需要访问多台运行 Pi Web 的设备，例如当前 Mac、家中 Linux 主机和未来其他工作站。每台设备拥有自己的：

- `~/.pi/agent`、Session 和运行中的 `AgentSession`；
- 项目目录、Git worktree 和本机文件权限；
- Provider/OAuth/API Key；
- production 进程和出站隧道。

“多设备”不等于复制 Session，也不等于把多个 `AgentSession` 塞进同一个 Next.js 进程。正确边界是：**手机选择一个设备，后续页面、API、SSE 和文件访问在同一逻辑请求期间稳定到达该设备。**

## 2. 目标与非目标

### 当前目标

1. 每台 Pi Web 有稳定的 `deviceId`、显示名和内部可路由 URL。
2. 通过一个非敏感 JSON 目录配置多台设备。
3. UI 在同一个 origin 内显示并切换执行设备，用户不离开当前 PWA/界面，也不再次登录。
4. 配置错误只关闭多设备入口，不影响当前设备的 Session/Chat。
5. 核心解析、文件加载、UI 和 API 分层，具备独立测试。
6. 设备数据 API、SSE 和文件请求在一个工作区 epoch 内粘性到同一设备；页面壳、静态资源、认证和选择控制面在兼容设备间故障转移。
7. gateway 模式在同一 document 内替换 React 工作区，不以整页刷新伪装成“统一界面”。

### 当前不做

- 不集中同步 Session 或项目文件；
- 不自动复制 Provider 密钥；
- 不探测所有远端设备健康，不引入 N×M 轮询；
- 不在这一阶段实现中央 Push broker、动态设备注册或完整 RBAC。

## 3. 官方约束与调研结论

### 3.1 不采用 `/devices/<id>` 直接挂多份 Pi Web

Next.js 的 `basePath` 必须在构建时确定并内联到客户端 bundle，不能在运行时按设备切换。Pi Web 还有大量根路径 API、Service Worker、manifest 和资源 URL，因此用路径前缀代理会制造持续的路径重写和重复构建负担。[Next.js basePath 官方文档](https://nextjs.org/docs/pages/api-reference/config/next-config-js/basePath)

结论：多设备路由不能要求每份 Pi Web 感知动态路径前缀。

### 3.2 子域名直连适合一期，但不是最终统一 PWA

Service Worker registration 与 scope 绑定同一 origin；规范还建议需要安全隔离的站点使用不同 origin。PushSubscription 也关联具体的 Service Worker registration。不同设备子域名因此会形成独立 SW/Push 状态。[W3C Service Workers](https://w3c.github.io/ServiceWorker/v1/)、[W3C Push API](https://w3c.github.io/push-api/index.html)

Web App Manifest 规范要求应用导航超出 scope 时向用户暴露实际 URL/origin，因此从已安装 PWA 跳到另一个设备子域名可能出现浏览器 UI或离开独立窗口体验。[W3C Web App Manifest](https://w3c.github.io/manifest/)

Cookie 未设置 `Domain` 时是 host-only；设置父域 `Domain` 才会发送给子域，但共享认证 Cookie 会扩大任一子域被攻破后的影响面。[RFC 6265](https://datatracker.ietf.org/doc/rfc6265/)

结论：设备 URL 直连只保留为部署验收和 break-glass；正常手机交互已改为 single-origin 网关，不能再把跨子域跳转暴露为设备切换。

### 3.3 每台设备采用出站隧道

Cloudflare Tunnel 由设备上的 `cloudflared` 主动建立 outbound-only 连接，不要求设备具有公网可路由 IP；一个 tunnel 可以发布多个 hostname/service 映射，也可为不同设备使用独立 tunnel UUID 以便独立路由和故障隔离。[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)、[Tunnel routing](https://developers.cloudflare.com/tunnel/routing/)

当前 SSH `-R` 仍可用于一期和局域网部署，但 `ExitOnForwardFailure` 只保证 forwarding listener 建立成功，不保证最终目标持续健康；因此必须保留应用层 `/api/health` 和重连检查。[OpenSSH ssh_config](https://man.openbsd.org/OpenBSD-6.8/ssh_config.5)

结论：隧道是可替换的 deployment adapter，不进入 Session/Chat 核心模块。当前 Mac 与 Linux 分别通过受限 SSH reverse tunnel 接入网关；未来可单独替换为 Cloudflare Tunnel。

### 3.4 SSE 需要连接粘性和可恢复性

Nginx 默认启用 proxy buffering，SSE 代理必须关闭 buffering 或正确处理 `X-Accel-Buffering`。[Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)

Cloudflare 文档说明 tunnel connector 停止时长连接会中断；官方排障也指出 `text/event-stream` 会影响 buffering 行为。[Cloudflare tunnel configuration](https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/)、[Cloudflare common errors](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/)

结论：一次 React 工作区生命周期内的设备 API、SSE 与文件请求必须路由到同一设备。切换时先 unmount 旧工作区，让 React effect cleanup 关闭 EventSource/请求，再改变粘性路由；无需 reload 整个 document。旧设备上的 Agent 不被 abort，继续通过 reconciliation/Push 收口。

## 4. 方案比较

| 方案 | 一期速度 | 单 PWA | 认证/Push | 运维复杂度 | 结论 |
|---|---:|---:|---:|---:|---|
| 路径 `/devices/id` | 低 | 是 | 中 | 高 | 拒绝：Next build-time basePath 与根路径 API 冲突 |
| 每设备独立 URL/子域名 | 高 | 否 | 每 origin 独立 | 低 | 仅部署验收/故障回退，不作为正常 UX |
| 单 origin 设备网关 | 中 | 是 | 统一应用登录 | 中 | 已采用并部署 |
| 集中运行所有 AgentSession | 低 | 是 | 可统一 | 极高 | 拒绝：破坏本地文件/权限/Session 边界 |

## 5. 分期架构

### Phase 1：可配置直连目录（已完成的迁移脚手架）

```text
Pi Web UI
  └─ GET /api/devices
       └─ DeviceDirectory（本地配置文件 + 当前设备环境变量）

选择设备
  └─ window.location.assign(device.url)
       └─ 目标设备自己的 Pi Web / 登录 / Session
```

这条直连路径验证了设备身份、目录、UI 和真实 Linux 部署，但跨 origin 的割裂感不符合最终产品要求。代码仍将 direct 模式作为没有网关时的兼容回退，当前生产不走它。

配置只包含非敏感元数据：

```json
{
  "version": 1,
  "devices": [
    { "id": "mac-main", "name": "Main Mac", "url": "https://mac.example.com" },
    { "id": "linux-home", "name": "Home Linux", "url": "https://linux.example.com" }
  ]
}
```

当前设备使用独立环境变量覆盖目录项：

```dotenv
PI_WEB_DEVICE_ID=mac-main
PI_WEB_DEVICE_NAME=Main Mac
PI_WEB_PUBLIC_URL=https://mac.example.com
PI_WEB_DEVICES_FILE=/absolute/path/devices.json
```

### Phase 2 核心：单 origin 粘性设备网关（已部署）

```text
手机 installed PWA（https://pi.example.com）
       │  pi_web_device=mac-main | linux-home
       ▼
Nginx 白名单粘性路由
       ├─ mac-main   ─▶ tunnel A ─▶ Mac Pi Web
       └─ linux-home ─▶ tunnel B ─▶ Linux Pi Web

页面壳 / `_next/*` / 应用认证 ──────────▶ Mac primary / Linux backup 控制面

GET /api/devices + POST /api/devices/select ─▶ 同一故障转移控制面
       └─ 校验 Origin/JSON/known id，写 HttpOnly Cookie

React DeviceWorkspaceRoot
       ├─ 启动时 3 次短探针确认；运行中每 5 秒采样并迟滞判定
       │    └─ 3 次连续失败且跨度 ≥8 秒才离线；2 次连续成功才恢复
       └─ unmount 旧工作区 → 选择设备 → 探针校验 → mount 目标工作区
```

当前网关只保存非敏感设备偏好并执行路由。两台 Pi Web 运行兼容 build，配置相同的 `PI_WEB_DEVICE_GATEWAY_URL`，通过受保护渠道共享应用账号文件和 Cookie 签名密钥；Session、项目文件、Provider Key、Push store 和 Agent 运行状态继续留在各设备上。

已落地的不变量：

1. `pi_web_device` 不承载身份或秘密，只接受 Nginx 静态白名单中的 id；未知值默认到主设备。
2. `/api/devices`、`POST /api/devices/select`、页面壳与登录使用 Mac primary / Linux backup；所选设备离线不影响控制面，冷启动无需清除 Cookie。
3. gateway 模式不导航、不 reload：`DeviceWorkspaceRoot` 先进入 switching phase 并 unmount 旧 `AppShell`，等待 effect cleanup 后再调用选择 API；目标 `/api/devices` 必须同时通过 payload 与 `X-Pi-Web-Device` 校验，随后用递增 epoch key 挂载新工作区。旧设备 Agent 不被 abort。
4. 应用登录 Cookie 是同一 origin 的 host-only Cookie；网关成员用同一签名密钥验证，不设置父域 Cookie。
5. 设备物理 URL 不返回给 gateway 模式 UI，不参与正常导航。
6. 目标不可达、响应错路由或超时会把设备偏好回滚到原设备并恢复其工作区快照；不能让失败选择把页面留在半切换状态。
7. 每台设备最后的 Session/cwd、文件页签与面板状态保存为有界、可校验的 `sessionStorage` 快照；跨设备不共享运行中 React 状态。
8. 支持同文档 View Transition 且用户未开启 reduced motion 时，异步切换期间保留真实旧工作区快照，目标 React 工作区同步挂载后再原位替换；侧栏数据 ready 继续由独立 loading gate 管理。不支持时使用明确的连接状态，不伪造内容骨架。
9. 执行面不做跨设备自动 failover。`/api/health` 的连接级 `502/504` 由网关转换成带设备 id 的结构化 `503 device_offline`；UI 不挂载离线工作区，用户显式选择在线设备后才改变 Cookie。
10. 全部成员离线时，云端 Nginx 直接返回无后端依赖的恢复页；不得把 Cloudflare 通用 502 当产品离线页。
11. 设备在线状态不能由单个样本翻转：冷启动最多做 3 次、单次 1.2 秒的短探针，间隔 400ms；已挂载页面每 5 秒只探测当前设备，至少 3 次连续失败且首尾相隔 8 秒才显示离线。确认离线后必须连续成功 2 次才恢复。任意中间成功会清除尚未确认的失败序列，浏览器自身断网导致的普通 fetch 错误不冒充设备离线。

后续增强另行设计：设备 registry/heartbeat/health cache、中央 Push broker、动态授权与网关高可用。若未来采用 Cloudflare Access，origin 必须验证 `Cf-Access-Jwt-Assertion`，不能仅信任 Cookie。[Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

## 6. 当前模块边界

```text
lib/device-directory-core.ts  纯数据验证、规范化、去重与边界限制
lib/device-directory.ts       环境变量、受限文件读取、mtime cache
app/api/devices/route.ts      薄 HTTP adapter；no-store；不暴露文件路径
app/api/devices/select/route.ts 受保护的设备选择控制面与 Cookie 写入
lib/device-selection*.ts      Cookie/请求边界与带超时客户端
lib/device-availability.ts    纯函数迟滞状态机；连续失败/恢复阈值
lib/device-workspace.ts       每设备有界工作区快照、导航恢复与清洗
hooks/useDeviceDirectory.ts   故障转移目录、所选设备轮询、离线状态与重试
hooks/useDeviceWorkspace.ts   切换事务、回滚、ready gate 与 View Transition
components/DeviceSwitcher.tsx 独立交互组件；不承载配置解析
components/DeviceWorkspaceRoot.tsx 带 epoch key 的工作区边界与状态展示
DeviceSwitcher.module.css     响应式样式；不向 globals.css 堆规则
deploy/nginx/pi-web.conf      已知设备 id 到 tunnel 的静态映射
deploy/devices.example.json   非敏感示例
```

`AppShell.tsx` 和 `MobileWorkspaceHeader.tsx` 只允许增加组件挂载点，不放设备解析、fetch、导航状态机或健康检查逻辑。

## 7. 性能预算与失败策略

| 项目 | 一期约束 | 失败行为 |
|---|---|---|
| 配置文件 | 最大 64 KiB、最多 32 台设备 | 超限/损坏条目跳过并返回 diagnostic |
| `/api/devices` | 页面挂载/切换后加载 | 3 秒超时后保留入口错误，不把离线设备挂载为工作区 |
| 文件 IO | path + mtime + size cache | 文件变化后下次请求重新解析 |
| 远端健康 | 只探测当前选择，5 秒轮询；3 次连续失败且跨度 ≥8 秒确认离线，2 次连续成功确认恢复 | 单次抖动不改 UI；持续故障通常约 15 秒进入恢复页，避免 N×M 探测风暴 |
| 设备切换 | POST + 目标探针各自有界；目标侧栏 ready 最多等待 6 秒 | 超时/错路由回滚原设备并显示错误；不逐台预连 |
| 当前设备 | 配置不存在时自动注入本机 | 永远保留可用当前设备 |
| SSE | workspace unmount 触发已有 effect cleanup | 原设备任务继续；旧客户端连接在 Cookie 改变前关闭 |
| 视觉过渡 | 支持时保留真实旧工作区直到目标 React tree 挂载；回调内禁止等待 animation frame | reduced motion 或 API 不支持时退回明确连接状态 |
| 工作区记忆 | 每设备一份有界 `sessionStorage` 快照 | 损坏/未知字段丢弃，回退空工作区 |

未来健康状态由网关 heartbeat 聚合，建议 15–30 秒 TTL、带 jitter 的指数退避和 per-device circuit breaker；不能让每个手机页面逐台探测。

## 8. 安全边界

1. 设备目录只能接受 `http:`/`https:` URL，拒绝用户名、密码、query、fragment 和非根路径。
2. `id` 使用稳定、小写、可用于日志/路由的 slug；禁止把 IP、用户名或密钥编码进 id。
3. API 不返回配置文件绝对路径，不读取目录之外的秘密。
4. Private Git 仓库仍不保存真实密码、Token、Cookie、VAPID 私钥或 session signing key。
5. 网关成员共享应用账号和 session signing key，但分发必须走受保护通道；不得写入 Git 或改成父域 Cookie。
6. 选择接口要求可信 Host/Origin 和 JSON content type；Cookie 使用 HttpOnly、Secure、SameSite=Lax。
7. 当前 `request-security.ts` 的 Host/Origin 检查继续生效；网关与物理排障 hostname 必须显式加入 `PI_WEB_ALLOWED_HOSTS`。

## 9. 测试矩阵

### 自动化

- 合法目录、空目录、当前设备缺失/覆盖；
- 非法 version/root、重复 id/URL、超出 32 台；
- 非 HTTP(S)、URL credentials、path/query/hash；
- 文件缺失、超 64 KiB、JSON 损坏、mtime 更新；
- `/api/devices` no-store 和不泄露路径；
- gateway/direct 模式判定与 gateway URL 规范化；
- 选择 API 的 Host/Origin、content type、body 上限、unknown id 和 Cookie 属性；
- 组件单设备时隐藏、多设备时显示、当前项不可选、中文/英文文本；
- 手机端设备胶囊位于一级导航，设备面板直接列出目标机器，2 次点击完成选择；验证 44px 触控目标、忙碌/失败反馈、Esc/焦点闭环；
- 目录 fetch abort/timeout、选择请求 5 秒 timeout 和卸载后不 setState；
- 初始探针单次失败后成功不显示离线；运行态单次失败、短时间密集失败和成功打断都不翻转状态；持续失败与连续恢复达到阈值后才翻转；
- Nginx 已知设备映射、未知值回退、控制面 primary/backup 和全离线恢复页；
- 旧 workspace 在修改 Cookie 前 unmount，gateway 模式只替换 React epoch、不调用 document navigation；
- 目标 payload/header 双重校验、失败回滚原设备、每设备工作区快照清洗与上限；
- View Transition 支持分支与 reduced-motion 回退；
- TypeScript、ESLint 与全量 Node tests。

### 手工/真机

- Safari tab 与 installed PWA 各连续往返切换，确认 URL、登录态和 document 不变，过程中不出现空白页；
- 切到每台设备后恢复其最后 Session/cwd/文件页签，不串用另一设备路径；
- 目标设备离线时 root/directory 仍可用、health=`device_offline`，并可显式切到在线设备；
- 分别断开 Mac/Linux 控制 relay，确认另一台兼容成员承接页面、登录、目录和选择；
- 原设备 Agent 正在 streaming 时切换，确认任务未被错误 abort；
- 切回后 reconciliation 恢复正确状态；
- 两设备 Push 的已知一期限制有明确 UI/文档提示。

## 10. 通过局域网 SSH 部署第二台机器

用户回到局域网并提供 `user@ip` 后，按以下顺序执行，不预设远端系统：

1. 只读探测：OS、架构、磁盘、Node/npm、Git、systemd、端口、当前用户权限。
2. 核对目标目录和已有服务，禁止覆盖未知工作区。
3. 为 private GitHub 仓库配置最小权限 Deploy Key 或用户凭据。
4. clone `codex/later-custom`，执行 `npm ci` 与隔离的 `build:mobile`。
5. 创建目标设备的 `PI_WEB_DEVICE_*`/`PI_WEB_DEVICE_GATEWAY_URL`；加入同一网关时，通过受保护通道分发相同账号文件和 session signing key，不明文提交。
6. 安装 systemd、loopback 健康检查和独立出站 tunnel。
7. 把新设备加入非敏感 devices file 与网关路由白名单，先本机/局域网验证，再验证同一登录态下切入、health、认证和切回。
8. 记录 commit、设备 id、回滚点和验证结果到 `PROJECT_STATE.md`；不记录秘密。

部署自动化应拆为“远端探测”“目标机安装”“隧道注册”“验收”4 个幂等步骤。第一台 Linux 验证通过前不急于引入 Ansible；当第 3 台设备出现、重复步骤稳定后再抽象 provider/role，避免过早框架化。
