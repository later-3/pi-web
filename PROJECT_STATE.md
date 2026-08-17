# Pi Web Later 分支状态

> 这是随仓库更新的“当前事实页”，不是永久设计说明。每次合入上游、完成重要功能或部署后都要更新。

## 2026-08-17 基线

| 项目 | 当前值 |
|---|---|
| 开发分支 | `codex/later-custom` |
| Later 远端 | `origin = https://github.com/later-3/pi-web.git`，GitHub 可见性 `PRIVATE` |
| 上游仓库 | `upstream = https://github.com/agegr/pi-web.git` |
| 已合入上游 | `v0.8.9@2a6e537` |
| 上游合并提交 | `de20207` |
| Pi runtime 来源 | 唯一源码为 `/Users/xulater/Code/opc-os/pi@1f2b9ff53c0a` / package `0.84.2`；Pi Web 的 7 个第一方 runtime 包全部显式绑定该 workspace，registry SDK 无回退。Mac production 已部署，Linux 尚未部署 |
| Node.js 下限 | `22.19.0` |
| 当前验证 | Pi Web TypeScript、ESLint、`687/687` Node tests、npm audit `0`、npm 冷安装隔离 production build/health、Bun frozen install 与 `git diff --check` 通过；OPC Pi `npm run check`、`build:offline`、`./test.sh` 与 npm audit `0` 通过 |
| 生产构建目录 | `.next-mobile/`，与开发 `.next/` 隔离 |
| Mac production | commit `20e322d`（Pi Web `0.8.9` / Next.js `16.3.1` / OPC Pi `1f2b9ff53@0.84.2`），build id `6zM5m2IYenLTaiwcbOyu9`，2026-08-18 已部署 |

## 2026-08-07 Cloudflare Tunnel 应急直连

1. `09:00 CST` 起公网入口返回 Cloudflare `1033`。Mac Pi Web `30141`、Mac SSH HTTP relay `33041`、云端 Nginx `33042` 均为 `200`；直接故障是云服务器到多个 Cloudflare Edge 的 TCP/UDP `7844` 连接持续超时。云主机 CPU、内存、conntrack、网卡和 qdisc 正常且无丢包，Cloudflare 配置与 systemd unit 没有同期修改；另一个 PWA 的请求量不足以造成拥塞。
2. 单独重启云端 `cloudflared`、依次测试 `http2`、`quic` 与 `auto` 后，连接仍在 `0–3/4` 之间抖动并产生 `530/502`。云端原 HTTP/2 配置备份为 `/etc/cloudflared/config.yml.pre-quic-20260807T0937`，QUIC 中间配置备份为 `/etc/cloudflared/config.yml.pre-auto-20260807T0940`；当前云端配置为 `auto`，`cloudflared.service` 已 `disabled + inactive`，避免坏连接器参与边缘路由。
3. 手机主入口临时切为 Mac 直连同一 named tunnel：LaunchAgent 为 `~/Library/LaunchAgents/com.later.pi-web.cloudflare-direct.plist`，入口直接转发到 `127.0.0.1:30141`。本机配置位于 gitignored 的 `deploy/state/cloudflared-mac-direct.yml`，tunnel 凭据位于 gitignored 的 `deploy/secrets/cloudflared-pi-web-mac.json` 且权限为 `600`。Linux 直连在该应急配置中明确返回 `503`，不伪装成 Mac。
4. 恢复验收：Mac connector `4/4` HA、request errors=`0`；公网 `/login` 并发 `20/20` 返回 `200`，公网 `/api/health` 并发 `20/20` 返回 `200`；`verify-mobile-relay.sh` 的本机、云端 loopback、两个应用账号公网登录与受保护 root 全部通过。
5. 这是可回滚的单设备应急拓扑。云服务器到 Cloudflare `7844` 恢复稳定后，应先在云端验证连续连接与公网成功率，再启用云端 connector；确认切回后用 `launchctl bootout gui/501/com.later.pi-web.cloudflare-direct` 下线 Mac 直连，不能让两套不同 ingress 的 connector 长期并存。

## 当前自研能力

1. Mac production + SSH 反向隧道 + Nginx/Cloudflare 的单后端手机访问。
2. PWA 安装、离线提示、版本化静态缓存和 iOS 安全区适配。
3. 应用内多账号登录、签名 HttpOnly Cookie、会话过期恢复。
4. Agent 完成后的 Web Push、订阅验证和失效订阅清理。
5. 移动端全屏工作区浏览器、Session/文件双页签、逐级目录导航、键盘视口修正和设置面板布局。
6. Extension 全局/Session 开关与 Provider Request 结构化查看。
7. Chat 执行转录只读浏览、受保护的 Session/文件访问与运行状态恢复。
8. production/relay 安装、启停、日志和端到端验证脚本。
9. 多设备身份、受限 JSON 目录、同源粘性网关，以及桌面/手机在一个 React 工作区内无整页刷新地切换执行设备。
10. OPC OS Pi 唯一源码绑定：Pi Web 的本地 Pi 依赖、开发和 production 启动都必须解析到相邻 `opc-os/pi` workspace；源码 Git 指纹、构建摘要或链接不一致时 fail closed。

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

### P1：Pi Web 与 OPC Pi 生产依赖仍有 High 审计项

2026-08-17 的 `npm audit --omit=dev` 显示：Pi Web lockfile 为 `5` 个 High 节点（`next`/`postcss`/`sharp`、`nanoid`、直接依赖 `undici`）；OPC Pi 当前源码 lockfile 为 `3` 个 High 节点（`brace-expansion`、`shell-quote`、直接依赖 `undici`）。两边存在同类公告，不能把 `5+3` 当成 8 个互不相同的漏洞。npm 给出的不兼容 `--force` 方案不能采用；Pi `v0.84.x` 与 Pi Web `v0.8.9` 已包含多项依赖安全更新，但合并后仍必须分别重新审计，不能只凭 changelog 宣布清零。

### P2：Linux 模型配置已验收，完整任务与 Push 待真机持续验证

Pop!_OS 目标机的 Node 路径、systemd、Nginx、认证、设备目录、受限 SSH reverse tunnel、Cloudflare ingress/DNS/TLS 与服务重启已验证。2026-07-30 已通过 SSH 加密通道同步 Mac 的 Pi Provider/模型目录：4 个 Provider、19 个模型，配置文件权限均为 `600`，无 Mac 绝对路径；2026-07-31 两端公网模型 API 仍各返回 19 个模型。默认模型属于设备本地使用状态，当前 Mac 为 `dashscope-coding/qwen3-max-2026-01-23`，Linux 为 `volcengine-ark/deepseek-v4-pro`，不再把一次同步时的默认值写成永久不变量。每个 Provider 的代表模型均完成真实最小推理并返回上游 `200`；完整 Session/SSE 任务与该设备的 Web Push 仍需真机持续验收。

### P3：每日检查同时看两条版本线，但不自动合并

运行 `./scripts/check-upstream.sh` 会抓取并报告 Pi Web 主仓差异，同时比较 4 个 `@earendil-works/pi-*` 固定版本与 npm stable latest，但不会改分支、manifest 或 lockfile。Pi 源码 `main` 的未发布提交只作为研究，不作为升级候选。自动合并容易在 PWA、认证、模型、依赖锁、移动 CSS 和部署脚本上静默覆盖自研行为，因此合并必须按 [维护与故障案例手册](./docs/maintenance-playbook.zh-CN.md) 人工验收；两条版本线规则见 [上游版本审计](./docs/upstream-version-audit.zh-CN.md)。

### P4：同源无刷新双设备闭环已完成，运行态仍需真机持续验收

[多设备 ADR](./docs/multi-device-architecture.zh-CN.md) 的同源入口、设备选择 API、HttpOnly 路由 Cookie、Nginx 白名单粘性路由、共享应用登录和两台真实设备已完成服务端与 390×844 浏览器验收。切换不再重载 document；旧设备 EventSource/fetch 通过 React unmount 清理，路由探针失败会回滚原设备，目标设备恢复自己的工作区快照。2026-08-01 已补控制面跨设备故障转移、结构化不可达响应和一键切换；2026-08-02 取消启动/空闲 health 轮询，改为操作失败、显式切换和手动重检时各检查 1 次，并为 Mac HTTP relay 部署自动清理残留 listener 的自愈 wrapper。Linux 当前不可达，恢复后仍需部署同一兼容 build 并完成反向故障转移真机验收。手机交互审计见 [移动端 UX 审计](./docs/mobile-ux-audit-2026-07-30.zh-CN.md)。

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

## 2026-07-31 手机入口中断诊断与检查固化

1. 用户报告手机无法访问时，云端 `nginx` 与 `cloudflared` 均为 `active`、`NRestarts=0`，`nginx -t` 通过；Linux `pi-web`/relay/Nginx 正常。
2. 云端 Nginx 在 `11:19–11:34 CST` 明确记录到 Mac upstream `127.0.0.1:33041` 拒绝连接；Mac relay 日志同期连续出现 `Network is unreachable`，LaunchAgent 自动重试后恢复。直接故障点是 Mac 到云端的 SSH HTTP reverse tunnel，不是云服务器服务退出。
3. 恢复后新增检查脚本实测 `27/27` 通过：Cloud `33041/33042/33043/33044`、Mac/Linux 本机 `30141`、公网默认/Mac/Linux/未知 Cookie 路由均返回 `200`；云端 4 个服务端口继续只绑定 loopback。
4. 新增只读入口 `scripts/check-pi-web-cloud.sh`，一次检查 inventory、两端 production/relay、Linux systemd 进程归属、云服务、端口 owner、四级 health 和公网粘性路由；不读取登录秘密、不修改配置、不自动重启。
5. 新增 [云端网关检查、部署与故障手册](./docs/pi-web-cloud-operations.zh-CN.md)，归档当前架构、服务所有权、全部相关端口、实际部署方法、本次证据、历史故障与安全恢复顺序。

## 2026-08-01 离线设备不再拖垮入口

1. 事故事实：`linux-home` 的 HTTP relay `33043`、管理 relay `33102` 和两个已知 LAN 地址同时不可达；手机保留 `pi_web_device=linux-home` 后，旧网关把 `/api/devices`、health 和数据 API 的原始 `502` 透给 PWA。Mac、云端 Nginx、cloudflared 和 `33041` 本身在线。
2. 架构修复：页面、静态资源、应用登录、`/api/devices` 与 `/api/devices/select` 改走 `pi_web_control` upstream，Mac `33041` 为 primary、Linux `33043` 为 backup；任一兼容设备在线即可承载控制面，两端都离线时由云端 Nginx 自己返回恢复页。
3. 数据安全：Session、Agent、文件等执行面仍严格按 HttpOnly 设备 Cookie 粘性路由，禁止把离线设备的请求静默转到另一台机器；仅 `/api/health` 将连接级 `502/504` 转为 `503 {error:"device_offline", deviceId}`。
4. UI 修复（当时实现，已在 2026-08-02 被按需检测替代）：启动前探测所选设备，随后每 5 秒及 `online/visibilitychange` 复查；离线时显示恢复界面，切换失败回滚原 Cookie。
5. 生产部署：Mac build id `IdYqtapIsO7Tj9UJxqmMr`，旧产物备份 `.next-mobile-backup-pre-device-failover-20260801T064857Z`；云端 Nginx release `20260801T065252Z`。陈旧 `33041` sshd listener 已定向回收，新 `com.later.pi-web.cloud-relay` 为 `runs=1`、当前进程持有。
6. 真实验收：保留 Linux Cookie 的已登录公网请求得到 root `200`、directory `200/current=linux-home`、health `503/device_offline`；选择 Mac 返回 `200`，随后 Mac health `200`。TypeScript、ESLint、Nginx parser 和显式 `.test.mjs` `308/308` 通过。
7. 待办：Linux 仍物理离线，当前保留上一 build。恢复联网后必须部署同一兼容版本，再做 `Mac offline → Linux control plane → 显示/切换` 的对称真机验收。

## 2026-08-02 从轮询去抖改为按需连接判断

1. 交互根因：原前端启动探测并每 5 秒轮询，先后经历“单样本翻转”和“3 次失败/2 次恢复”的迟滞方案。迟滞只能降低误报，仍会在用户阅读或输入时用后台状态替换整个工作区，且把“云端 relay 不可达”错误写成“物理设备离线”。
2. 本次实证：用户看到 `Main Mac is offline` 时，Mac 本机 `30141 health=200`；云端 `33041 health=000`，HTTP relay LaunchAgent 已 `runs=558`，日志持续为 `remote port forwarding failed for listen port 33041`。Mac 和 Pi Web 没有关机，真正故障是云端残留的 `sshd` reverse listener 阻止新隧道建立。
3. 产品机制：启动和空闲 health 探针均为 0。健康发送直接执行，不做预检；只有发送或 SSE 建连失败后补做 1 次 health 判断。设备切换和“重新检测”按钮也各做 1 次，不自动重试。确认后文案为“网关暂时无法连接，设备本身可能仍在线”；普通应用 `503` 与浏览器自身断网不冒充设备不可达。
4. Relay 自愈：新增 `scripts/run-pi-web-cloud-relay.sh` 并替换 Mac HTTP relay LaunchAgent。每次重连前保留仍健康的 listener；连续 health 失败时只回收 owner=`sshd` 的专用 `33041` listener，再 `exec ssh`。当前 HTTP relay PID `48227`、`runs=1`；同类残留的 Mac 管理 relay `33101` 已定向恢复，device-access probe 通过。
5. 生产部署：Mac build id `jJfOKdo__rBFBSpB6xUz2`，旧 build `1_SQOzCGm7VQ1JzKEHqWa` 保存在 `.next-mobile-backup-pre-on-demand-device-check-20260802T053508Z`；production PID `57712`、`runs=1`，`30141` listener 与 PID 一致。HTTP relay 原 plist 备份为 `~/Library/LaunchAgents/com.later.pi-web.cloud-relay.plist.pre-self-healing-20260802T053008Z`。
6. 验证证据：TypeScript、ESLint、shell syntax 与显式 `.test.mjs` `313/313` 通过；候选 build 先在 `30142` 完成登录、目录、运行任务和 health 验证，确认正式运行任务为 0 后原子切换。公网已登录 root=`200` 且引用新 chunk，directory=`200/current=mac-main`、Mac health=`200 online`、Linux health=`503 device_offline`。
7. 当前外部状态：全链路 `22` 项中 Mac、云端 Nginx、cloudflared、控制面和公网 Mac 路由均通过；`4` 个失败与 `1` 个警告只对应仍不可达的 Linux 管理/HTTP relay、直连和 Linux Cookie。Linux 恢复后仍需部署兼容 build。

## 2026-08-04 移动工作区与云端不可达语义

1. 移动端侧栏改为全宽工作区浏览器，Session/文件分成两个页签；Session 增加搜索，文件改为带面包屑的逐级目录导航，并提供 All/Changed 过滤和不低于 `44px` 的触控操作。
2. Models、Skills、Plugins、Extensions 与移动自检移入顶栏溢出菜单，避免在有限高度内和文件列表争抢空间；桌面端原有树形文件浏览保持不变。
3. 用户看到“所有 Pi Web 设备都离线”时，Mac 本机 production 与 `127.0.0.1:30141` 实际正常，云端 `33041` listener 缺失；直接故障是 Mac 到云端的 reverse SSH relay，不是 Mac 物理离线。确认运行 Session 为 `0` 后定向重启 Mac production/relay，`33041`、公网默认路由和 Mac Cookie 路由恢复 `200`。
4. 云端故障页改为“云端暂时无法连接执行设备”，并明确设备本身可能仍在线；Nginx release `20260804T002352Z` 已通过自动备份、`nginx -t` 和 reload 部署。移动工作区 production build id `YiObNJqmga67GsqYQEVxW` 已部署到 Mac，Linux 当前仍不可达，但不再影响 Mac 默认入口。
5. 验证证据：TypeScript、ESLint、移动 UI 静态检查 `50/50`、显式 `.test.mjs` `314/314` 与 `git diff --check` 全部通过；云端 Nginx `active` 且安装配置包含新故障语义。

## 2026-08-05 同步 Pi Web v0.8.6

1. 同步前 `codex/later-custom` 与 `origin/codex/later-custom` 一致且工作区 clean；GitHub 仓库元数据再次确认 `later-3/pi-web` 为 `private`，并建立恢复分支 `backup/later-custom-before-v0.8.6-20260805`。
2. Pi Web 从 `upstream/main@cbb080d` 合入 `dfab585`（tag `v0.8.6`），共 `12` 个提交；merge commit 为 `cb3655e`。4 个 `@earendil-works/pi-*` 直接依赖仍固定为 `0.83.0`，并与 npm stable latest 一致，因此本轮不升级 Pi SDK。
3. 人工解决 `9` 个冲突文件：Agent API 保留 Chat 管理 Session 只读边界和登录账号 Push audience，同时采用上游事件投影与 session cwd 解析；RPC/删除流程组合 Session 级 Extension 过滤、幂等删除和上游 `session_shutdown`；前端组合 Later 的设备失败语义、单调 run reconciliation 与上游 `agent_settled`/idle grace。
4. 移动端继续使用 Later 的 `768px`/短横屏断点、全宽工作区、安全区和带阈值的 Visual Viewport 判定；同时吸收上游 `interactiveWidget=resizes-content`、输入控件 `16px` 防聚焦缩放和内容宽度修复。没有恢复上游较窄的 `640px` drawer，也没有叠加第二套 viewport 监听。
5. 验证通过：`node_modules/.bin/tsc --noEmit`、`npm run lint`、全部 `.test.mjs` `343/343`、移动 UI `50/50` 和 `git diff --check`。本轮只同步、提交和推送代码；未运行普通 `next build`，也未改变当前 production artifact。

## 2026-08-05 Relay 自愈卡死修复

1. 事故事实：用户看到“云端暂时无法连接执行设备”时，Mac 本机 production 与 `30141 health=200`；云端 Nginx/cloudflared 均 active，但 `33041/33043` listener 均不存在，`33042 health=503`，公网 health=`503`。页面准确描述网关不可达，但不能据此称 Mac 离线。
2. 根因证据：Mac HTTP relay LaunchAgent 显示 `state=running`、`runs=233`，实际父 Bash PID `25006` 和预检 SSH PID `25009` 已卡住 `6:49:07`。预检只有 `ConnectTimeout=10`，连接建立后的半开会话没有 ServerAlive 或硬超时，导致 launchd 永远不再重启。
3. 修复：`run-pi-web-cloud-relay.sh` 的预检与主隧道统一使用 `ServerAliveInterval=10`、`ServerAliveCountMax=2`、`TCPKeepAlive=yes`；预检增加 `35s` 本地 watchdog，超时 TERM 并在 2 秒后 KILL。修复不重启 Pi Web production，也不影响本机 Agent。
4. 自动恢复实测：恢复后主动 KILL relay PID `35672`，launchd 自动建立 PID `39324`，云端 `33041 health=200`、公网 health=`200`、未登录 root=`307`，证明重启闭环有效。
5. 兜底页修复：原“重新检查”只是 `location.reload()`，隧道未恢复时没有可见反馈。现按钮只在用户点击时请求 1 次控制面 `/login`；成功才 reload，失败显示隧道仍不可达，不做后台轮询。云端 Nginx release `20260805T011103Z`，安装前自动备份并经 `nginx -t`/reload 验收。
6. 最终验收：TypeScript、ESLint、shell syntax、显式 `.test.mjs` `343/343` 与 `git diff --check` 通过。全链路 `22` 项中 Mac production/relay、云端服务、`33041/33042`、公网默认/Mac/未知 Cookie 路由全部通过；`4` 个失败与 `1` 个警告只对应仍不可达的 Linux。

## 2026-08-06 faux 测试会话污染恢复

1. 事故事实：手机端自动打开 `other / hello` 会话并显示 `faux-2`、`No available models`，文件目录请求失败。生产模型配置未改变；有效 cwd `/Users/xulater/Code/pi-web` 仍返回 `21` 个模型。异常数据来自 2026-08-05 两次绕过 Pi 仓库 `./test.sh` 的直接 Vitest 运行。
2. 数据恢复：以“`pi-runtime-*` 临时 cwd + 仅含 `faux` 模型记录”为白名单，确认 production 运行 Session 为 `0` 后，将 `19` 个目录、`23` 个测试会话移动到 `~/.pi/agent/session-quarantine/2026-08-06-faux-runtime-tests/`。操作不删除文件，真实 Session 未移动；恢复后 production 列出 `69` 个真实会话、`10` 个项目、`0` 个 faux 会话。
3. Pi 源码防复发：`/Users/xulater/Code/opc-os/pi` 的本地提交 `15f30e39` 为 `agent-session-runtime.test.ts` 显式传入测试专用 session 目录，并让跨 cwd 临时目录随测试清理；直接针对性回归 `12/12` 通过，真实 `~/.pi/agent/sessions` 未再产生 `pi-runtime-*` 文件。
4. Pi Web 防复发：提交 `2ba9140` 为 Session 列表增加项目目录可用性，自动选择时把目录已不存在的历史项目排到可用项目之后并明确标记；缓存的 Session 文件已不存在时立即失效路径，旧深链返回 `404`；初始 URL 指向已删除 Session 时清理失效导航并回到可用工作区。
5. 生产部署：在 detached worktree 按 `2ba9140` 构建候选产物，先于 `127.0.0.1:30142` 验证登录、Session、模型、文件、运行态与旧深链，再确认正式运行 Session 仍为 `0` 后原子切换。当前 build id `W26VCiWZb67haYcjOa7XJ`，PID 与 `30141` listener 一致；旧 build `YiObNJqmga67GsqYQEVxW` 保存在 `.next-mobile-backup-pre-session-recovery-20260806T1105CST`。
6. 最终验收：TypeScript、ESLint、显式 `.test.mjs` `345/345`、移动 UI `50/50`、`git diff --check` 全部通过。本机 health、云端 `33041`、公网入口及 `piweb`/`later` 两个应用账号登录全部通过；生产 API 为 Session `200/69`、模型 `200/21`、文件 `200`、旧 faux Session `404`、运行 Session `0`。Pi Web 与 Pi 源码提交当前仅保存在本地分支，未推送远端。

## 2026-08-06 新 Session 首条消息 404 修复

1. 事故事实：手机页面、设备状态和历史 Session 均可用，但新 Session `019fd536-218c-7469-89f9-f37a7abb3027` 在 `11:55:22 CST` 已被 production 创建并记录 `session_start` 后，SSE 与 prompt POST 仍连续返回应用层 `404 Session not found`。请求已穿过 Cloudflare、Nginx 和 `33041` 到达 Mac，因此不是设备离线或隧道故障。
2. 根因：`/api/agent/new` 通过 `SessionManager.create()` 创建真实内存 runtime 并返回 UUID，但首条可持久化命令之前 JSONL 尚未创建；Pi 还可能提前给 `sessionFile` 分配未来路径。Agent POST/SSE 当时先用 `resolveSessionPath()` 要求文件存在，之后才查 server registry，合法的新 runtime 因校验顺序被误判为不存在。
3. 代码修复：commit `f78d53c` 只允许 server registry 中仍存活、且 Session 文件尚未实际存在的 runtime 穿过首条命令前的窗口；已有磁盘 Session 仍先执行路径解析与 Chat 托管只读检查。新增 API 回归同时锁定“未落盘新 runtime 为 200”和“已注册 Chat runtime 仍为 403”。可复用案例已写入 `docs/maintenance-playbook.zh-CN.md` 3.21。
4. 验证：TypeScript、ESLint、显式 `.test.mjs` `347/347` 与 `git diff --check` 通过。候选 build 在 `127.0.0.1:30142` 完成应用登录、`ensure_session=200`、SSE `200 connected`、首条 prompt `200`、settled、Session 列表/JSONL 落盘和 API 清理；公网 `https://pi.ai4child.asia` 又完整重复一次，所有阶段均通过并清理测试 Session。
5. 生产部署：确认正式运行 Session 为 `0` 后切换到 build id `hP7sWMChyo3RDO9Ge97zy`；production PID `37109` 与 `127.0.0.1:30141` listener 一致，LaunchAgent `runs=1`。部署后本机、云端 `33041`、公网默认/Mac/未知 Cookie 路由均为 `200`，生产 API 为 Session `200/69`、模型 `200/21`、运行 Session `200/0`。
6. 构建处置与回滚：第一次候选命令因工作目录仍指主仓，曾在旧进程保持运行时把主仓磁盘 artifact 写成被拒绝的 build `-30-epSjo36ef4-uDg7xX`；health 未中断、Session 数据未修改，该产物保存在 `.next-mobile-backup-rejected-f9da8c9-20260806T1215CST`，不得作为回滚。最终 build 从相邻 detached worktree `/Users/xulater/Code/pi-web-deploy-f78d53c` 生成并经 `30142` 验收；最近已知稳定回滚仍为 `.next-mobile-backup-pre-session-recovery-20260806T1105CST`（build `YiObNJqmga67GsqYQEVxW`），也可从 commit `2ba9140` 重建上一版。
7. 外部剩余状态：`check-pi-web-cloud.sh` 为 `22` 项、`4` 失败、`1` 警告；失败均对应仍不可达的 `linux-home`、`33043` 与 Linux 直连，Mac 控制面和执行面不受影响。Pi Web 修复提交仍仅在本地分支，未推送远端。

## 2026-08-06 移动输入区底部间距修复

1. 根因：可输入 ChatWindow 与 `.mobile-composer` 同时应用 `safe-area-inset-bottom`，使模型选择行下方叠加了两层 iPhone 底部安全区；只读 Chat 执行记录不经过 composer，因此仍需由 ChatWindow 自己保留安全区。
2. 代码修复：commit `eaef325` 让正常输入区只由 composer 持有一层安全区，只读状态继续使用外层安全区；移动 PWA 静态测试增加防重复断言。该提交已推送到私有 `origin/codex/later-custom`。
3. 验证：针对性移动布局测试 `4/4`、TypeScript、ESLint 与 `git diff --check` 通过。部署前已通过认证检查 production 运行 Session 为 `0`。
4. 生产部署：旧 build `hP7sWMChyo3RDO9Ge97zy` 备份为 `.next-mobile-backup-pre-eaef325-20260806T064226Z`；新 build id 为 `4X-PPm5PHaOsN3tS-E74y`，production PID `52241` 与 `127.0.0.1:30141` listener 一致，relay PID 为 `52336`。
5. 最终验收：本机 health、Mac LaunchAgent、云端 `33041`、Nginx 登录保护、公网登录页与 `piweb`/`later` 两个应用账号均通过；手机 PWA 若仍持有旧页面，需要完全关闭后重新打开或刷新一次以加载新 chunk。

## 2026-08-17 OPC OS Pi 唯一源码绑定与 Session 审计

1. 旧状态：本地 `pi` CLI 已软链接到 `/Users/xulater/Code/opc-os/pi/packages/coding-agent/dist/cli.js`，但 Pi Web 从自己的 `node_modules` 加载 registry `0.83.0`，只通过 `PI_CODING_AGENT_DIR` 共享数据，实际是两套代码。
2. 绑定实现：7 个第一方 runtime 包（agent-core、ai、client、coding-agent、protocol、telemetry、tui）全部改为相邻 `../opc-os/pi/packages/*` 的显式 `file:` 依赖与 override；`scripts/pi-source.mjs` 执行 OPC 整仓 `build:offline`、建立本地链接并记录 Git/构建摘要。开发、npm build/start、Mac 管理脚本、Linux `ExecStartPre` 和 Next instrumentation 均执行 fail-closed 校验。
3. 上游同步：OPC Pi 合入稳定版 `v0.84.2`，merge commit `1f2b9ff53`；Pi Web 合入 `v0.8.9@2a6e537`，merge commit `de20207`。两仓的 Later 本地提交和 Chat 只读、Push、多设备、移动 PWA、Session Extension 开关等自研边界均保留。
4. 上游核心能力：Pi Web 接入增量 Agent SSE wire、运行中未落盘 Session 列表、稳定 project identity、项目命令环境隔离、工具进度、Extension widgets、草稿恢复、文件 Viewer 状态、应用更新提示和移动工具栏；OPC Pi 更新到 `0.84.2` 的完整 monorepo runtime。
5. 合并修复：Chat 托管 Session 即使已有内存 runtime 也不能绕过服务端只读校验；设备网关明确失败时恢复输入并仅按需探测一次；Service Worker 同时保留 Push badge 与安全的同源窗口聚焦；npm/Bun 锁文件显式覆盖 7 个 OPC 包，npm audit 修复 3 个传递依赖漏洞后为 `0`。
6. 验证：OPC Pi `npm run check`、`build:offline`、`./test.sh` 和 audit 通过；Pi Web TypeScript、ESLint、`687/687` tests、npm audit `0`、Bun 无缓存 frozen install 通过。`/tmp` 全新 `npm ci` 后完成源码链接、隔离 production build、真实 `next start` 和 health 验收，返回 `piSource={mode:opc-source,version:0.84.2,commit:1f2b9ff53c0a,dirty:false,packageCount:7}`；未写主工作区 `.next/.next-mobile`，未部署 production。
7. Session 审计：普通 Pi/Pi Web Session 统一位于 `~/.pi/agent/sessions`，Chat 托管证据位于 `~/.pi/agent/chat-sessions`；隔离测试归档位于 `~/.pi/agent/session-quarantine`。`pi-taskd` 的 `~/.local/share/pi-taskd*/runtime/sessions` 是显式独立 runtime，不是 Pi Web/CLI 泄漏；如要求整机单一物理数据根，需要另行设计迁移，不能直接混入交互 Session 目录。

## 2026-08-18 Mac 部署 Pi Web v0.8.9 / OPC Pi v0.84.2

1. 本次只更新 `mac-main`；用户明确说明 Linux 未开机，因此没有访问、修改或部署 `linux-home`，其 production 版本继续保持原状。
2. 候选产物从 detached worktree `/Users/xulater/Code/pi-web-deploy-20e322d@20e322d` 构建：全新 `npm ci` 后执行 `pi:prepare` 与 production 校验，7 个 Pi runtime 包全部链接到 `/Users/xulater/Code/opc-os/pi@1f2b9ff53c0a`；Next.js `16.3.1` production build 成功，唯一告警仍为 Session HTML 导出路由的已知动态依赖表达式。
3. 候选先在 `127.0.0.1:30142` 验收：health、应用登录、Session、Models、Devices、Running API 均为 `200`，读取 `85` 个 Session、`current=mac-main`、运行 Session=`0`，health 返回 `piSource={mode:opc-source,version:0.84.2,commit:1f2b9ff53c0a,dirty:false,packageCount:7}`。
4. 正式切换前再次通过认证 API 确认运行 Session=`0`。切换前实际 build `g4O8WiRSj8VGGS4tFCvRk` 与旧依赖分别保存在 `.next-mobile-backup-pre-v0.8.9-20260817T231634Z`、`node_modules-backup-pre-v0.8.9-20260817T231634Z`；新 build id 为 `6zM5m2IYenLTaiwcbOyu9`。
5. 部署后 production PID `81433` 与 `127.0.0.1:30141` listener 一致，relay PID `81527`；本机 health、云端 `33041`、公网 `https://pi.ai4child.asia`、未登录重定向，以及 `piweb`/`later` 两个应用账号登录全部通过。已认证 Session、Models、Devices、Running API 均为 `200`，运行 Session 仍为 `0`。
6. 安装使用 `--skip-server`，没有修改云端 Nginx/Cloudflare 配置；Linux 离线是本次明确边界，不影响 Mac 控制面和执行面。回滚时应先确认运行 Session=`0`，再恢复上述成对的 build 与 `node_modules` 备份，不能只恢复其中一个。

## 下一次更新本文件时至少记录

1. 日期、上游 commit/tag 和对应 merge commit。
2. 类型检查、Lint、测试通过数量。
3. 新增/删除的自研能力和配置项。
4. 部署环境、回滚点与未解决风险；不得写入密码、Token、私钥或 Cookie。
