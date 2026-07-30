# Pi Web 启动与手机服务器操作手册

## 快速结论

Pi Web 的电脑端和手机端共用 Mac 上的同一个 production 进程。日常启动后，用第二条命令确认从本机到公网的整条链路都正常：

```bash
./scripts/manage-pi-web.sh start
./scripts/verify-mobile-relay.sh
```

- 电脑访问：<http://127.0.0.1:30141>
- 手机访问：<https://pi.ai4child.asia>
- Mac 必须开机、联网并保持当前用户已登录；PWA 本身不提供离线后端。

## 当前第二台设备

2026-07-30 已部署 `linux-home / Pop!_OS`：

- 同一局域网入口：<http://192.168.1.68>
- Mac 与 Pop!_OS 的设备菜单都能列出 `mac-main` 和 `linux-home`。
- 两边使用相同的应用登录账号列表，但使用不同的 Cookie 签名密钥。
- Pop!_OS 当前入口是过渡性的 LAN HTTP，不支持 installed PWA/Web Push；公网与可信 HTTPS 仍由 Mac 的 <https://pi.ai4child.asia> 提供。

当前设备目录分别保存在 Mac 的 `deploy/devices.local.json` 和 Pop!_OS 的 `~/.config/pi-web/devices.json`，两者权限/提交策略不同：前者被 Git 忽略，后者只允许运行用户读取，均不包含密码或 Token。

## 启动架构

```text
电脑浏览器 ───────────────────────────────┐
                                          ▼
                                  Pi Web production
                                  127.0.0.1:30141
                                          ▲
手机 ─▶ Cloudflare ─▶ 云端 Nginx :33042 ─▶ SSH 反向隧道 :33041
```

Mac 上由 2 个 LaunchAgent 常驻运行：

1. `com.later.pi-web.production`：用 `.next-mobile/` 启动 Next.js，监听 `127.0.0.1:30141`。
2. `com.later.pi-web.cloud-relay`：建立 `121.43.113.236:33041 → Mac:30141` 的 SSH 反向隧道。

云服务器上还有 2 个 systemd 服务：

1. `nginx`：在 `127.0.0.1:33042` 接收 Cloudflare 回源并转给 `33041`。
2. `cloudflared`：承接 `pi.ai4child.asia` 的 HTTPS 流量并转给 Nginx。

认证由 Pi Web 的 `/login` 和签名 HttpOnly Cookie 完成；Nginx 不应启用浏览器原生 Basic Auth。

## 日常启动、停止和检查

所有命令都在仓库根目录执行：

> 请从独立的 macOS Terminal 执行 `stop` 或 `restart`。如果命令由正在被管理的 Pi Web 进程自身发起，`launchctl bootout` 会终止该进程树，命令无法在同一次调用中继续执行启动后半段。

```bash
# 查看两个进程、本机后端、云端隧道和手机公网，共 4 类状态
./scripts/manage-pi-web.sh status

# 启动 production 和手机公网隧道
./scripts/manage-pi-web.sh start

# 停止两者，但保留配置、构建、日志、密钥和会话
./scripts/manage-pi-web.sh stop

# 完整重启；会自动回收占住 33041 的失联旧 SSH 隧道
./scripts/manage-pi-web.sh restart

# 持续查看 production 与隧道日志，Ctrl-C 退出
./scripts/manage-pi-web.sh logs

# 完整验证本机、云端 Nginx、登录 Cookie 和公网域名
./scripts/verify-mobile-relay.sh
```

`status` 只有在下列项目全部通过时才返回退出码 `0`：

1. 两个 LaunchAgent 都有正在运行的 PID。
2. 本机 `http://127.0.0.1:30141/api/health` 正常。
3. 云端经反向隧道访问 `127.0.0.1:33041/api/health` 正常。
4. 公网 `https://pi.ai4child.asia/api/health` 正常。

公网健康与登录探测会绕过 Mac 上的 `HTTP_PROXY/HTTPS_PROXY`，直接连接 Cloudflare，以模拟手机访问链路，避免本机开发代理抖动造成误报。

不检查公网域名时可临时执行：

```bash
PI_WEB_PUBLIC_HOSTNAME=none ./scripts/manage-pi-web.sh status
PI_WEB_PUBLIC_HOSTNAME=none ./scripts/verify-mobile-relay.sh
```

## 首次安装手机服务器

前置条件：

1. Node.js `>= 22.19.0`，并已执行 `npm install`。
2. 可以免密 SSH 登录 `root@121.43.113.236`，且主机指纹已写入 `~/.ssh/known_hosts`。
3. 云服务器已安装 Nginx 和 cloudflared。

一键安装：

```bash
./scripts/install-mobile-relay.sh
```

安装脚本默认把当前机器标记为 `mac-main` / `Main Mac`，外部 URL 使用
`https://${PI_WEB_PUBLIC_HOSTNAME}`，设备目录读取仓库内已忽略的
`deploy/devices.local.json`。需要修改时，在运行安装脚本前传入：

```bash
PI_WEB_DEVICE_ID=mac-main \
PI_WEB_DEVICE_NAME='Main Mac' \
PI_WEB_PUBLIC_URL=https://mac.example.com \
PI_WEB_DEVICES_FILE="$PWD/deploy/devices.local.json" \
./scripts/install-mobile-relay.sh
```

目录格式见 [`deploy/devices.example.json`](../deploy/devices.example.json)。文件不存在或无效不会阻止 production 启动，只会保持单设备模式。

该脚本会依次：

1. 构建独立的 `.next-mobile/` production 产物。
2. 创建或复用登录凭据与 Cookie 签名密钥。
3. 检查并安全回收仅由旧 `sshd` 占用的云端专用端口 `33041`。
4. 上传并安装云端 Nginx 配置；失败时服务器安装脚本会回滚。
5. 安装并启动两个 Mac LaunchAgent。
6. 等待本机服务和 SSH 反向隧道健康。

可选参数：

```bash
# 已确认 .next-mobile/BUILD_ID 是最新版本时跳过构建
./scripts/install-mobile-relay.sh --skip-build

# 不更新云服务器的 Nginx 配置，但仍连接服务器并启动 SSH 隧道
./scripts/install-mobile-relay.sh --skip-server
```

## 代码更新后重新部署

```bash
npm install
./scripts/install-mobile-relay.sh
./scripts/verify-mobile-relay.sh
```

production 使用 `.next-mobile/`，不会与开发服务器的 `.next/` 混用。开发期间只运行 `npm run dev`；不要手工执行 `next build` 或 `npm run build`。

## 脚本和配置清单

| 文件 | 作用 | 运行位置 |
|---|---|---|
| `scripts/manage-pi-web.sh` | 日常 `status/start/stop/restart/logs`，并处理僵尸隧道 | Mac |
| `scripts/install-mobile-relay.sh` | 构建、配置云端、安装 LaunchAgent | Mac |
| `scripts/verify-mobile-relay.sh` | 验证本机、隧道、Nginx、登录和公网 | Mac |
| `scripts/uninstall-mobile-relay.sh` | 卸载两个 LaunchAgent，保留用户数据 | Mac |
| `deploy/server/install-pi-web-relay.sh` | 备份、安装、校验和回滚 Nginx 站点 | 云服务器，由安装脚本上传执行 |
| `deploy/nginx/pi-web.conf` | 手机公网入口的 Nginx 配置 | 云服务器模板 |
| `deploy/macos/*.plist.in` | production 与 SSH 隧道的 LaunchAgent 模板 | Mac 模板 |

`deploy/server/install-pi-web-relay.sh` 不需要日常手工运行；`install-mobile-relay.sh` 会上传带时间戳的 Nginx 配置并调用它。

## 手机访问不了时怎么判断

先运行：

```bash
./scripts/manage-pi-web.sh status
./scripts/verify-mobile-relay.sh
```

按失败位置处理：

1. `本机健康检查` 失败：执行 `./scripts/manage-pi-web.sh logs`，再检查 `lsof -nP -iTCP:30141 -sTCP:LISTEN`。
2. 本机正常但 `云端隧道检查` 失败：执行 `./scripts/manage-pi-web.sh restart`。脚本会先关闭当前隧道，并仅在确认 `33041` 的占用者是 `sshd` 时回收旧连接。
3. 云端隧道正常但 `手机公网检查` 失败：检查云服务器的 Nginx 和 cloudflared。
4. `/login` 能打开但登录失败：检查 `deploy/secrets/pi-web-auth-credentials.json`，权限必须是 `600`；不要把密码打印进日志或提交 Git。

云服务器只读检查命令：

```bash
ssh root@121.43.113.236 'systemctl is-active nginx cloudflared'
ssh root@121.43.113.236 'ss -ltnp "sport = :33041 or sport = :33042"'
ssh root@121.43.113.236 'curl --fail --max-time 5 http://127.0.0.1:33041/api/health'
ssh root@121.43.113.236 'curl --fail --max-time 5 http://127.0.0.1:33042/api/health'
```

典型故障是 Mac 休眠或网络切换后，云端旧 `sshd` 连接停留在 `CLOSE-WAIT`：端口看似监听，但请求超时，新隧道又因端口占用退出。现在 `start`、`restart` 和安装脚本都会识别并处理这个专用端口残留。

## 文件位置与卸载

| 内容 | 路径 |
|---|---|
| production 服务配置 | `~/Library/LaunchAgents/com.later.pi-web.production.plist` |
| SSH 隧道配置 | `~/Library/LaunchAgents/com.later.pi-web.cloud-relay.plist` |
| production 构建 | `.next-mobile/` |
| 运行日志 | `deploy/logs/` |
| 安装状态 | `deploy/state/` |
| 登录凭据与签名密钥 | `deploy/secrets/`（权限 `600`，不提交 Git） |

卸载：

```bash
./scripts/uninstall-mobile-relay.sh
```

该脚本保留会话、日志、密钥和构建产物。更完整的 Cloudflare、端口和回滚说明见 [移动端云转发手册](./mobile-cloud-relay.md)，手机 PWA 安装见 [PWA 安装指南](./PWA.md)。
