# Later Pi Web 维护、上游同步与故障案例手册

## 维护原则

1. 每个工作日第一次开发前，或用户主动要求时，先运行 `./scripts/check-upstream.sh`。
2. 检查可以自动；合并、解决冲突、部署不能无人值守自动执行。
3. 先保存本地成果，再合入上游；脏工作区不直接 merge/rebase。
4. `origin` 只用于 Later 私库，`upstream` 只跟踪 `agegr/pi-web` 主仓。
5. 每次同步后更新 [`PROJECT_STATE.md`](../PROJECT_STATE.md)，写 commit、验证和剩余风险，不写秘密。

## 1. 日常检查

```bash
./scripts/check-upstream.sh
```

脚本执行 Pi Web fetch/差异统计，并把项目固定的 4 个 Pi package 与 npm 稳定最新版比较；它不切分支、不改 index/manifest/lockfile、不合并。输出中的：

- `Upstream-only > 0`：主仓有待评估提交；
- `Local-only > 0`：自研分支有主仓没有的正常提交；
- `Working tree: dirty`：先审计并保存当前工作，不能直接同步。
- `Pi ... REVIEW`：官方 Pi 有新的稳定 package，另开兼容性升级，不与 Pi Web merge 混做；
- `Pi ... unknown`：网络或 registry 查询失败，不能据此判断 Pi 已是最新版。

完整的两条版本线、2026-07-31 基线与升级门槛见 [Pi Web 与 Pi 上游版本审计](./upstream-version-audit.zh-CN.md)。

想每天定时只做提醒，可在运行用户的 crontab 加一条日志任务：

```cron
17 9 * * * cd /absolute/path/to/pi-web && ./scripts/check-upstream.sh >> /absolute/path/to/upstream-check.log 2>&1
```

这不是自动合并器。若本机休眠、网络或 Git 凭据不可用，日志会保留失败，下一次人工工作仍要再检查。

## 2. 一次完整上游同步

### A. 确认远端和私密性

```bash
git remote -v
gh repo view OWNER/pi-web --json nameWithOwner,visibility,isPrivate,url
git remote get-url upstream
```

预期：`origin` 是确认过的 Later private 仓库；`upstream` 是 `https://github.com/agegr/pi-web.git`。可见性不符合预期时停止 push。

### B. 保存当前工作

```bash
git status --short --branch
git diff --check
git diff --stat
git ls-files --others --exclude-standard
```

逐文件确认范围，显式 `git add path...`，先运行相关检查再提交。不要用一个含义模糊的提交吞掉互不相关的代码、实验图片和文档。

### C. 抓取和评估

```bash
git fetch --all --prune --tags
git rev-list --left-right --count HEAD...upstream/main
git log --oneline --left-right --cherry-pick HEAD...upstream/main
git diff --name-status HEAD..upstream/main
```

阅读 release、依赖升级和与自研文件重叠的提交。必要时先建普通备份分支，例如 `backup/later-custom-before-upstream-YYYYMMDD`；不要用 tag 假装发布版本。

### D. 合入

自研长期分支默认使用 merge，保留“主仓进入点”和冲突决定：

```bash
git switch codex/later-custom
git merge --no-ff upstream/main
```

冲突处理原则不是简单选 ours/theirs，而是写出组合后的不变量。2026-07-30 同步 `7672aa0` 时有 7 个冲突：

| 文件 | 必须同时保留 |
|---|---|
| `app/layout.tsx` | 主仓 PWA 注册/图标/字体；Later 的 iOS viewport-fit 和安全区布局 |
| `app/manifest.ts` | 主仓标准 icons/categories；Later 的 maskable icons |
| `components/ChatInput.tsx` | 主仓可换行 compaction error；Later 移动设置 tile |
| `next.config.ts` | 主仓 PWA headers；Later 登录 no-store、独立 distDir、Web Push external package |
| `package.json` | 主仓版本与 Pi SDK；Later 的 mobile scripts、Tabler 与 web-push |
| `package-lock.json` | 由合并后的 `package.json` 重新生成，禁止手改大段依赖图 |
| `public/sw.js` | 主仓版本化静态缓存/离线页；Later Push；所有 API/认证/SSE 永不缓存 |

依赖文件完成后：

```bash
npm install
bun install --lockfile-only --ignore-scripts
```

同日继续同步 `upstream/main@9d1721f` 时，`app/globals.css` 与 `components/AppShell.tsx` 发生 2 个冲突。最终同时保留上游可拖拽侧栏及其持久化、Later 的移动视口/安全区和设备切换入口；合并提交为 `d700491`，不得用整文件 ours/theirs 覆盖任一侧。

2026-07-31 同步 `upstream/main@cbb080d`（v0.8.5）时有 8 个冲突。模型启动同时保留上游 visible/enabled scope 与 Later extension/audience 约束；认证同时保留上游可选 Basic Auth 与 Later PWA 应用登录，但两种模式严格互斥；lockfile 从组合后的 package manifest 重新生成。完整决策矩阵见 [版本审计](./upstream-version-audit.zh-CN.md)。

### E. 验证

开发阶段禁止运行 `next build`。最低检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
node --test lib/*.test.mjs components/*.test.mjs hooks/*.test.mjs
git diff --check
```

涉及移动 UI、PWA、登录、Push 或部署时再做对应真机/脚本验收。测试通过后提交 merge，更新 `PROJECT_STATE.md`。

### F. 推送

```bash
gh repo view OWNER/pi-web --json visibility,isPrivate,url
git push -u origin codex/later-custom
```

推送后用 `git fetch origin` 和 `git status -sb` 确认不再 ahead。是否创建 PR 取决于 Later 私库的发布流程；长期自研分支不必为了形式自动开 PR。

## 3. 故障案例库

每个案例都按“症状 → 根因 → 已验证修复 → 以后怎么防”记录。新增案例不要只写一次性的命令日志。

### 3.1 Fork 后父子链异常

- 症状：第二次 Fork 产生错误的 `parentSession`，旧 Session 后续操作像已经切到新文件。
- 根因：`AgentSession.fork()` 会原地改变 wrapper 内部的 `sessionId`，registry 仍以旧 id 保存它。
- 修复：捕获新 id 后立即 `destroy()`；下次访问旧 Session 时从原文件重建 wrapper。
- 防复发：不要把 Fork 与同文件 `navigate_tree` 分支混为一谈；修改 registry 生命周期必须回归两次连续 Fork。

### 3.2 热更新后 Session 状态消失或重复实例

- 症状：Next.js 热更新后正在运行的 AgentSession 找不到，或并发请求各建一份实例。
- 根因：模块级 `Map` 不能跨热更新稳定存活，并发启动缺少共享锁。
- 修复：registry 与 start Promise 放在 `globalThis`，wrapper 空闲 10 分钟销毁。
- 防复发：浏览历史只读文件，不要为了展示创建 AgentSession。

### 3.3 后台页面永久显示“运行中”

- 症状：切后台、断网或半开 SSE 后漏掉 `agent_end`，气泡一直 streaming。
- 根因：把单条 EventSource 当成唯一事实源，旧请求响应还可能覆盖新 run。
- 修复：per-session SSE 为主，运行期间轮询/visibility/online reconciliation；使用单调 run id 忽略迟到事件。
- 防复发：同时测试后台恢复、断网恢复、旧 run 的迟到响应和跨窗口 running 状态。

### 3.4 PWA 反复弹 Basic Auth 或过期后无法恢复

- 症状：iOS 主屏 PWA 无法稳定出现/保存原生认证弹窗，401 后 EventSource 只报网络错误。
- 根因：Nginx `auth_basic` 不适合 installed PWA，且 EventSource 不暴露完整 401 细节。
- 修复：改用 `/login` + 签名 HttpOnly Cookie；`AuthSessionMonitor` 包装 fetch，并在 60 秒、visibility、online、pageshow 时检查。
- 防复发：Nginx 不启用 Basic Auth；公网配置缺失必须 fail closed；密码和签名密钥分开。

### 3.5 Service Worker 更新后仍显示旧页面或缓存认证数据

- 症状：部署后 PWA 长时间不更新，或登出后仍看到旧内容。
- 根因：SW 脚本/HTML/API 使用了错误缓存策略。
- 修复：注册 URL 带应用版本、`updateViaCache=none`、旧 static cache 激活时清理；`/api/*` 和导航页面走网络，离线只显示静态说明页。
- 防复发：任何 SW 修改都核对 Cache Storage；认证、Session、SSE 永不 cache-first。

### 3.6 iOS 输入框、底栏出现像素偏移

- 症状：主屏 PWA 键盘开合后底栏跳动，刘海/Home Indicator 留白重复，pinch zoom 被误判为键盘。
- 根因：混用 `100dvh`、safe-area 与 Visual Viewport，或只看 viewport 高度差。
- 修复：关闭键盘时 CSS 管高度；仅在可编辑控件聚焦、scale≈1 且可见高度确实收缩时启用 Visual Viewport。
- 防复发：固定 390×844 截图基线，同时测 Safari tab、standalone PWA、键盘、旋转和 pinch zoom；不要靠单个魔法像素补偿。

### 3.7 手机访问突然 502，远端端口看似仍监听

- 症状：Mac 本地健康，云端 `33041` 超时，新 SSH `-R` 又提示端口占用。
- 根因：Mac 休眠/切网后旧 `sshd` 连接残留在 `CLOSE-WAIT`。
- 修复：管理/安装脚本先确认专用端口占用者确为 `sshd`，再回收旧连接并重启 tunnel。
- 防复发：先运行 `manage-pi-web.sh status` 和 `verify-mobile-relay.sh`，按本地 → 隧道 → Nginx → 公网分层定位。

### 3.8 通知权限已开但第一次收不到 Push

- 症状：系统设置显示允许通知，锁屏测试仍没有消息。
- 根因：浏览器 permission、PushSubscription、服务端保存和一次真实 delivery 是 4 个不同状态；仅看 permission 不足。
- 修复：订阅时发送测试 Push，成功后记录 `verifiedAt`；VAPID key 改变时退订旧 subscription；404/410 自动清理。
- 防复发：真机至少验证测试通知、真实 Agent 完成、锁屏点击深链和账号隔离。

### 3.9 production 构建破坏正在运行的 dev

- 症状：`npm run dev` 热更新异常、`.next` 内容相互覆盖。
- 根因：开发和 production 共用默认 `.next/`。
- 修复：production 使用 `PI_WEB_DIST_DIR=.next-mobile` 和 `build:mobile/start:mobile`。
- 防复发：开发中不运行普通 `next build`；发布验证在明确窗口执行 mobile build。

### 3.10 Provider Request JSON 信息密集、难以审查

- 症状：终端只显示一大段 JSON，小弹窗无法理解请求结构。
- 根因：原始扩展事件缺少层次、搜索、放大和字段友好标签。
- 修复：保留原始数据，同时提供结构化 sections、可搜索内容、全屏/可调视图。
- 防复发：新字段未知时必须优雅回退到原始 JSON，不能为了“友好展示”丢证据。

### 3.11 ToolCall 历史加载后字段为空

- 症状：文件加载的工具调用不能按 UI 类型渲染，流式时却正常。
- 根因：Pi JSONL 使用 `{id,name,arguments}`，本地类型使用 `{toolCallId,toolName,input}`。
- 修复：文件读取和实时事件都经过 `normalizeToolCalls()`。
- 防复发：不要只在一个入口修字段；历史回放和实时流必须用同一规范化规则。

### 3.12 很深的 Session 导出后浏览器栈溢出

- 症状：超长线性 Session 导出的 HTML 打开时报 maximum call stack。
- 根因：上游导出模板的树递归深度随消息数增长。
- 修复：导出路由把递归 helper 替换为迭代实现。
- 防复发：保留深线性 Session 样本；更新上游导出 helper 后重新核对补丁是否仍需要。

### 3.13 私仓 `ls-remote` 成功但首次 clone 没有 HEAD

- 症状：GitHub Deploy Key 已验证、`git ls-remote` 能看到目标 commit，但首次 clone 长时间无输出，只留下 `.git` 和 `master` 空分支。
- 根因证据：SSH publickey 认证与 `git-upload-pack` 均成功，问题发生在 pack 传输/检出阶段，不是仓库权限；目标目录没有可验证 HEAD。
- 修复：先用 `git rev-parse --verify HEAD` 确认目录确实是本次产生的空 clone，再设置精确 fetch refspec 并继续 `git fetch`；本机同时可生成 `git bundle`，经 `git bundle verify` 后作为局域网离线后备。最终必须核对完整 commit SHA 和 clean status，再设置私仓 origin。
- 防复发：不要看到 `.git` 就删除目录，也不要把 `ls-remote` 成功误判为完整 clone 成功；Deploy Key 保持只读，部署固定完整 SHA。

### 3.14 远端 `npm ci` 长时间无输出或 SSH 不退出

- 症状：冷安装数分钟没有新终端输出，看似卡死；远端命令实际完成后 SSH 连接仍可能暂时不退出。
- 根因证据：Pop!_OS 首次安装 1194 个包耗时约 12 分钟，期间 `node_modules` 从 1.3 GiB 增长到 1.7 GiB、npm 持续占用 CPU；最终 npm debug log 为 `exit 0 / info ok`。
- 修复：用 `ps`、目录大小、文件数和最新 npm log 判断是否前进；确认 npm 进程消失、`node_modules/.bin/next` 存在、lockfile 未变且日志 exit 0 后，才关闭空闲 SSH 连接并进入构建。
- 防复发：不能因为 30 秒无输出就并发重跑 `npm ci`；冷缓存部署给足时间，构建与安装保持串行，并保留 `npm ci --no-audit --no-fund` 的确定性参数。

### 3.15 Cloudflare DNS 正常但新子域名 TLS handshake failure

- 症状：Tunnel ingress、Nginx、应用 health 和权威 DNS 都正常，新域名经过 Cloudflare 边缘却在 TLS 握手阶段失败。
- 根因证据：最初使用 `linux.pi.ai4child.asia`，这是相对 `ai4child.asia` 的两层子域名；当前通用证书覆盖 apex 与单层 wildcard，但不覆盖该嵌套名称。两个边缘 IP 均复现握手失败。
- 修复：改用单层 `linux.ai4child.asia`，重新配置 ingress、Host allow-list 和设备目录；两个 Cloudflare 边缘 IP 随即返回 health `200` 且 TLS 校验为 0。
- 防复发：设计设备 hostname 时先核对证书 SAN/层级，不要只验证 DNS；上线门槛必须同时包含权威 DNS、两边缘 TLS、应用登录和 `/api/devices`。

### 3.16 多设备切换像进入另一套应用

- 症状：手机从设备菜单跳到另一个子域名，地址、登录、PWA scope 和页面生命周期一起改变，用户感知为两套割裂的管理界面。
- 根因：一期把 `window.location.assign(device.url)` 当成最终交互；不同 origin 天然拥有不同 Cookie、Service Worker 和 installed PWA 边界。
- 修复：手机只访问一个网关 origin；`POST /api/devices/select` 写入 HttpOnly `pi_web_device`。Nginx 只把已知 id 映射到设备 tunnel，网关成员共享应用账号与会话签名密钥，控制接口固定到主设备；离线目标冷启动的当前恢复方式是清除站点设备偏好。最初仍以同 URL 整页刷新完成切换，随后由 3.17 继续消除页面生命周期断裂。
- 自动化验证：覆盖目录 gateway 模式、选择 API 的 Origin/JSON/体积/id 校验、Cookie 属性、客户端超时和 Nginx 映射。
- 部署验证：同一签名登录 Cookie 下完成 `mac-main → linux-home → mac-main`，所有请求均为 `200`、URL 不变；未知 Cookie 回退 Mac。
- 防复发：设备 URL 只能作为隧道/故障回退 adapter，不再作为正常 UI 导航；新增设备必须运行兼容 build、共享应用认证材料，并保留主控制面回切路径。Session、Provider Key 和项目文件禁止因“统一界面”而集中复制。后续恢复页必须是主设备固定路由且不依赖所选目标的静态资源。

### 3.17 同源切换仍有“重新请求网页”的感觉

- 症状：设备选择已经保持同一 URL 和登录，但每次仍 reload 整个 document；手机会出现空白/连接卡片，顶部、输入区和滚动位置全部重建，频繁往返时像刷新网页。
- 根因：把“关闭旧设备 EventSource”与“销毁整个页面”绑定。安全上只要求旧工作区 effect 在 Cookie 改变前清理，不要求页面壳、认证和静态资源重新加载。
- 修复：云端把页面壳、`/_next/*`、应用认证和设备选择固定到 Mac 控制面；React 增加 `DeviceWorkspaceRoot` 与递增 epoch。切换事务按 `flushSync unmount 旧 AppShell → POST 选择 → 目标 /api/devices payload/header 探针 → flushSync mount 新 AppShell → 独立 sidebar ready gate` 执行。失败时回滚 Cookie 与原设备快照。每台设备的 Session/cwd、文件页签和面板状态使用有界 `sessionStorage` 独立保存。
- 视觉连续性：浏览器支持同文档 View Transition 且未开启 reduced motion 时，保留真实旧工作区快照直到目标 React tree 挂载，再原位替换；不构造假 Session、假骨架或跨设备复用 React 状态。View Transition 的 DOM update callback 内不得等待 `requestAnimationFrame`：浏览器在回调完成前暂停渲染，这会形成帧等待死锁并记录 transition timeout。
- 自动化验证：切换专项 13 项覆盖安全清理顺序、同文档 epoch 替换、目标错路由拒绝、超时、Cookie 回滚、工作区清洗/上限与 reduced-motion 分支；全量 `247/247` tests、TypeScript 和 ESLint 通过。
- 生产验证：最终 `linux-home → mac-main → linux-home` 两向切换约 395ms/375ms，保持同一 URL，目标侧分别恢复 `/Users/xulater/Code/Chat` 与 `/home/later/Code`；从刷新最终 build 到两次切换后的新增页面 warning/error 为 0。Mac/Pop!_OS 均部署 `67effb8` production artifact，公网登录、Nginx、双隧道和 health 全部通过。
- 防复发：gateway 模式禁止 `window.location.assign/reload`；Cookie 修改前必须证明旧 workspace 已 unmount；目标设备必须通过 id 双重校验；失败必须可回滚。direct 模式仍可跨 origin 导航，但不能用于正式手机入口。

### 3.18 把 Pi Web 更新与 Pi 更新混为一件事

- 症状：只看 Pi Web 主仓就回答“Pi 也没有更新”，或看到 Pi 源码 `main` ahead 就准备改 SDK 依赖，之后还要重复查询 npm、release 和 commit 差异。
- 根因：`agegr/pi-web` 与 `earendil-works/pi` 是独立发布线；源码主分支提交、GitHub release 和 npm stable package 不是同一状态。
- 根因证据：2026-07-31 Pi Web 已发布 v0.8.5，而 4 个 Pi package 的 npm latest 仍为 0.83.0；Pi `main` 比 v0.83.0 多 38 个未发布提交。
- 修复：`check-upstream.sh` 同时检查 Pi Web Git drift 和 4 个 Pi npm stable 版本；稳定 Pi 升级与 Pi Web merge 拆成两个变更。
- 防复发：报告必须分别写 Pi Web stable、Pi package stable、Pi main unreleased；未发布 commit 只能作为风险研究。详细命令和判断规则见 [版本审计](./upstream-version-audit.zh-CN.md)。

### 3.19 上游 Basic Auth 与 PWA 应用登录叠加

- 症状：页面先出现浏览器原生密码框，进入应用后又要求 `/login`；API/SSE 在某一层过期时只表现为 401、断流或无法恢复。
- 根因：v0.8.5 的 `PI_WEB_PASSWORD` 面向简单部署，Later 的 `PI_WEB_AUTH_*` 面向多账号 installed PWA；叠加会产生两套互不理解的认证状态。
- 修复：代理检测到两种配置同时存在就 fail closed `503`。正式 Mac/Pop!_OS/PWA 继续只用应用登录；Basic Auth 仅保留为上游兼容的简单非 PWA 模式。
- 自动化验证：覆盖正确/错误 Basic header、WWW-Authenticate、静态资源边界、两模式互斥、PWA public path 与签名 Cookie。
- 防复发：部署配置只能选择一种认证模式；Nginx 不再额外叠加 `auth_basic`。

## 4. 新案例模板

```markdown
### 标题

- 日期 / 版本 / commit：
- 症状和影响范围：
- 最小复现：
- 根因证据：
- 修复与为什么有效：
- 自动化验证：
- 真机/部署验证：
- 防复发不变量：
- 相关文件和文档：
```

只把可复用的根因和验证写入仓库。真实账号、IP 白名单、Token、Cookie、Provider 响应原文和用户对话保留在安全位置，不进入案例库。
