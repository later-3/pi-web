# Later Pi Web Linux 部署手册

## 目标架构

本手册用于把 `codex/later-custom` 部署到一台新的 Linux 服务器，并允许日后继续开发。示例不包含真实域名、账号、密码、Token 或私钥；这些值在目标机上手工配置。

```text
浏览器 / PWA
    │ HTTPS
    ▼
Nginx 或其他可信 TLS 代理
    │ HTTP loopback
    ▼
Next.js production 127.0.0.1:30141
    │
    ├─ ~/.pi/agent：Session、模型认证、Push 状态
    └─ 目标机上的项目目录与 Git worktree
```

部署必须满足 4 个安全条件：公网只有 HTTPS、Next.js 只监听 loopback、`PI_WEB_AUTH_REQUIRED=1`、密钥不进 Git。

## 1. 准备系统用户和依赖

以下以 Debian/Ubuntu 和专用用户 `piweb` 为例；其他发行版只需替换包管理命令。

```bash
sudo useradd --create-home --shell /bin/bash piweb
sudo install -d -o piweb -g piweb -m 0755 /opt/pi-web
sudo install -d -o piweb -g piweb -m 0700 /home/piweb/.config/pi-web
sudo install -d -o piweb -g piweb -m 0700 /home/piweb/.pi/agent

sudo apt-get update
sudo apt-get install -y git nginx curl ca-certificates
```

Node.js 必须是 `>=22.19.0`：

```bash
node --version
npm --version
```

不要让 systemd 使用只在交互 shell/nvm 中存在的 Node。执行 `command -v node` 和 `command -v npm`，把真实绝对路径用于后面的 service；若使用 nvm，优先为服务安装固定的系统级 Node，或在 unit 中写出版本目录绝对路径。

## 2. 取得私有分支

先确认目标远端确实是 private，再给 `piweb` 用户配置只读 Deploy Key 或其他最小权限凭据：

```bash
gh repo view OWNER/pi-web --json nameWithOwner,visibility,isPrivate,url
```

然后以运行用户克隆并固定自研分支：

```bash
sudo -u piweb git clone PRIVATE_REPOSITORY_URL /opt/pi-web
sudo -u piweb git -C /opt/pi-web switch codex/later-custom
sudo -u piweb git -C /opt/pi-web status --short --branch
```

若目标机还要继续开发，另行配置签名身份、可写 Git 凭据和 worktree 根目录；运行服务本身不应获得超出仓库所需的 Git 权限。

## 3. 安装依赖和构建

production 使用 `.next-mobile/`，避免污染本地开发的 `.next/`：

```bash
sudo -u piweb bash -lc 'cd /opt/pi-web && npm ci'
sudo -u piweb bash -lc 'cd /opt/pi-web && npm run build:mobile'
```

约束：

1. 开发服务器运行时不要执行普通 `npm run build` / `next build`。
2. `npm run build:mobile` 只在发布/部署阶段执行。
3. 当前布局使用 `next/font`；首次构建若被严格断网环境阻断，应先提供受控出站访问或把字体改成本地资产，不能跳过失败继续启动旧产物。
4. `npm audit` 报告要单独评估；不要直接运行可能引入破坏性升级的 `npm audit fix --force`。

## 4. 创建认证和运行配置

账号文件由人手工编辑，避免密码出现在 shell history：

```bash
sudo -u piweb editor /home/piweb/.config/pi-web/credentials.json
sudo -u piweb chmod 600 /home/piweb/.config/pi-web/credentials.json

sudo -u piweb openssl rand -hex 32 \
  > /home/piweb/.config/pi-web/session-secret
sudo -u piweb chmod 600 /home/piweb/.config/pi-web/session-secret
```

`credentials.json` 结构：

```json
{
  "credentials": [
    { "username": "手工填写", "password": "手工填写" }
  ]
}
```

创建 `/home/piweb/.config/pi-web/pi-web.env`，权限 `600`：

```dotenv
NODE_ENV=production
PI_WEB_DIST_DIR=.next-mobile
PI_WEB_HOSTNAME=127.0.0.1
PI_WEB_ALLOWED_HOSTS=pi.example.com
PI_WEB_AUTH_REQUIRED=1
PI_WEB_AUTH_CREDENTIALS_FILE=/home/piweb/.config/pi-web/credentials.json
PI_WEB_AUTH_SESSION_SECRET_FILE=/home/piweb/.config/pi-web/session-secret
PI_WEB_AUTH_SESSION_DAYS=30
PI_CODING_AGENT_DIR=/home/piweb/.pi/agent
PI_WEB_PUSH_SUBJECT=mailto:admin@example.com
PI_WEB_DEVICE_ID=linux-home
PI_WEB_DEVICE_NAME=Home Linux
PI_WEB_PUBLIC_URL=https://linux.example.com
PI_WEB_DEVICE_GATEWAY_URL=https://pi.example.com
PI_WEB_DEVICES_FILE=/home/piweb/.config/pi-web/devices.json
NO_PROXY=localhost,127.0.0.1
```

多设备目录可从 [`deploy/devices.example.json`](../deploy/devices.example.json) 复制到 `/home/piweb/.config/pi-web/devices.json`，再写入实际设备的非敏感 `id/name/url`。文件权限建议 `600`；真实密码和密钥不属于该目录。只有一台设备时可以省略全部 `PI_WEB_DEVICE_*` 与 `PI_WEB_DEVICES_FILE`，UI 会自动保持原来的单机模式。

独立直连部署可以为每台机器生成不同的 `session-secret`。加入同一个 `PI_WEB_DEVICE_GATEWAY_URL` 后，各网关成员必须通过受保护通道分发同一份账号文件和 `session-secret`，否则切换设备后原登录 Cookie 会变成 `401`。不要把共享密钥写入 Git、命令参数、日志或设备目录；权限保持 `600`。Session、项目、Provider/OAuth、Push store 和 Agent 进程仍然各自留在设备上。

若模型请求需要代理，再加入 `HTTP_PROXY`/`HTTPS_PROXY`。Provider API key、OAuth 和模型配置保存在运行用户的 Pi agent 目录中，可通过受保护的 Web UI 配置或从旧机器安全迁移；不要写进仓库或 systemd unit。

## 5. 安装 systemd 服务

创建 `/etc/systemd/system/pi-web.service`：

```ini
[Unit]
Description=Later Pi Web
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=piweb
Group=piweb
WorkingDirectory=/opt/pi-web
EnvironmentFile=/home/piweb/.config/pi-web/pi-web.env
ExecStart=/usr/bin/npm run start:mobile
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
UMask=0077

[Install]
WantedBy=multi-user.target
```

把 `/usr/bin/npm` 替换为 `command -v npm` 的真实绝对路径。启动并验证：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pi-web
sudo systemctl status pi-web --no-pager
sudo journalctl -u pi-web -n 100 --no-pager
curl --fail --silent http://127.0.0.1:30141/api/health
```

## 6. 配置 HTTPS 反向代理

Nginx 关键配置如下；证书可由 Certbot、Cloudflare Tunnel 或现有平台提供：

```nginx
server {
    listen 443 ssl http2;
    server_name pi.example.com;

    # ssl_certificate /path/to/fullchain.pem;
    # ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:30141;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Authorization "";

        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

不要配置 `auth_basic`：PWA 使用应用内 `/login` 和签名 Cookie。代理必须保留 `Host` 与 `X-Forwarded-Proto=https`，否则 Host 安全检查或 Secure Cookie 会失败。

```bash
sudo nginx -t
sudo systemctl reload nginx
curl --fail --silent https://pi.example.com/api/health
curl --silent --head https://pi.example.com/login
```

外网响应不应含 `WWW-Authenticate: Basic`。

## 7. 首次验收

至少完成以下 10 项：

1. `systemctl is-active pi-web` 返回 `active`。
2. loopback 与公网 `/api/health` 均返回 `status=ok`。
3. 未登录访问受保护页面会跳转 `/login`。
4. 登录成功后刷新、关闭重开 PWA 均符合“保持登录”选择。
5. 退出后旧 Cookie 不再可用。
6. 新建 Session、发送消息、SSE 流式输出、停止与继续均正常。
7. 历史 Session、文件查看和 worktree 只访问预期目录。
8. 安装 PWA 后图标、主题、安全区和键盘布局正常。
9. 用户主动开启通知后收到测试 Push 和一次真实完成 Push。
10. 重启服务器后 Pi Web 自动恢复，Session 文件仍在。
11. 配置同源网关时，`/api/devices` 返回 `selectionMode=gateway`；同一登录态切到目标设备后 URL 不变、认证仍有效、`X-Pi-Web-Device` 与目标 id 一致，并能切回主设备。

Linux 上没有仓库内的 macOS LaunchAgent/SSH relay，`scripts/manage-pi-web.sh` 不适用；使用 `systemctl`、`journalctl` 和本手册的健康检查。

## 8. 更新、回滚和备份

更新前先在开发机按 [维护手册](./maintenance-playbook.zh-CN.md) 合入上游并验证，再把已提交版本推到私库。服务器只部署明确 commit：

```bash
sudo systemctl stop pi-web
sudo -u piweb git -C /opt/pi-web fetch origin --prune --tags
sudo -u piweb git -C /opt/pi-web switch codex/later-custom
sudo -u piweb git -C /opt/pi-web pull --ff-only origin codex/later-custom
sudo -u piweb bash -lc 'cd /opt/pi-web && npm ci && npm run build:mobile'
sudo systemctl start pi-web
curl --fail --silent http://127.0.0.1:30141/api/health
```

记录部署前 commit；失败时切回它、重新 `npm ci` + `build:mobile`，再启动。不要在服务器上用 `git reset --hard` 清理未知改动；若工作区不干净，先停下并查明来源。

备份至少包含：

- `/home/piweb/.pi/agent/`（Session、模型配置、Push store）；
- `/home/piweb/.config/pi-web/`（加密备份，严格限制访问）；
- 需要继续开发的项目仓库与未推送分支。

`.next-mobile/`、`node_modules/` 和日志可重建，不应替代源码 commit 与配置备份。

通过局域网 SSH 部署第二台真实机器的探测、安装、隧道和验收分层见 [多设备 ADR 第 10 节](./multi-device-architecture.zh-CN.md#10-通过局域网-ssh-部署第二台机器)。

## 9. 首台 Pop!_OS 实机记录

2026-07-30 已在一台 Pop!_OS 24.04 LTS 工作站完成第一次实机部署：

| 项目 | 验证值 |
|---|---|
| 主机/架构 | `pop-os` / x86_64 / Linux 6.18.7 |
| 资源 | 32 CPU、62 GiB 内存、227 GiB 可用磁盘 |
| Node/npm/Git | `22.22.2` / `10.9.7` / `2.43.0` |
| 固定源码 | `codex/later-custom@535925d` |
| 运行用户/目录 | `later` / `/home/later/Code/pi-web` |
| 服务 | `pi-web.service`、`pi-web-cloud-relay.service` + Nginx，均 enabled/active |
| 监听 | Next `127.0.0.1:30141`；LAN Nginx `:80`；云端 relay/Nginx `33043/33044` |
| 设备元数据 | `linux-home / Pop!_OS`，目标目录共 2 台设备 |

该机器同时是用户工作站，需要访问其项目目录，因此没有创建隔离的 `piweb` 用户；systemd 仍启用 `NoNewPrivileges`、`PrivateTmp` 和 `UMask=0077`。通用服务器继续优先使用前文的专用用户模型。

用户正式入口是 `https://pi.ai4child.asia`：云端主入口 Nginx 根据 `pi_web_device` 把整条请求粘性路由到 Mac `33041` 或 Pop!_OS `33043`。`https://linux.ai4child.asia` 是 Linux 物理直连/故障排查入口，`http://192.168.1.68` 只保留为可信 LAN fallback，二者都不用于日常手机切换。Pop!_OS 的受限 systemd SSH tunnel 把本机 `30141` 转到云服务器 loopback `33043`；云端使用无 shell 的专用 `piweb-linux-relay` 用户，Key 仅允许监听该端口。

实机完成了以下自动验收：

1. `.next-mobile` production build 成功并包含 `/api/devices`。
2. loopback 与 LAN health 均返回 `status=ok`。
3. 未登录根路径重定向 `/login`，受保护 API 返回 `401`。
4. 登录、Cookie 会话、登出均返回 `200`。
5. 主入口返回 `selectionMode=gateway`；同一登录 Cookie 下完成 `mac-main → linux-home → mac-main`，所有 API/health 均为 `200` 且 URL 不变。
6. Cloudflare 两个边缘 IP 的 TLS 校验与 health 均为 `200`，公网登录、Cookie、登出均通过。
7. `systemctl restart pi-web` 与主动重启 reverse tunnel 后均自动恢复，journal 无 warning/error。
8. Mac production/SSH relay/Nginx/Cloudflare 全链路重新安装并通过完整验证脚本；未知设备 Cookie 自动回退 `mac-main`。

尚未完成的项目是手机 Safari/installed PWA 的菜单手感与运行中切换验收、远端模型凭据、SSE 实际推理、目标离线回切和双设备 Push；这些不应由服务端 HTTPS 探针冒充已经通过。
