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

脚本只执行 fetch 和差异统计，不切分支、不改 index、不合并。输出中的：

- `Upstream-only > 0`：主仓有待评估提交；
- `Local-only > 0`：自研分支有主仓没有的正常提交；
- `Working tree: dirty`：先审计并保存当前工作，不能直接同步。

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
