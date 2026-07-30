# Pi Web 多设备接入架构与一期 ADR

> 状态：Accepted for Phase 1（2026-07-30）
>
> 原则：先打通真实使用链路，同时保留走向独立开源项目和单一手机 PWA 的演进空间。

## 1. 问题定义

用户在一台手机上需要访问多台运行 Pi Web 的设备，例如当前 Mac、家中 Linux 主机和未来其他工作站。每台设备拥有自己的：

- `~/.pi/agent`、Session 和运行中的 `AgentSession`；
- 项目目录、Git worktree 和本机文件权限；
- Provider/OAuth/API Key；
- production 进程和出站隧道。

“多设备”不等于复制 Session，也不等于把多个 `AgentSession` 塞进同一个 Next.js 进程。正确边界是：**手机选择一个设备，后续页面、API、SSE 和文件访问在同一逻辑请求期间稳定到达该设备。**

## 2. 目标与非目标

### 一期目标

1. 每台 Pi Web 有稳定的 `deviceId`、显示名和外部访问 URL。
2. 通过一个非敏感 JSON 目录配置多台设备。
3. UI 能显示当前设备并跳转到其他设备，普通浏览器和直连 URL 先打通。
4. 配置错误只关闭多设备入口，不影响当前设备的 Session/Chat。
5. 核心解析、文件加载、UI 和 API 分层，具备独立测试。

### 一期不做

- 不集中同步 Session 或项目文件；
- 不自动复制 Provider 密钥；
- 不承诺跨 origin 后仍维持单一 installed PWA、统一 Cookie 或统一 Push；
- 不探测所有远端设备健康，不引入 N×M 轮询；
- 不在用户提供局域网 SSH 地址前操作第二台真实机器。

## 3. 官方约束与调研结论

### 3.1 不采用 `/devices/<id>` 直接挂多份 Pi Web

Next.js 的 `basePath` 必须在构建时确定并内联到客户端 bundle，不能在运行时按设备切换。Pi Web 还有大量根路径 API、Service Worker、manifest 和资源 URL，因此用路径前缀代理会制造持续的路径重写和重复构建负担。[Next.js basePath 官方文档](https://nextjs.org/docs/pages/api-reference/config/next-config-js/basePath)

结论：多设备路由不能要求每份 Pi Web 感知动态路径前缀。

### 3.2 子域名直连适合一期，但不是最终统一 PWA

Service Worker registration 与 scope 绑定同一 origin；规范还建议需要安全隔离的站点使用不同 origin。PushSubscription 也关联具体的 Service Worker registration。不同设备子域名因此会形成独立 SW/Push 状态。[W3C Service Workers](https://w3c.github.io/ServiceWorker/v1/)、[W3C Push API](https://w3c.github.io/push-api/index.html)

Web App Manifest 规范要求应用导航超出 scope 时向用户暴露实际 URL/origin，因此从已安装 PWA 跳到另一个设备子域名可能出现浏览器 UI或离开独立窗口体验。[W3C Web App Manifest](https://w3c.github.io/manifest/)

Cookie 未设置 `Domain` 时是 host-only；设置父域 `Domain` 才会发送给子域，但共享认证 Cookie 会扩大任一子域被攻破后的影响面。[RFC 6265](https://datatracker.ietf.org/doc/rfc6265/)

结论：一期允许设备 URL 直连以快速打通；长期必须提供单 origin 网关，不能把跨子域体验当最终架构。

### 3.3 每台设备采用出站隧道

Cloudflare Tunnel 由设备上的 `cloudflared` 主动建立 outbound-only 连接，不要求设备具有公网可路由 IP；一个 tunnel 可以发布多个 hostname/service 映射，也可为不同设备使用独立 tunnel UUID 以便独立路由和故障隔离。[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)、[Tunnel routing](https://developers.cloudflare.com/tunnel/routing/)

当前 SSH `-R` 仍可用于一期和局域网部署，但 `ExitOnForwardFailure` 只保证 forwarding listener 建立成功，不保证最终目标持续健康；因此必须保留应用层 `/api/health` 和重连检查。[OpenSSH ssh_config](https://man.openbsd.org/OpenBSD-6.8/ssh_config.5)

结论：隧道是可替换的 deployment adapter，不进入 Session/Chat 核心模块。Mac 可继续 SSH reverse tunnel；新 Linux 优先评估每设备独立 Cloudflare Tunnel。

### 3.4 SSE 需要连接粘性和可恢复性

Nginx 默认启用 proxy buffering，SSE 代理必须关闭 buffering 或正确处理 `X-Accel-Buffering`。[Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)

Cloudflare 文档说明 tunnel connector 停止时长连接会中断；官方排障也指出 `text/event-stream` 会影响 buffering 行为。[Cloudflare tunnel configuration](https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/)、[Cloudflare common errors](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/)

结论：一次页面生命周期内的 HTML、API、SSE 必须路由到同一设备。设备切换必须整页 reload，并接受旧 SSE 断开；旧设备上的 Agent 继续运行，通过现有 reconciliation/Push 收口。

## 4. 方案比较

| 方案 | 一期速度 | 单 PWA | 认证/Push | 运维复杂度 | 结论 |
|---|---:|---:|---:|---:|---|
| 路径 `/devices/id` | 低 | 是 | 中 | 高 | 拒绝：Next build-time basePath 与根路径 API 冲突 |
| 每设备独立 URL/子域名 | 高 | 否 | 每 origin 独立 | 低 | 一期采用，明确标记过渡方案 |
| 单 origin 设备网关 | 中 | 是 | 可统一 | 中 | 长期目标 |
| 集中运行所有 AgentSession | 低 | 是 | 可统一 | 极高 | 拒绝：破坏本地文件/权限/Session 边界 |

## 5. 分期架构

### Phase 1：可配置直连目录

```text
Pi Web UI
  └─ GET /api/devices
       └─ DeviceDirectory（本地配置文件 + 当前设备环境变量）

选择设备
  └─ window.location.assign(device.url)
       └─ 目标设备自己的 Pi Web / 登录 / Session
```

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

### Phase 2：单 origin 设备网关

```text
手机 installed PWA（一个 origin）
          │
          ▼
   Device Gateway
   ├─ 中央登录/设备授权
   ├─ 当前设备选择与粘性路由
   ├─ 设备 registry / heartbeat / health cache
   ├─ Push broker
   └─ SSE 透传、断线与 drain
          │
     每设备独立 tunnel
          │
   Mac / Linux / Workstation Pi Web
```

网关只保存设备元数据、路由状态、中心认证和通知订阅；Session、项目文件、Provider Key 和 Agent 运行状态继续留在设备上。

Phase 2 需要单独 ADR 解决：

1. 中央身份如何传给设备；若使用 Cloudflare Access，应在 origin 验证 `Cf-Access-Jwt-Assertion`，不能仅信任 Cookie。[Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
2. 设备选择 Cookie/服务器 session 如何与 API、SSE 保持粘性。
3. 切换时如何关闭旧 EventSource、阻止迟到事件污染新设备 UI。
4. PushSubscription 如何集中存储，设备如何用短期、可撤销凭据上报完成事件。
5. 网关不可用时怎样回退到设备直连 URL。

## 6. 一期模块边界

```text
lib/device-directory-core.ts  纯数据验证、规范化、去重与边界限制
lib/device-directory.ts       环境变量、受限文件读取、mtime cache
app/api/devices/route.ts      薄 HTTP adapter；no-store；不暴露文件路径
hooks/useDeviceDirectory.ts   一次性加载、AbortController 与超时
components/DeviceSwitcher.tsx 独立交互组件；不承载配置解析
DeviceSwitcher.module.css     响应式样式；不向 globals.css 堆规则
deploy/devices.example.json   非敏感示例
```

`AppShell.tsx` 和 `MobileWorkspaceHeader.tsx` 只允许增加组件挂载点，不放设备解析、fetch、导航状态机或健康检查逻辑。

## 7. 性能预算与失败策略

| 项目 | 一期约束 | 失败行为 |
|---|---|---|
| 配置文件 | 最大 64 KiB、最多 32 台设备 | 超限/损坏条目跳过并返回 diagnostic |
| `/api/devices` | 页面挂载加载一次，不轮询 | 3 秒超时后隐藏切换器，不影响 Chat |
| 文件 IO | path + mtime + size cache | 文件变化后下次请求重新解析 |
| 远端健康 | 一期不主动探测 | 避免首屏串行等待和 N×M 探测风暴 |
| 设备切换 | 不做网络 preflight，直接导航 | 避免双倍连接延迟；目标离线由浏览器呈现 |
| 当前设备 | 配置不存在时自动注入本机 | 永远保留可用当前设备 |
| SSE | 切换即整页 reload | 原设备任务继续；客户端连接按现有机制终止 |

Phase 2 健康状态由网关 heartbeat 聚合，建议 15–30 秒 TTL、带 jitter 的指数退避和 per-device circuit breaker；不能让每个手机页面逐台探测。

## 8. 安全边界

1. 设备目录只能接受 `http:`/`https:` URL，拒绝用户名、密码、query、fragment 和非根路径。
2. `id` 使用稳定、小写、可用于日志/路由的 slug；禁止把 IP、用户名或密钥编码进 id。
3. API 不返回配置文件绝对路径，不读取目录之外的秘密。
4. Private Git 仓库仍不保存真实密码、Token、Cookie、VAPID 私钥或 session signing key。
5. 一期不同 origin 的登录默认互相独立；不得用父域 Cookie 偷懒扩大权限面。
6. 当前 `request-security.ts` 的 Host/Origin 检查继续生效；新设备 public hostname 必须显式加入 `PI_WEB_ALLOWED_HOSTS`。

## 9. 测试矩阵

### 自动化

- 合法目录、空目录、当前设备缺失/覆盖；
- 非法 version/root、重复 id/URL、超出 32 台；
- 非 HTTP(S)、URL credentials、path/query/hash；
- 文件缺失、超 64 KiB、JSON 损坏、mtime 更新；
- `/api/devices` no-store 和不泄露路径；
- 组件单设备时隐藏、多设备时显示、当前项不可选、中文/英文文本；
- fetch abort/timeout 和卸载后不 setState；
- TypeScript、ESLint 与全量 Node tests。

### 手工/真机

- Safari tab 与 installed PWA 各切换一次；
- 目标设备未登录、已登录、离线和证书错误；
- 原设备 Agent 正在 streaming 时切换，确认任务未被错误 abort；
- 切回后 reconciliation 恢复正确状态；
- 两设备 Push 的已知一期限制有明确 UI/文档提示。

## 10. 通过局域网 SSH 部署第二台机器

用户回到局域网并提供 `user@ip` 后，按以下顺序执行，不预设远端系统：

1. 只读探测：OS、架构、磁盘、Node/npm、Git、systemd、端口、当前用户权限。
2. 核对目标目录和已有服务，禁止覆盖未知工作区。
3. 为 private GitHub 仓库配置最小权限 Deploy Key 或用户凭据。
4. clone `codex/later-custom`，执行 `npm ci` 与隔离的 `build:mobile`。
5. 创建目标设备自己的 secrets 和 `PI_WEB_DEVICE_*` 配置；需要共享的秘密使用 SOPS + age 或独立秘密分发，不明文提交。
6. 安装 systemd、loopback 健康检查和独立出站 tunnel。
7. 把新设备加入非敏感 devices file，先本机/局域网验证，再验证手机切换。
8. 记录 commit、设备 id、回滚点和验证结果到 `PROJECT_STATE.md`；不记录秘密。

部署自动化应拆为“远端探测”“目标机安装”“隧道注册”“验收”4 个幂等步骤。第一台 Linux 验证通过前不急于引入 Ansible；当第 3 台设备出现、重复步骤稳定后再抽象 provider/role，避免过早框架化。
