# Pi Web

[English](./README.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

[pi 编程智能体](https://github.com/earendil-works/pi)的本地浏览器界面。Pi Web 与 pi 共用本机配置和会话文件，可在浏览器中查找和继续对话、运行智能体、配置模型与资源，并查看项目文件。

中文微信群：请查看 [GitHub Discussions 帖子](https://github.com/agegr/pi-web/discussions/271)。

![Pi Web 展示包含结构化 Markdown、工具调用和项目导航的 pi 会话](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

## 功能

- **会话工作区**：按项目查找、继续、重命名、导出和删除对话，并查看运行状态、上下文占用、花费和压缩信息。
- **两种分支方式**：**新会话**会从较早的消息创建独立会话文件；**从此处编辑**会在当前会话内创建分支。
- **项目文件工具**：浏览和上传文件、查看 Git Diff，并预览源码、Markdown、图片、音频、PDF 和 DOCX；文件变化后会自动刷新。
- **Git worktree**：从侧边栏切换 checkout，同时把同一仓库不同 worktree 的会话归在一起。
- **网页配置**：无需离开 Pi Web，即可管理 Provider 登录和 API Key、模型、模型测试、插件包及技能。
- **英文和简体中文界面**：Pi Web 首次打开时跟随浏览器语言，也可从顶部栏切换语言。

## 快速开始

Pi Web 要求 Node.js 22.19.0 或更高版本。先用 `node --version` 检查版本，然后运行：

```bash
npx @agegr/pi-web@latest
```

服务就绪后，命令行会尝试自动打开浏览器。如果没有打开，请访问 [http://127.0.0.1:30141](http://127.0.0.1:30141)。Pi Web 默认仅监听 `127.0.0.1`。

如果尚未配置模型 Provider，请打开**模型（Models）**面板登录或添加 API Key。

如需全局安装 `pi-web` 命令：

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

更新前先用 `Ctrl+C` 停止正在运行的进程，再次执行同一条安装命令。卸载时运行 `npm uninstall -g @agegr/pi-web`。

## 配置

端口和主机名以命令行参数为准，优先于对应的环境变量。`--no-open` 与 `PI_WEB_NO_OPEN=1` 中任意一个都会关闭自动打开浏览器。

| 参数或环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `--port <端口>`、`-p <端口>` 或 `PORT` | 服务端口 | `30141` |
| `--hostname <主机>`、`-H <主机>` 或 `PI_WEB_HOSTNAME` | 监听主机名 | `127.0.0.1` |
| `--no-open` 或 `PI_WEB_NO_OPEN=1` | 不自动打开浏览器 | 自动打开 |
| `PI_WEB_ALLOWED_HOSTS` | 额外允许的代理或自定义主机名，多个值用逗号分隔，必须精确匹配 | 未设置 |
| `PI_WEB_PASSWORD` | 启用 HTTP Basic Auth，用户名固定为 `pi` | 不启用认证 |

例如：

```bash
pi-web --port 8080              # 自定义端口
pi-web --hostname 0.0.0.0       # 在可信网络中开放访问
pi-web -p 8080 -H 0.0.0.0       # 组合使用
pi-web --no-open                # 不自动打开浏览器

PORT=8080 pi-web                # 也支持环境变量
PI_WEB_HOSTNAME=0.0.0.0 pi-web  # 显式开放网络访问
PI_WEB_ALLOWED_HOSTS=pi-web.internal pi-web  # 允许指定的代理或自定义主机名
PI_WEB_PASSWORD='足够长的随机密码' pi-web  # 启用 Basic Auth（用户名固定为 pi）
PI_WEB_NO_OPEN=1 pi-web         # 适用于后台服务或开机自启

# 在可信 HTTPS 反向代理后启用独立登录页（多账号）：
PI_WEB_AUTH_REQUIRED=1 \
PI_WEB_AUTH_CREDENTIALS_FILE=/账号文件的绝对路径 \
PI_WEB_AUTH_SESSION_SECRET_FILE=/会话签名密钥文件的绝对路径 \
PI_WEB_ALLOWED_HOSTS=pi.example.com \
pi-web
```

账号文件使用 `{"credentials":[{"username":"用户名","password":"密码"}]}` 格式，建议权限设为 `600`。也兼容原有的 `PI_WEB_AUTH_USERNAME` + `PI_WEB_AUTH_PASSWORD_FILE` 单账号配置，但不能与多账号文件同时使用。只要配置了认证相关设置，应用层身份验证就会启用。启用后，`/login` 会签发绑定到具体账号的带签名 HttpOnly 会话 Cookie；公网部署应设置 `PI_WEB_AUTH_REQUIRED=1`，确保凭据缺失时拒绝访问，不会静默裸奔。Pi Web 可以调用高权限智能体，请勿通过明文 HTTP 或不可信反向代理暴露到互联网。

### 远程访问

设置 `PI_WEB_PASSWORD` 后，网页和所有 API 端点都会启用 HTTP Basic Auth，用户名固定为 `pi`。未设置或设置为空值时不启用认证。

Pi Web 可以调用高权限智能体。Basic Auth 不会加密传输中的密码，因此不要把明文 HTTP 暴露到互联网。远程访问时应使用可信反向代理提供 HTTPS，或通过可信 VPN 访问。
`PI_WEB_PASSWORD` 与 `PI_WEB_AUTH_*` 应用登录配置互斥；同时配置时会拒绝启动访问流程并返回 `503`，不会叠加两套认证。安装到主屏幕的 PWA 应使用应用登录，因为原生 Basic Auth 弹窗在该场景下不可靠。
API 请求仅接受 loopback 名称、IP 字面量、当前监听主机名，以及 `PI_WEB_ALLOWED_HOSTS` 中以逗号分隔的精确主机名。可信反向代理使用不同的外部主机名时，请配置该变量。

### 仓库部署：启动手机公网服务

当前仓库已配置 Mac production、SSH 反向隧道、云端 Nginx 和 Cloudflare。日常启动与验证：

```bash
./scripts/manage-pi-web.sh start
./scripts/verify-mobile-relay.sh
```

电脑访问 <http://127.0.0.1:30141>，手机访问 <https://pi.ai4child.asia>。首次安装、停止/重启、日志、所有脚本和云服务器排障命令见 [Pi Web 启动与手机服务器操作手册](./docs/pi-web-service.zh-CN.md)。

### Later 分支维护入口

- 当前上游基线、验证结果和待办：[项目状态](./PROJECT_STATE.md)
- 自研功能、环境变量和不能破坏的行为：[Later 自研功能与配置清单](./docs/later-customizations.zh-CN.md)
- 在一台新 Linux 服务器从零搭建：[Linux 部署手册](./docs/linux-deployment.zh-CN.md)
- 每日检查上游、合并、提交、推送和高频故障案例：[维护与故障案例手册](./docs/maintenance-playbook.zh-CN.md)

只检查主仓是否有更新，不改当前分支：

```bash
./scripts/check-upstream.sh
```

Basic Auth 不会加密传输中的密码。不要通过明文 HTTP 将 Pi Web 暴露到互联网；远程访问应使用可信反向代理提供 HTTPS，或通过可信 VPN。如果反向代理传递外部主机名，请把该名称精确加入 `PI_WEB_ALLOWED_HOSTS`。这个白名单不会改变 Pi Web 的监听地址。

### HTTP 代理

服务端的模型和 API 请求会读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。

macOS 或 Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## 功能介绍

- **把历史工作接回来**：打开网页就能按项目找到以前的 pi 对话，不必在终端里翻文件或记住会话路径。
- **放心试不同方向**：可以从某条历史消息重新开始，也可以复制出一条独立的新路线，探索方案时不怕弄乱原来的对话。
- **跨分支工作**：在侧边栏切换 Git worktree，让新会话和 Explorer 跟随你选择的 checkout。
- **边聊边看项目文件**：左侧浏览项目文件，右侧打开源码、文档、图片、音频和 PDF；文件变化会自动刷新，适合边让 agent 改边检查结果。
- **随时掌握会话状态**：在顶部就能看到上下文占用、花费、压缩结果和系统提示，长会话不再像黑箱。
- **少离开当前界面**：模型、登录/API key、模型测试和技能开关都能在网页里处理，配置 agent 时不用在多个工具之间来回切换。
- **复核 Chat 执行层**：同时读取`~/.pi/agent/chat-sessions`中的Chat托管转录，以`CHAT · 只读`分类展示；可查看和导出，但不能继续、Fork、重命名或删除。
- **在同一个 Pi Web 内切换执行设备**：受限设备目录与同源粘性网关让手机始终使用同一个 URL、登录、PWA 和界面，桌面顶栏或手机菜单只切换 Mac/Linux/工作站后端；各设备直连 URL 仅用于部署验收和故障回退。

## 注意事项

- **数据目录**：默认读取 `~/.pi/agent/sessions` 下的会话文件。可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录。
- **会话文件**：路径形如 `~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`。
- **Chat托管会话**：额外读取`~/.pi/agent/chat-sessions/<时间戳>_chat-<tool-execution-id>.jsonl`；这些文件是Chat ToolExecution的只读证据，不是pi-web可续聊的普通会话。
- **模型配置**：Models 面板读写 pi agent 目录下的 `models.json`，模型列表和默认模型由 pi 的配置解析得到。
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录。
- **Git worktree**：什么时候显示切换器、新建目录在哪里、删除会影响什么，见 [Pi Web 里的 Worktree](./docs/worktrees.zh-CN.md)。
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件；“Edit from here” 是同一会话文件里的分支。

## 开发

本机 production 与手机公网服务的启动、停止、重启、日志和重新部署方式，见 [Pi Web 启动与手机服务器操作手册](./docs/pi-web-service.zh-CN.md)。

Session、模型、Thinking、上下文、工具验证和停止续接的实践方法，见 [Pi Agent + 模型使用手册](./docs/pi-agent-model-usage.zh-CN.md)。

手机连接多台 Mac/Linux/工作站的同源网关架构、性能与测试边界，见 [多设备接入架构 ADR](./docs/multi-device-architecture.zh-CN.md)。

```bash
npm install
npm run dev
```

开发服务器运行在 [http://127.0.0.1:30141](http://127.0.0.1:30141)。常用检查命令：

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
node --test lib/*.test.mjs components/*.test.mjs hooks/*.test.mjs
```

日常开发时不要运行 `next build` 或 `npm run build`。它们会写入 `.next/`，可能干扰开发服务器；仅在发布流程中执行构建。

贡献者文档：[国际化](./docs/i18n.md)和[发布流程](./docs/release.md)。

## 仓库结构

```text
app/             Next.js 界面和 API 路由
components/      React 界面组件
hooks/           客户端状态和交互 hooks
lib/             会话、智能体、模型、文件、Git 和安全逻辑
public/          静态资源和 PWA 文件
bin/             npm CLI 入口及启动参数解析
docs/            面向用户和贡献者的专题文档
```

架构说明和详细文件地图见 [AGENTS.md](./AGENTS.md)。

## 许可证

[MIT](./LICENSE)
