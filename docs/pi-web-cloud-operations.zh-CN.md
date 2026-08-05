# Pi Web 云端网关检查、部署与故障手册

> 适用范围：`mac-main`、`linux-home`、`cloud-relay` 和手机入口 `https://pi.ai4child.asia`
> 当前事实源：[`PROJECT_STATE.md`](../PROJECT_STATE.md) 与 [`ops/device-inventory.json`](../ops/device-inventory.json)
> 安全边界：本文和检查脚本不读取或输出密码、Token、私钥、Cookie 值、Provider Key 或会话签名密钥。

## 1. 以后先运行这一条

在 Mac 的仓库根目录执行：

```bash
./scripts/check-pi-web-cloud.sh
```

它是只读检查，不重启服务、不改 Nginx、不清端口。默认覆盖 25 项以上实时状态：

1. device inventory 和管理路由；
2. Mac production、`30141` 与 `33041` relay；
3. Linux production、systemd 进程归属、`30141` 与 `33043` relay；
4. 云端 `nginx`、`cloudflared`、`33041/33042/33043/33044` 监听和健康接口；
5. 公网 DNS/TLS、登录页、默认/Mac/Linux/未知 Cookie 路由。

公网故障或离线排查时可以先跳过 Cloudflare：

```bash
./scripts/check-pi-web-cloud.sh --no-public
```

脚本退出码：`0` 表示所有必检项正常，`1` 表示至少一项故障，`2` 表示参数或本机依赖错误。历史日志统计只用于解释过去的中断，不会单独把当前状态判为失败。

应用登录、签名 Cookie 与两个账号的完整验收仍使用：

```bash
./scripts/verify-mobile-relay.sh
```

两个脚本分工不同：`check-pi-web-cloud.sh` 定位哪一层挂了，并覆盖 Mac/Linux 双后端；`verify-mobile-relay.sh` 使用本机受限凭据完成故障转移控制面和公网登录验收。

## 2. 2026-07-31 本次手机不可访问结论

云服务器没有挂。检查时的实时结果为：

| 检查项 | 结果 |
|---|---|
| 云端 `nginx.service` | `active`，`NRestarts=0`，自 2026-07-28 持续运行 |
| 云端 `cloudflared.service` | `active`，`NRestarts=0`，自 2026-07-30 持续运行 |
| 云端 Nginx 配置 | `nginx -t` 通过 |
| Mac relay `33041` | listener 正常，health `200` |
| Linux relay `33043` | listener 正常，health `200` |
| 主网关 `33042` / Linux 直连 `33044` | health 均为 `200` |
| 公网 Mac/Linux/未知 Cookie | 均为 `200`，后端标识符合预期 |

故障窗口和直接原因有明确证据：

1. 云端 Nginx 在 `11:19–11:34 CST` 多次记录 `pi.ai4child.asia → 127.0.0.1:33041` 的 `Connection refused`。
2. 同期 Mac 的 `com.later.pi-web.cloud-relay` 日志连续出现 `ssh: connect ... Network is unreachable`。
3. 该 LaunchAgent 保持 `KeepAlive` 并累计启动 `368` 次，最近一次进程从 `11:57:45 CST` 持续运行；恢复后 `33041` 与公网重新为 `200`。

因此本次直接故障点是 **Mac 到云服务器的出站 SSH 反向隧道无法建立**；最可能触发因素是 Mac 断网、换网、休眠唤醒或临时路由不可用。云端 Nginx/Cloudflare 没有重启，Linux 后端也没有同时故障。当前已经自动恢复，不需要重启云服务器。

### 2.1 2026-08-01 Linux 离线拖垮入口

本次 `linux-home` 的 `33043`、管理 relay `33102` 和 LAN 地址同时不可达，但 Mac `30141/33041` 与云端正常。旧设计仍让 `/api/devices` 和 health 跟随 Linux Cookie，导致原始 502 穿透到 PWA。现已修复为：控制面 `33041 primary → 33043 backup`、所选设备 health 结构化 `503 device_offline`、前端离线页显式切换、所有设备离线时云端本地恢复页。不得再以清 Cookie 作为正常恢复手段。

### 2.2 2026-08-02 在线设备短暂闪现离线

前端原机制是启动时探测 1 次，随后每 5 秒探测当前设备；任何单次 `502/503/504` 或探针超时都会立刻显示离线，下一次成功又立刻恢复。因此云端连接抖动、旧 relay 短暂停顿或一次超时会造成“使用中突然离线又连上”，不能据此证明设备真的掉线。

曾短暂采用“3 次失败/2 次恢复”的迟滞状态机，但这仍然保留了无用户价值的后台轮询，并可能在用户阅读或输入时把整个工作区替换成不可达页。该中间方案已由下一节的按需检测替代。

### 2.3 2026-08-02 从“设备离线”改为按需连接判断

本次用户看到 `Main Mac is offline` 时，Mac 本机 `127.0.0.1:30141/api/health=200`，说明 Pi Web 与机器都在运行；但云端 `33041 health=000`，LaunchAgent 已累计 `runs=558`，日志持续为 `remote port forwarding failed for listen port 33041`。准确事实是“云端无法通过残留的 reverse listener 到达 Mac”，不是“Mac 离线”。已定向回收云端失效的 `sshd` listener 并恢复 HTTP relay。

产品机制同步改为需求驱动：启动和空闲时不请求 health；健康发送直接执行，只有真实发送/SSE 建连失败后才补做 1 次 health 判断；设备切换与“重新检测”也各做 1 次。确认后文案为“网关暂时无法连接，设备本身可能仍在线”。普通应用 `503` 或浏览器本身断网不会被归类为设备不可达。Mac LaunchAgent 改用 `run-pi-web-cloud-relay.sh`：每次重连前先保留仍健康的 listener；若连续 health 失败，只在 owner=`sshd` 时定向回收，再建立新隧道，避免 raw ssh 永久重试 `remote port forwarding failed`。

### 2.4 2026-08-05 自愈预检自身卡死

用户再次看到云端兜底页时，Mac 本机 `30141 health=200`、production `runs=1`，云端 Nginx/cloudflared 均为 `active`，但 `33041` listener 不存在、`33042 health=503`。Relay LaunchAgent 表面为 `state=running`，实际已累计 `runs=233`；父 Bash PID `25006` 与预检 SSH 子 PID `25009` 从 `02:17:29` 起卡住 `6:49:07`。同一时刻新的直接 SSH 可以访问云服务器，证明旧子进程是网络切换留下的半开会话。

根因是预检 SSH 只有 `ConnectTimeout=10`。该选项只限制 TCP/SSH 建连阶段；连接一旦建立，后续网络失效不会触发它。父 Bash 永久等待子进程，launchd 因仍有 PID 而不会重启，自愈链反而失去自愈能力。

修复采用两层界限：所有预检/主隧道 SSH 都设置 `ServerAliveInterval=10`、`ServerAliveCountMax=2`；预检外再包一层 `35s` 本地 watchdog，超时先 TERM、2 秒后 KILL，由 launchd 重新执行完整流程。真实回归中主动 KILL 隧道 PID `35672` 后，launchd 自动建立 PID `39324`，云端 `33041`、公网 health 恢复 `200`，未登录 root 正常返回 `307`。

云端兜底页的按钮也从盲目 `location.reload()` 改为一次用户触发的 `/login` 控制面检查：成功才重新载入，失败显示“设备隧道仍不可达，后台正在自动重连”，不引入后台轮询。Nginx release 为 `20260805T011103Z`。

## 3. 实际部署架构

```text
手机 / PWA
  │ HTTPS 443（Cloudflare edge）
  ▼
Cloudflare Tunnel
  │ cloudflared 出站隧道
  ▼
cloud-relay: 127.0.0.1:33042（Nginx 同源网关）
  ├─ 页面壳、静态、认证、目录、选择 ─▶ 33041 Mac primary / 33043 Linux backup
  ├─ Cookie=mac-main 的设备 API/SSE ───▶ 127.0.0.1:33041 ──────▶ Mac:30141
  └─ Cookie=linux-home 的设备 API/SSE ─▶ 127.0.0.1:33043 ─SSH -R─▶ Linux:30141

维护回退：
  linux.ai4child.asia ─▶ cloud-relay:33044 ─▶ 33043 ─▶ Linux:30141
  Linux LAN :80 ─▶ Linux:30141
```

关键事实：

1. 云服务器不安装、不构建也不运行 Pi Web Next.js；`device-access facts cloud-relay` 显示 `pi_web=not-installed` 是正确状态。
2. 云端只承担 Nginx 同源路由、Cloudflare ingress 和 SSH reverse listener。
3. 控制面不是某一台固定设备。`/`、`/login`、`/_next/*`、`/api/auth/session`、`/api/devices`、`/api/devices/select` 优先走 Mac，失败时转 Linux；执行面仍严格跟随用户选择。
4. Session、项目、模型凭据、AgentSession 进程与 Push 数据仍在各设备本地，不在云端同步。
5. Mac 和 Linux 必须部署兼容版本，并共享应用账号文件与 Cookie 签名密钥；这些秘密只通过受保护通道分发，不能提交 Git。

## 4. 端口与服务总表

### 4.1 Pi Web 数据面

| 位置 | 端口 | 绑定/方向 | owner | 用途 | 是否应公网开放 |
|---|---:|---|---|---|---|
| Cloudflare edge | `443` | 公网 HTTPS | Cloudflare | 手机唯一正式入口 | 是，由 Cloudflare 承担 |
| Mac | `30141` | `127.0.0.1` | Next.js | Mac Pi Web production | 否 |
| Linux | `30141` | `127.0.0.1` | `pi-web.service` | Linux Pi Web production | 否 |
| Linux | `80` | LAN fallback | Nginx | 同局域网故障回退 | 否，不应暴露公网 |
| Cloud | `33041` | `127.0.0.1` | `sshd` | Mac Pi Web SSH `-R` listener | 否 |
| Cloud | `33042` | `127.0.0.1` | Nginx | `pi.ai4child.asia` 同源主网关 | 否 |
| Cloud | `33043` | `127.0.0.1` | `sshd` | Linux Pi Web SSH `-R` listener | 否 |
| Cloud | `33044` | `127.0.0.1` | Nginx | `linux.ai4child.asia` 维护入口 | 否 |
| Cloud | `22` | 公网 SSH | `sshd` | 管理登录和 Mac/Linux 出站 reverse tunnel 入口 | 仅受控开放 |

`33041–33044` 必须只绑定 `127.0.0.1`。不要为了“临时恢复”改成 `0.0.0.0`，不要在安全组开放这些端口。

### 4.2 与 Pi Web 分离的设备管理面

| 位置 | 端口 | 绑定 | 用途 |
|---|---:|---|---|
| Cloud | `33101` | `127.0.0.1` | `mac-main:sshd` 管理 relay |
| Cloud | `33102` | `127.0.0.1` | `linux-home:sshd` 管理 relay |

`33101/33102` 供 [`device-access.sh`](../scripts/device-access.sh) 使用，与 Pi Web HTTP relay `33041/33043` 相互独立。管理 relay 正常不代表手机链路正常，反之亦然。

### 4.3 服务所有权

| 设备 | 服务 | 管理器 | 作用 |
|---|---|---|---|
| Mac | `com.later.pi-web.production` | LaunchAgent | 启动 `.next-mobile` 的 Next.js `30141` |
| Mac | `com.later.pi-web.cloud-relay` | LaunchAgent | 建立 Cloud `33041 → Mac 30141` |
| Linux | `pi-web.service` | systemd system | 启动 `.next-mobile` 的 Next.js `30141` |
| Linux | `pi-web-cloud-relay.service` | systemd system | 建立 Cloud `33043 → Linux 30141` |
| Linux | `nginx.service` | systemd system | LAN `:80` fallback |
| Cloud | `nginx.service` | systemd system | `33042/33044` 路由与代理 |
| Cloud | `cloudflared.service` | systemd system | Cloudflare ingress |

## 5. 当前版本是怎么部署的

### 5.1 共同行为

当前生产基线记录为 Later 私有分支 `422194f`、Pi Web `0.8.5`。Mac 与 Linux 都从同一精确 commit 的隔离干净 worktree 构建 `.next-mobile/`，避免污染开发目录 `.next/`。不要在开发期间运行普通 `next build`；部署只使用 `npm run build:mobile` 或封装安装脚本。

### 5.2 Mac 与云端入口

Mac 首次安装和版本更新均由同一个入口执行：

```bash
npm install
./scripts/install-mobile-relay.sh
./scripts/verify-mobile-relay.sh
./scripts/check-pi-web-cloud.sh
```

[`install-mobile-relay.sh`](../scripts/install-mobile-relay.sh) 会：

1. 构建 `.next-mobile/`；
2. 创建/复用 gitignored 且权限 `600` 的应用凭据与签名密钥；
3. 上传 Nginx 模板并调用云端安装脚本，配置失败自动回滚；
4. 安装 Mac production/relay 两个 LaunchAgent；
5. 安全回收仅由旧 `sshd` 占用的专用 `33041`；
6. 等待本机、隧道和公网健康。

确认产物未变化时可用 `--skip-build`；明确不更新云端配置时可用 `--skip-server`。正常部署不要手改 `/etc/nginx/conf.d/pi-web.conf`，源模板是 [`deploy/nginx/pi-web.conf`](../deploy/nginx/pi-web.conf)，云端安装器是 [`deploy/server/install-pi-web-relay.sh`](../deploy/server/install-pi-web-relay.sh)。

### 5.3 Linux 后端

Linux 当前路径为 `/home/later/Code/pi-web`，Node `22.22.2`，服务模板为 [`deploy/linux/pi-web.service`](../deploy/linux/pi-web.service)。关键点是 systemd 直接管理 Node/Next：

```ini
ExecStart=/usr/bin/node /home/later/Code/pi-web/node_modules/next/dist/bin/next start -H 127.0.0.1 -p 30141
KillMode=mixed
```

不要恢复 `npm run start:mobile` wrapper。完整安装、认证、Nginx、模型配置、备份与回滚见 [`linux-deployment.zh-CN.md`](./linux-deployment.zh-CN.md)。

任何 Linux 重启/部署前必须先通过已认证的 `/api/agent/running` 确认运行 Session 为 `0`，让活跃任务自然结束。部署成功必须同时满足：

1. `curl http://127.0.0.1:30141/api/health` 返回 `200`；
2. `systemctl is-active pi-web` 精确为 `active`；
3. `30141` listener PID 等于 `systemctl show pi-web -p MainPID --value`；
4. 该 PID 属于 `/system.slice/pi-web.service` cgroup；
5. 在线时 Cloud `33043` 与公网 Linux Cookie 路由返回 `200`；离线时公网 health 必须返回结构化 `503 device_offline`，而 root、目录和选择仍可用。

新检查脚本自动验证第 1–5 项中的只读部分。

## 6. 手机访问失败时的分层处理

先运行检查脚本，然后只处理第一个失败层。

### 6.1 公网 `/login` 失败，但云端 `33042` 正常

问题位于 Cloudflare DNS/TLS/tunnel。检查：

```bash
./scripts/device-access.sh run cloud-relay -- systemctl status cloudflared --no-pager
./scripts/device-access.sh run cloud-relay -- journalctl -u cloudflared -n 100 --no-pager
```

先看日志，不直接重装 tunnel。`cloudflared` 配置位于云端 `/etc/cloudflared/config.yml`；真实 tunnel 凭据不进入仓库或聊天。

### 6.2 云端 `nginx` 或 `33042` 失败

只读确认：

```bash
./scripts/device-access.sh run cloud-relay -- nginx -t
./scripts/device-access.sh run cloud-relay -- systemctl status nginx --no-pager
./scripts/device-access.sh run cloud-relay -- ss -ltnp 'sport = :33042'
```

配置修改必须从仓库模板部署并保留回滚；只有 `nginx -t` 通过后才能 reload。不要把 Nginx、cloudflared 和两台后端一起盲目重启。

### 6.3 Mac `30141` 正常，但 Cloud `33041` 失败

这是本次故障所属层。先从独立 macOS Terminal 执行：

```bash
./scripts/manage-pi-web.sh status
./scripts/manage-pi-web.sh restart
./scripts/check-pi-web-cloud.sh
```

`restart` 会停止当前 SSH client，只在确认云端 `33041` 的 owner 是 `sshd` 后回收旧 listener，再启动新隧道。不要手工 `killall ssh` 或 `killall node`。

不要从正在被管理的 Pi Web 任务内部执行 Mac 的 `stop/restart`：`launchctl bootout` 会终止发起命令的进程树，后半段可能无法继续。应从独立 Terminal 执行。

### 6.4 Linux `30141` 或 `pi-web.service` 失败

先确认没有运行中的 Agent，再检查：

```bash
./scripts/device-access.sh run linux-home -- systemctl status pi-web --no-pager
./scripts/device-access.sh run linux-home -- journalctl -u pi-web -n 100 --no-pager
./scripts/device-access.sh run linux-home -- ss -ltnp 'sport = :30141'
```

只有确认 Session 为 `0` 才能执行 `systemctl restart pi-web`。health `200` 但 unit 为 `activating (auto-restart)` 也算故障，通常是孤儿进程占住 `30141`；必须先核对 MainPID、listener PID 和 cgroup，禁止广泛杀 Node。

### 6.5 Linux 本机正常，但 Cloud `33043` 失败

检查 Linux relay 和云端 listener：

```bash
./scripts/device-access.sh run linux-home -- systemctl status pi-web-cloud-relay --no-pager
./scripts/device-access.sh run cloud-relay -- ss -ltnp 'sport = :33043'
```

确认本机 `30141` 健康且无运行任务后，再只重启 `pi-web-cloud-relay.service`。若云端残留旧 `sshd` listener，应按专用 relay 的安装/恢复流程处理；不要因一个端口故障重启整台云服务器。

### 6.6 只有手机失败，脚本全部通过

优先排查客户端状态：

1. Safari 普通标签页打开 `https://pi.ai4child.asia/login`，排除 PWA 缓存问题；
2. 刷新一次已安装 PWA，确认 Service Worker 更新到当前 `0.8.5` 资源；
3. 若手机选择的设备离线，使用离线页上的设备按钮切到在线成员；
4. 若设备目录也无法加载，检查控制面两条 relay 与云端本地恢复页，不要清除站点数据掩盖服务端故障；
5. 重新登录后再测试，不要把登录密码或 Cookie 发到聊天中。

## 7. 已遇到的问题与防复发规则

| 问题 | 表象 | 根因/证据 | 当前防护 |
|---|---|---|---|
| Mac 断网/换网导致 relay 建不起来 | 手机入口 `502` 或超时；云服务仍 active | Mac SSH 日志 `Network is unreachable`；Cloud `33041` upstream refused | LaunchAgent `KeepAlive` 自动重试；新脚本同时看本机、云端和历史摘要 |
| 云端残留旧 reverse listener | `33041` 看似 LISTEN，但 health 超时；新 SSH 报 forward failure | Mac 休眠/网络切换后旧 server-side `sshd` 停在半关闭状态 | LaunchAgent wrapper 每次重连前自动确认 health，失败时只回收 owner=`sshd` 的专用端口；管理脚本保留人工兜底 |
| Relay 自愈预检卡死 | LaunchAgent 显示 running，但 `33041` listener 缺失；父 Bash/SSH 子进程数小时不退出 | `ConnectTimeout` 不约束已建立的 SSH 会话，网络切换后父进程永久 wait | SSH `ServerAlive=10×2` + 预检 `35s` 本地 watchdog；验收必须同时看 PID 树、listener 与 health |
| Linux npm wrapper 留下孤儿 Next | health 仍绿，但 systemd `activating (auto-restart)`、新进程 `EADDRINUSE` | `npm → shell → next-server` 信号/进程归属错误 | systemd 直接管理 Node/Next，`KillMode=mixed`；验收 MainPID/listener/cgroup |
| Linux 粘性后端离线 | 旧版出现 Cloudflare `502` | 目录和 health 误跟随离线 Cookie，前端没有离线状态 | 控制面跨设备 failover；health=`503 device_offline`；离线页一键切设备，不清 Cookie |
| 在线设备被写成“离线” | 电脑和本机服务在线，但云端 relay 不通 | UI 把“网关可达性”等同于“机器在线状态”，并在后台主动轮询 | 改称“网关暂时无法连接”；启动/空闲零探针，操作失败、切换或手动重检时各检查 1 次 |
| 两端版本或签名密钥不一致 | 切换设备后 `401`、资源错配或白屏 | 同源 gateway 成员没有兼容 build 或共享认证材料 | 同 commit 构建、共享账号/签名密钥、部署后双 Cookie 路由验收 |
| 误用 Nginx Basic Auth | iOS PWA 原生弹框、无法恢复登录 | 浏览器原生 Basic Auth 与 installed PWA 不兼容 | 只用应用 `/login` + HttpOnly 签名 Cookie；Nginx 禁止 `auth_basic` |

## 8. 日常与变更后验收

日常只读检查：

```bash
./scripts/check-pi-web-cloud.sh
```

部署或认证变更后：

```bash
./scripts/check-pi-web-cloud.sh
./scripts/verify-mobile-relay.sh
./scripts/device-access.sh probe all
```

代码变更还需要：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

不要在开发期间运行 `next build`。如果只修改运维脚本/文档，至少运行 `bash -n`、`./scripts/test-device-access.sh`、`git diff --check` 和一次真实 `check-pi-web-cloud.sh`。

## 9. 回滚与安全底线

1. 云端 Nginx 安装器把备份放在 `/var/backups/pi-web/<release-id>/`，安装失败自动回滚。
2. Mac 卸载脚本只移除两个 LaunchAgent，保留 Session、日志、秘密和 build；完整说明见 [`pi-web-service.zh-CN.md`](./pi-web-service.zh-CN.md)。
3. Linux 回滚使用部署前记录的 commit 和 `.next-mobile`/依赖备份；不要用 `git reset --hard` 清理未知改动。
4. 不公开 `33041–33044`、`33101/33102`；不关闭 HostKey 校验；不放宽 `permitopen/permitlisten`。
5. 不在 Git、文档、命令参数、日志或对话里保存密码、私钥、Token、Cookie、Provider Key 和签名密钥。
6. 不用 `killall node`、`killall ssh` 或整机重启代替分层诊断。

设备管理层的完整拓扑、权限和密钥轮换见 [`device-access.zh-CN.md`](./device-access.zh-CN.md)；新增/下线设备见 [`device-onboarding.zh-CN.md`](./device-onboarding.zh-CN.md)。
