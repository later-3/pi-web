# Pi Web Later 分支状态

> 这是随仓库更新的“当前事实页”，不是永久设计说明。每次合入上游、完成重要功能或部署后都要更新。

## 2026-07-31 基线

| 项目 | 当前值 |
|---|---|
| 开发分支 | `codex/later-custom` |
| Later 远端 | `origin = https://github.com/later-3/pi-web.git`，GitHub 可见性 `PRIVATE` |
| 上游仓库 | `upstream = https://github.com/agegr/pi-web.git` |
| 已合入上游 | `upstream/main@cbb080d`，发布版本 `0.8.5` |
| 上游合并提交 | `422194f` |
| Pi SDK | `0.83.0` |
| Node.js 下限 | `22.19.0` |
| 当前验证 | TypeScript、ESLint、`302/302` Node tests、移动 UI `44/44` 静态检查通过；公网登录、双 tunnel、同源 `mac-main → linux-home → mac-main` 路由与两端模型 API 通过 |
| 生产构建目录 | `.next-mobile/`，与开发 `.next/` 隔离 |

## 当前自研能力

1. Mac production + SSH 反向隧道 + Nginx/Cloudflare 的单后端手机访问。
2. PWA 安装、离线提示、版本化静态缓存和 iOS 安全区适配。
3. 应用内多账号登录、签名 HttpOnly Cookie、会话过期恢复。
4. Agent 完成后的 Web Push、订阅验证和失效订阅清理。
5. 移动端 Session/工作区导航、键盘视口修正和设置面板布局。
6. Extension 全局/Session 开关与 Provider Request 结构化查看。
7. Chat 执行转录只读浏览、受保护的 Session/文件访问与运行状态恢复。
8. production/relay 安装、启停、日志和端到端验证脚本。
9. 多设备身份、受限 JSON 目录、同源粘性网关，以及桌面/手机在一个 React 工作区内无整页刷新地切换执行设备。

完整入口见 [自研功能与配置清单](./docs/later-customizations.zh-CN.md)。

## 2026-07-31 双设备部署记录

| 项目 | 当前事实 |
|---|---|
| 第二台设备 | `pop-os`，Pop!_OS 24.04 LTS，x86_64 |
| 部署 commit | `422194f`（Mac 与 Pop!_OS production artifact，Pi Web v0.8.5） |
| 运行环境 | Mac Node `24.8.0` / npm `11.6.0`；Pop!_OS Node `22.22.2` / npm `10.9.7`；Nginx `1.24.0` |
| 代码与数据 | `/home/later/Code/pi-web`、`/home/later/.pi/agent` |
| 服务 | `pi-web.service`、`pi-web-cloud-relay.service` 与 Nginx 均为 `enabled + active` |
| 用户入口 | 唯一 PWA/手机入口 `https://pi.ai4child.asia`；设备菜单在同一 origin 内切换 Mac/Linux 后端 |
| 物理入口 | Linux 直连 `https://linux.ai4child.asia` 与 LAN `http://192.168.1.68` 仅作部署验收/故障回退；Next.js 仅监听 loopback |
| 设备身份 | `linux-home / Pop!_OS`，与 `mac-main / Main Mac` 互相可见 |
| 凭据边界 | 网关成员共享应用登录账号和 Cookie 签名密钥；两端模型 API 均返回 19 个模型，Session、项目、默认模型选择、Push 与 Agent 仍各自留在本机 |
| 验证证据 | 本次升级后两端 health、双隧道、2 个应用账号、公网登录与 Nginx/Cloudflare 均通过；同一公网 origin 完成 `mac-main → linux-home → mac-main`，payload 与 `X-Pi-Web-Device` 每次一致；上一版 390×844 无刷新视觉/工作区验收仍为 UI 基线 |

Mac 与 Pop!_OS 均运行 Later 私有分支 `422194f` 的 `.next-mobile` production artifact，不是上游原版。两端从相同精确 commit 的隔离 detached worktree 构建：Mac build id `Iy1zpmx2ukPpnD9pVM-aA`，Pop!_OS build id `PhQmAHiIOiLVMC33yUUtR`。Mac 回滚产物为 `.next-mobile-backup-pre-422194f-20260731T005244Z`；Linux 回滚产物与依赖分别为 `.next-mobile-backup-pre-422194f-20260731T005009Z`、`node_modules-backup-pre-422194f-20260731T005009Z`。Linux unit 已改为 systemd 直接管理 Node/Next；MainPID、`30141` 监听 PID 与 `/system.slice/pi-web.service` cgroup 一致，确认 0 个运行 Session 后的真实 restart 为 52ms。云服务器 facts 明确为 `pi_web=not-installed`，因此不构建应用，只验证 Nginx、Cloudflare 和 `33041/33043` 两个 loopback tunnel。云端 Nginx 根据 HttpOnly `pi_web_device` Cookie 将设备数据面粘性路由到 Mac 或 Linux，同时把页面壳、静态资源、应用认证与设备选择控制面固定到 Mac。

## 已解决的仓库风险

2026-07-30 已将 `later-3/pi-web` 从 PUBLIC 改为 **PRIVATE**，并用 GitHub API 验证 `isPrivate=true`。每次推送 Later-only 工作前仍要复核：

```bash
gh repo view later-3/pi-web --json nameWithOwner,visibility,isPrivate,url
git remote -v
```

Private 只解决仓库访问范围，不替代秘密管理。`deploy/secrets/`、`.env*`、密码、Cookie、Token、API Key、VAPID 私钥和会话签名密钥继续由 `.gitignore` 排除；仓库只保存配置模板、变量名、安装脚本和操作说明。

## 当前待办与风险

### P1：上游生产依赖仍有 4 个 High 审计项

2026-07-30 的 `npm audit --omit=dev` 显示：Pi SDK 子树的 `brace-expansion@5.0.7` 命中 DoS 公告；Next `16.2.12` 内嵌的 PostCSS `8.4.31` 和 sharp `0.34.5` 也命中公告，并将 `next` 一并计为 High。npm 给出的 `--force` 方案会错误地降到 Next 9，不能采用。`brace-expansion@5.0.8` 虽已发布，但 npm 的嵌套 override 实验未改变实际依赖树，Bun 也不支持同一写法，因此没有保留“表面修复”。这些项必须等待 Pi SDK/Next 或主仓的兼容升级，并在部署前重新审计。

### P2：Linux 模型配置已验收，完整任务与 Push 待真机持续验证

Pop!_OS 目标机的 Node 路径、systemd、Nginx、认证、设备目录、受限 SSH reverse tunnel、Cloudflare ingress/DNS/TLS 与服务重启已验证。2026-07-30 已通过 SSH 加密通道同步 Mac 的 Pi Provider/模型目录：4 个 Provider、19 个模型，配置文件权限均为 `600`，无 Mac 绝对路径；2026-07-31 两端公网模型 API 仍各返回 19 个模型。默认模型属于设备本地使用状态，当前 Mac 为 `dashscope-coding/qwen3-max-2026-01-23`，Linux 为 `volcengine-ark/deepseek-v4-pro`，不再把一次同步时的默认值写成永久不变量。每个 Provider 的代表模型均完成真实最小推理并返回上游 `200`；完整 Session/SSE 任务与该设备的 Web Push 仍需真机持续验收。

### P3：每日检查同时看两条版本线，但不自动合并

运行 `./scripts/check-upstream.sh` 会抓取并报告 Pi Web 主仓差异，同时比较 4 个 `@earendil-works/pi-*` 固定版本与 npm stable latest，但不会改分支、manifest 或 lockfile。Pi 源码 `main` 的未发布提交只作为研究，不作为升级候选。自动合并容易在 PWA、认证、模型、依赖锁、移动 CSS 和部署脚本上静默覆盖自研行为，因此合并必须按 [维护与故障案例手册](./docs/maintenance-playbook.zh-CN.md) 人工验收；两条版本线规则见 [上游版本审计](./docs/upstream-version-audit.zh-CN.md)。

### P4：同源无刷新双设备闭环已完成，运行态仍需真机持续验收

[多设备 ADR](./docs/multi-device-architecture.zh-CN.md) 的同源入口、设备选择 API、HttpOnly 路由 Cookie、Nginx 白名单粘性路由、共享应用登录和两台真实设备已完成服务端与 390×844 浏览器验收。切换不再重载 document；旧设备 EventSource/fetch 通过 React unmount 清理，路由探针失败会回滚原设备，目标设备恢复自己的工作区快照。Safari/installed PWA 仍需用户真机体验；运行中切换、Linux 离线时回切和跨设备 Push 仍需持续验收。手机交互审计与待审核方案见 [移动端 UX 审计](./docs/mobile-ux-audit-2026-07-30.zh-CN.md)。

### P5：Linux 活跃 Session 后的优雅重启需要补强

同步模型配置后的 `systemctl restart pi-web` 在此前出现过 `session_start` 的进程上达到 `TimeoutStopSec=30`；部署 `510d6c4` 与 `422194f` 时均在确认运行 Session 为 0 后再次复现。`422194f` 的进一步证据表明旧 `npm → shell → next-server` wrapper 可留下占用 `30141` 的孤儿进程，使 health 仍为 200，而 systemd 因 `EADDRINUSE` 停在 `activating (auto-restart)`。服务模板现改为 systemd 直接管理 Node/Next CLI，并用 `KillMode=mixed` 回收超时后的同 cgroup 子进程；应用后空闲真实 restart 为 52ms，unit/MainPID/端口/cgroup 全部一致。当前未发现 Session 文件损坏；仍需把“活跃任务自然结束后停止”和 relay 恢复加入持续回归，部署验收必须同时检查 health、unit=active 与端口 cgroup。

## 2026-07-31 跨设备管理与环境归档

| 项目 | 当前事实 |
|---|---|
| 事实清单 | `ops/device-inventory.json`；归档 Mac、Pop!_OS、云服务器的账号、OS/架构、IP 观察值、路径、认证方式、公钥指纹和约束，不含秘密 |
| 管理入口 | `later-device` / `scripts/device-access.sh`；设备 id 为 `mac-main`、`linux-home`、`cloud-relay` |
| 跨网路径 | 每台设备 1 条出站 reverse SSH relay；云端 `33101/33102` 仅监听 `127.0.0.1`，通过无 Shell 的 `later-mesh` 受限转发 |
| 持久服务 | Mac `com.later.device-relay` LaunchAgent；Pop!_OS `later-device-relay.service` user systemd，`Linger=yes` |
| 认证边界 | 每台设备独立 ED25519 管理 key 与 relay key；系统交互密码未读取、未写入 Git，SSH 管理不依赖密码 |
| 云 SSH | `PasswordAuthentication no`、`KbdInteractiveAuthentication no`、`PermitRootLogin prohibit-password`；password-only 负向测试被拒 |
| 验证证据 | 3 个来源 × 3 个目标：`9/9` 登录、`9/9` 临时写入/校验/删除；双 relay 强制重启后恢复；公网端口、Shell 与越权转发负向测试通过 |
| Pi Web 回归 | `manage-pi-web.sh status` 与 `verify-mobile-relay.sh` 全部通过；原 `33041/33043` HTTP 隧道未修改 |

### 2026-07-31 可交接增强

1. Inventory 升级为 schema v2，明确 `relay/direct` 路由、relay user/port/key 指纹、bastion 和默认 SSH 参数；`ops/device-inventory.schema.json` 是机器可读契约。
2. 5 个 management/relay **公钥**进入 `ops/device-public-keys/`，`later-device check` 会核对实际 SHA256 指纹；私钥继续只留设备本机。
3. `render-device-ssh-config.sh` 从 inventory 确定性生成所有 Host blocks；新增第三台 relay 设备无需改 SSH/cloud 安装代码。生成快照漂移、重复 id/alias/port/user 会失败。
4. 云端安装改为 inventory 驱动的动态 `permitopen/permitlisten`，apply 前支持 `--plan`，替换 key 前备份到 `/var/backups/later-device-access/`，只管理 root `authorized_keys` 中带标记的 block。
5. CLI 新增 `topology`、`facts all`、`audit all`，并修复复杂 `run ... -- bash -lc '...'` 的远端参数边界；新增 client、relay、key prepare、授权、撤销和 host-key 固定脚本。
6. 新增 [设备新增/下线/密钥轮换手册](./docs/device-onboarding.zh-CN.md)，主手册补齐 Terminal、Pi 对话、架构、信任边界、端口、排障、规模阈值与验收矩阵。
7. Mac 实时 LAN 地址已变为 `172.20.10.10`，旧 `192.168.31.238` 归档为历史动态地址；从当前 Mac 网络直连 Pop `192.168.1.68` 超时，但 cloud relay 全程正常，验证管理链路不依赖 LAN。
8. 真实验收：3 个来源 × 3 个目标 `9/9` 登录和 `9/9` 写入/校验/删除；双 relay 强制重连恢复；公网端口、bastion Shell、越权转发均失败；Mac、Pop、Cloud 各自 `14/14` 离线测试通过。

完整操作、回滚和风险见 [多设备访问与环境归档](./docs/device-access.zh-CN.md)。工作区级 `AGENTS.md` 已部署到 Mac `/Users/xulater/Code` 与 Pop!_OS `/home/later/Code`，以后在任意子项目的 Pi 中都应先用 `later-device facts` 定位目标，再执行配置。

## 下一次更新本文件时至少记录

1. 日期、上游 commit/tag 和对应 merge commit。
2. 类型检查、Lint、测试通过数量。
3. 新增/删除的自研能力和配置项。
4. 部署环境、回滚点与未解决风险；不得写入密码、Token、私钥或 Cookie。
