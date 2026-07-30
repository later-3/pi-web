# Pi Web Later 分支状态

> 这是随仓库更新的“当前事实页”，不是永久设计说明。每次合入上游、完成重要功能或部署后都要更新。

## 2026-07-30 基线

| 项目 | 当前值 |
|---|---|
| 开发分支 | `codex/later-custom` |
| 上游仓库 | `upstream = https://github.com/agegr/pi-web.git` |
| 已合入上游 | `upstream/main@7672aa0`，发布版本 `0.8.4` |
| 上游合并提交 | `d49075c` |
| Pi SDK | `0.83.0` |
| Node.js 下限 | `22.19.0` |
| 合并后验证 | TypeScript、ESLint、`195/195` Node tests 通过 |
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

完整入口见 [自研功能与配置清单](./docs/later-customizations.zh-CN.md)。

## 当前待办与风险

### P0：私库状态不符合预期

2026-07-30 使用 GitHub API 核对时，`origin = later-3/pi-web` 的可见性是 **PUBLIC**，不是预期的 private。完成以下任一项前，不应继续向 `origin` 推送包含新增部署细节的提交：

1. 将 `later-3/pi-web` 改为 private；或
2. 把 `origin` 切换到确认过的私有仓库。

更改后必须再次执行：

```bash
gh repo view later-3/pi-web --json nameWithOwner,visibility,isPrivate,url
git remote -v
```

### P1：上游生产依赖仍有 4 个 High 审计项

2026-07-30 的 `npm audit --omit=dev` 显示：Pi SDK 子树的 `brace-expansion@5.0.7` 命中 DoS 公告；Next `16.2.12` 内嵌的 PostCSS `8.4.31` 和 sharp `0.34.5` 也命中公告，并将 `next` 一并计为 High。npm 给出的 `--force` 方案会错误地降到 Next 9，不能采用。`brace-expansion@5.0.8` 虽已发布，但 npm 的嵌套 override 实验未改变实际依赖树，Bun 也不支持同一写法，因此没有保留“表面修复”。这些项必须等待 Pi SDK/Next 或主仓的兼容升级，并在部署前重新审计。

### P2：Linux 部署尚未在目标机验收

[Linux 部署手册](./docs/linux-deployment.zh-CN.md) 已给出无敏感值的完整步骤，但仍需在实际服务器验证 Node 路径、systemd 用户权限、反向代理、模型凭据和 Web Push。

### P3：每日检查只自动发现，不自动合并

运行 `./scripts/check-upstream.sh` 会抓取并报告主仓差异，但不会改分支。自动合并容易在 PWA、依赖锁、移动 CSS 和部署脚本上静默覆盖自研行为，因此合并必须按 [维护与故障案例手册](./docs/maintenance-playbook.zh-CN.md) 人工验收。

## 下一次更新本文件时至少记录

1. 日期、上游 commit/tag 和对应 merge commit。
2. 类型检查、Lint、测试通过数量。
3. 新增/删除的自研能力和配置项。
4. 部署环境、回滚点与未解决风险；不得写入密码、Token、私钥或 Cookie。
