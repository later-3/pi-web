# Pi Web 与 Pi 上游版本审计

## 目的

这个项目同时依赖 3 个身份不同的仓库或发布源，检查和升级必须分开：

| 对象 | 权威来源 | 本项目如何使用 | 触发动作 |
|---|---|---|---|
| Later Pi Web | 私有 `origin` | 自研长期分支、部署来源 | 保存、推送、部署 |
| Pi Web 主仓 | [`agegr/pi-web`](https://github.com/agegr/pi-web) 的 `upstream/main` 与 release | Web 应用基础 | 评估后人工 merge |
| OPC OS Pi | Later 的 `opc-os/pi` 完整源码仓库；上游为 [`earendil-works/pi`](https://github.com/earendil-works/pi) | CLI 与 Pi Web 唯一 Pi runtime，包含 Agent、AI、TUI、Client、Protocol、Server 等 workspace | 以稳定 tag 整仓同步，再重建本地源码绑定 |

`Pi Web 有更新` 不代表 `Pi 有更新`；Pi 源码 `main` 有新提交也不代表已形成稳定升级候选。Pi Web manifest 中的 package 版本只是兼容目标，Later runtime 必须来自 OPC OS Pi 源码绑定，不能回退到 registry 副本。

## 2026-08-17 待同步差异

| 项目 | Later 当前 | 最新稳定 | 拓扑差异 | 结论 |
|---|---|---|---|---|
| Pi Web | `81cfe3c`，基于 `v0.8.6` 的 Later 分支 | `v0.8.9` / `2a6e537` | Later-only `44`，upstream-only `91` commits | 需要人工合并，不能覆盖 Later 的认证、移动端、多设备和 Session 生命周期 |
| OPC OS Pi | `15f30e39003e`，package `0.82.1` | `v0.84.2` / `914cf1472` | Later-only `2`，stable-only `532` commits；稳定版之后 `main` 另有 `19` commits | 只评估 `v0.84.2`，保留本地 faux Session 隔离修复，不追未发布 `main` |

Pi `0.83.0 → 0.84.2` 的核心变化：

1. 新增实验性 `client/protocol/server` 远程会话栈与独立 telemetry package；Agent harness/session storage 进入 lane-based v4，并强化 JSONL 崩溃、损坏、冲突创建和 metadata 读取处理。这是整仓变化，不是 4 个 SDK 包的小升级。
2. TUI 新增 fullscreen、Transcript 搜索、Mermaid/LaTeX、滚动/选择和按次 theme；支持 `AGENTS.override.md`、默认工具配置、认证预检、Qwen Individual、Baseten 与更细的自定义采样参数。
3. 优化 `message_update` 为 delta，避免累计消息造成二次方输出增长；fullscreen 绘制的逐帧分配约降低 `9–18x`；共享并发模型目录刷新，Mistral 改为原生流式传输，并给 OAuth/Copilot 更新增加并发和超时边界。
4. 修复 Provider stop reason、Google/Anthropic/OpenAI/Bedrock replay、DeepSeek 输出上限、Responses tool namespace、重试、extension tool 保留、subagent 配置继承、JSON/RPC usage 丢失及多项终端输入/鼠标问题；同时更新 `undici`、`brace-expansion` 和 `nanoid` 等安全相关依赖。

Pi Web `0.8.7 → 0.8.9` 的核心变化：

1. 完成 Pi `0.84` streaming delta 适配，并显示 tool-call 参数流和执行进度；增强 SSE、跨页签重连、任务关注通知、跨 workspace 完成提示和 transient Session 恢复。
2. 新增运行/未读 workspace 状态、Session cache hit/active time、每轮写入文件及 HTML/图片预览、系统主题、只读工具预设、图片流中追加、Extension widget 状态栏和 System prompt 懒加载。
3. 优化流式消息滚动和模型切换，流中跳过语法高亮，限制 `100KB+` 消息与用户气泡高度，修复 CJK token/TPS、iOS PWA viewport、hydration、Markdown/YAML/diff/math 和文件页签状态。
4. 修复 Provider 响应防御、裸 model scope 歧义、项目命令环境隔离、Next 子进程退出信号、Windows 项目标识/目录/打包及依赖漏洞。

同步建议：把两仓视作一个兼容升级，但保留两个可回滚提交。先把 OPC 整仓合到稳定 `v0.84.2` 并重建源码绑定，再合 Pi Web `v0.8.9` 完成 delta/API 适配；通过真实 Session、SSE/tool streaming、compaction、Provider auth、Push 和 Mac/Linux production 候选验证后再部署。当前只完成来源适配和审计，尚未合并上述上游版本。

## 2026-08-05 已验证基线

| 项目 | 稳定基线 | 判断 |
|---|---|---|
| Pi Web | `v0.8.6` / `dfab585` | 已合入 Later 分支，merge commit `cb3655e` |
| Pi npm packages | `0.83.0` | 4 个直接依赖均已是 npm latest |
| Pi source `main` | 未发布提交不作为稳定升级候选 | 只作为前瞻研究，不进入本次同步 |

本次 Pi Web v0.8.6 从 v0.8.5 增加 12 个提交，主要内容是：显式新 Session 偏好持久化、Agent SSE 生命周期、API-key 保存、插件/Skill UI、消息开销、Extension 提示音、iOS PWA viewport、Windows drive picker、Safari DOCX 预览和 Session shutdown。Pi 本身没有新的稳定 package，因此这次只升级 Pi Web，继续固定 4 个 `@earendil-works/pi-*` 依赖为 `0.83.0`。

## v0.8.6 冲突决策

| 冲突区域 | 上游价值 | Later 必须保留 | 合并结果 |
|---|---|---|---|
| Agent events/API 与 `hooks/useAgentSession.ts` | 事件投影、`agent_settled`、SSE idle grace | Chat 管理 Session 只读、设备不可达分类、单调 run reconciliation | 先做权限检查再复用 runtime；真实连接失败才做一次设备判断，流在 server idle 后关闭 |
| `lib/rpc-manager.ts` 与 Session 删除 | `session_shutdown`、从 SessionManager 取得规范 cwd | Push audience、Session 级 Extension allow-list、空 Session 幂等删除 | `shutdown()` 后删除并容忍 `ENOENT`；Extension trust 使用规范 cwd，Session override 继续按真实 id 生效 |
| `app/layout.tsx`、`AppShell`、移动 CSS | iOS standalone/键盘修复与 16px 防缩放 | 768px 全宽工作区、短横屏、安全区、Visual Viewport 阈值 | 保留 Later 单一 viewport hook，吸收 viewport meta、内容约束与防缩放，不恢复 640px 窄 drawer |
| `package.json` 与 lockfile | 发布版本 `0.8.6` | mobile build、Push、设备 UI 依赖 | 更新 Pi Web 版本；4 个 Pi package 仍为 `0.83.0` |

## v0.8.5 冲突决策

| 冲突区域 | 上游价值 | Later 必须保留 | 合并结果 |
|---|---|---|---|
| `app/api/agent/new/route.ts` | 创建 Session 时原子选择模型范围 | 登录账号 audience 与扩展过滤 | 两类约束都在 Session 启动前生效 |
| `lib/rpc-manager.ts` | visible/enabled model scope | Session 级 extension allow-list | 启动参数组合，不用整文件 ours/theirs |
| `lib/web-auth.ts`、`proxy.ts` | 简单部署的 `PI_WEB_PASSWORD` Basic Auth、页面 Host 校验 | PWA `/login`、多账号签名 Cookie、过期恢复 | 两种认证模式互斥；公网生产继续使用应用登录 |
| `package.json` 与 lockfiles | `0.8.5`、`proper-lockfile` | mobile build、Push、设备 UI 依赖 | 从组合后的 manifest 重新生成锁文件 |
| README 与 `AGENTS.md` | 新上游能力说明 | Later PWA/部署不变量 | 明确 Basic Auth 不适用于正式 installed PWA |

Basic Auth 与应用登录不能叠加。两者同时配置时代理返回 `503`，避免浏览器原生认证、应用 Cookie、API/SSE 过期恢复形成两层状态机。Later 的 Mac、Pop!_OS 与公网 PWA 使用 `PI_WEB_AUTH_*`，不配置 `PI_WEB_PASSWORD`。

## 日常检查

```bash
./scripts/check-upstream.sh
```

脚本会做两件只读检查：

1. fetch Pi Web `upstream/main`，报告两边 commit 数和待评估日志；
2. fetch OPC Pi 的 `upstream/main` 与 tags，报告 OPC HEAD 相对最新稳定 tag 和未发布 main 的差距；
3. 用 `npm view` 检查 Pi Web manifest 的 4 个兼容版本，但不把这些 registry 包当作运行来源。

它不会切分支、修改 manifest/lockfile、自动 merge 或自动升级。离线环境可临时设置 `PI_WEB_CHECK_PI_PACKAGES=0`，但下次联网工作仍要补查。

需要人工深入 Pi 源码时使用：

```bash
gh api repos/earendil-works/pi/releases/latest
gh api repos/earendil-works/pi/compare/v0.83.0...main
```

只有 npm/release 出现新稳定版本才进入升级评估。`main` 上的未发布修改只用来提前识别协议、finish reason、shutdown、模型错误或 package manifest 等潜在兼容风险，不能直接把本项目依赖改成未知 commit。

## 升级与部署门槛

1. Pi Web merge 与 Pi SDK 升级拆成两个可回滚变更；不要同时改变两条版本线后再定位问题。
2. merge 前保存脏工作树并确认 `origin` 仍为 private；冲突按不变量组合。
3. 通过 TypeScript、ESLint、全量 Node tests、移动 UI 静态验证和认证专项测试。
4. 从一个已推送的精确 commit 构建 production artifact。
5. 读取 `ops/device-inventory.json`；所有实际安装 Pi Web 的设备必须部署同一代码 commit。只运行 Nginx/Cloudflare 的网关不伪装成 Pi Web 应用节点，只验证路由与健康。
6. 更新 `PROJECT_STATE.md`，记录上游 commit/tag、merge commit、测试数量、两端 build id、回滚目录和剩余风险，不记录密码、Token、Cookie 或私钥。

## 以后如何避免重复调查

- 先运行脚本，不再分别凭记忆搜索两个项目。
- 看见 Pi `main` ahead 时先确认 release/npm；没有稳定发布就记录类别，不升级。
- 新 Pi Web release 先按 changed files 与 Later 热区求交集，优先审计认证、模型、Session 生命周期、PWA/SW、依赖锁与部署脚本。
- 每次出现可复用的冲突或生产故障，都把“症状、根因、证据、修复、不变量、自动化验证”追加到维护案例库。
