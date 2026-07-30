# Pi Web Later 分支状态

> 这是随仓库更新的“当前事实页”，不是永久设计说明。每次合入上游、完成重要功能或部署后都要更新。

## 2026-07-30 基线

| 项目 | 当前值 |
|---|---|
| 开发分支 | `codex/later-custom` |
| Later 远端 | `origin = https://github.com/later-3/pi-web.git`，GitHub 可见性 `PRIVATE` |
| 上游仓库 | `upstream = https://github.com/agegr/pi-web.git` |
| 已合入上游 | `upstream/main@9d1721f`，发布版本 `0.8.4` |
| 上游合并提交 | `d700491` |
| Pi SDK | `0.83.0` |
| Node.js 下限 | `22.19.0` |
| 当前验证 | TypeScript、ESLint、`235/235` Node tests 通过；公网同源双设备路由验收通过 |
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
9. 多设备身份、受限 JSON 目录、同源粘性网关，以及桌面/手机在一个界面内切换执行设备。

完整入口见 [自研功能与配置清单](./docs/later-customizations.zh-CN.md)。

## 2026-07-30 双设备部署记录

| 项目 | 当前事实 |
|---|---|
| 第二台设备 | `pop-os`，Pop!_OS 24.04 LTS，x86_64 |
| 部署 commit | `535925de4b32ef2374076750878a8757c5a2ad37` |
| 运行环境 | Node `22.22.2`、npm `10.9.7`、Nginx `1.24.0` |
| 代码与数据 | `/home/later/Code/pi-web`、`/home/later/.pi/agent` |
| 服务 | `pi-web.service`、`pi-web-cloud-relay.service` 与 Nginx 均为 `enabled + active` |
| 用户入口 | 唯一 PWA/手机入口 `https://pi.ai4child.asia`；设备菜单在同一 origin 内切换 Mac/Linux 后端 |
| 物理入口 | Linux 直连 `https://linux.ai4child.asia` 与 LAN `http://192.168.1.68` 仅作部署验收/故障回退；Next.js 仅监听 loopback |
| 设备身份 | `linux-home / Pop!_OS`，与 `mac-main / Main Mac` 互相可见 |
| 凭据边界 | 网关成员共享应用登录账号和 Cookie 签名密钥；未复制 Provider/OAuth 凭据，Session/项目/Agent 仍各自留在本机 |
| 验证证据 | 同一登录 Cookie 下 `mac-main → linux-home → mac-main` 全部 `200`，地址不变；未知设备 Cookie 回退 Mac；两端 health 与服务重启通过 |

Mac 与 Pop!_OS 均运行 Later 私有分支 `535925d` 的 `.next-mobile`，不是上游原版。云端 Nginx 根据 HttpOnly `pi_web_device` Cookie 将同一入口粘性路由到 `33041`（Mac）或 `33043`（Linux）；设备选择控制面固定到 Mac，Linux 在已加载页面期间掉线时仍可切回。若浏览器带着 Linux 偏好冷启动且 Linux 已离线，当前恢复方式是清除该站点的设备偏好；专用恢复页列为后续增强。

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

### P2：Linux 公网 HTTPS 部署已验收，模型凭据待按需配置

Pop!_OS 目标机的 Node 路径、systemd、Nginx、认证、设备目录、受限 SSH reverse tunnel、Cloudflare ingress/DNS/TLS 与服务重启已验证。Provider/OAuth 凭据尚未迁移，按需在远端受保护 Web UI 中配置；真实模型推理、SSE 与该 origin 的 Web Push 仍需随后验收。

### P3：每日检查只自动发现，不自动合并

运行 `./scripts/check-upstream.sh` 会抓取并报告主仓差异，但不会改分支。自动合并容易在 PWA、依赖锁、移动 CSS 和部署脚本上静默覆盖自研行为，因此合并必须按 [维护与故障案例手册](./docs/maintenance-playbook.zh-CN.md) 人工验收。

### P4：同源双设备闭环已完成，交互与运行态仍需真机持续验收

[多设备 ADR](./docs/multi-device-architecture.zh-CN.md) 的同源入口、设备选择 API、HttpOnly 路由 Cookie、Nginx 白名单粘性路由、共享应用登录和两台真实设备已完成服务端验收。Safari/installed PWA 需要刷新后确认菜单交互；运行中切换、Linux 离线时回切和跨设备 Push 仍需真机验收。健康聚合、中央 Push broker 与设备授权是后续增强，不阻塞当前同终端切换。

## 下一次更新本文件时至少记录

1. 日期、上游 commit/tag 和对应 merge commit。
2. 类型检查、Lint、测试通过数量。
3. 新增/删除的自研能力和配置项。
4. 部署环境、回滚点与未解决风险；不得写入密码、Token、私钥或 Cookie。
