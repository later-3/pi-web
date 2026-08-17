# OPC OS Pi 唯一源码绑定

## 目标

Later Pi Web 不运行 npm registry 中独立安装的 Pi 实现。`opc-os/pi` monorepo 是 Pi CLI 与 Pi Web 的唯一代码来源；两者仍共享 `${PI_CODING_AGENT_DIR:-~/.pi/agent}` 下的配置、模型和 Session 数据。

Pi Web 不启动 `pi` CLI 子进程。它继续在 Next.js 服务进程中创建 `AgentSession`，但 `@earendil-works/pi-*` 模块必须解析到 OPC workspace 构建产物。

## 本地路径

默认从 Pi Web 相邻位置发现源码：

```text
<Code>/pi-web
<Code>/opc-os/pi
```

`package.json` 使用以上布局的相对 `file:` 依赖和 overrides，使 npm/Bun 的直接与传递 Pi 解析都指向 OPC workspace，使 `npm ci` 在 OPC 源码缺失时直接失败，并避免把某台设备的绝对路径写入 lockfile。路径不同的临时开发环境可在依赖已安装后设置：

```bash
PI_WEB_PI_SOURCE_DIR=/absolute/path/to/opc-os/pi
```

正式 Mac/Linux 节点必须保持相邻目录布局；不得把设备绝对路径写入 `package.json`、lockfile 或 Git。`PI_CODING_AGENT_DIR` 是数据目录，不是代码目录，不能替代源码绑定。

## 准备与验证

首次安装、执行 `npm ci`、切换 Pi commit 或修改 Pi 源码后运行：

```bash
npm run pi:prepare
```

该命令执行 OPC monorepo 的 `build:offline`，计算实际运行依赖闭包，并把 Pi Web `node_modules/@earendil-works/pi-*` 中对应包替换为本机源码链接。当前直接入口是 coding-agent、agent-core、ai 和 tui；升级后的 client、protocol、telemetry 等本地依赖会从 workspace manifest 自动进入闭包。若新闭包成员尚未在 `package.json.overrides` 声明本地 `file:` 路径，prepare 会先失败，要求同步更新 manifest 与 npm/Bun lockfile，禁止短暂回退到 registry。

只验证、不构建：

```bash
npm run pi:verify
```

验证覆盖源码 Git 指纹、构建产物摘要、包链接真实路径和入口文件。开发、production build、npm start、Mac 管理脚本、Linux systemd 与 Next.js instrumentation 都会 fail closed；链接被 `npm ci` 覆盖、源码或 dist 在 prepare 后变化、或 production 使用脏 Pi worktree 时拒绝启动。

Pi Web 的 `package.json` 直接声明相对 OPC workspace，不保存可运行的 registry Pi 回退。源码包自身仍使用上游 lockstep 版本；两仓升级必须一起审查 API、TypeScript 与真实 Session 回归。

## Session 数据

默认 Agent 根目录由 Pi 的 `getAgentDir()` 决定：

```text
${PI_CODING_AGENT_DIR:-~/.pi/agent}
```

普通 Pi CLI 与 Pi Web Session：

```text
~/.pi/agent/sessions/<编码后的-cwd>/*.jsonl
```

Chat 托管、只允许 Pi Web 浏览的执行转录：

```text
~/.pi/agent/chat-sessions/*.jsonl
```

两类都在同一个 Agent 根目录下。`PI_CODING_AGENT_DIR` 会改变 CLI 与 Pi Web 的共享 Agent 根；CLI 还可以通过 `--session-dir`、`PI_CODING_AGENT_SESSION_DIR` 或 `settings.json.sessionDir` 改写普通 Session 位置。Pi Web 当前直接把 `undefined` 传给 SDK `SessionManager`，因此固定使用共享 Agent 根下的默认 `sessions/`；当前上述两个环境变量均未设置且 `settings.json.sessionDir=null`，CLI 与 Pi Web 没有产生位置分叉。测试必须传入临时 sessionDir，禁止向真实目录写入 faux Session。

其它基于 Pi 的独立服务可以有自己的受管目录。当前 `pi-taskd` 为每次委派显式传入 `--session-dir`，保存于 `~/.local/share/pi-taskd/runtime/sessions/<attempt-id>/`；image canary 使用独立的 `pi-taskd-image-canary` 根。这些不是 Pi Web/CLI 的 Session，也不会被 Pi Web Session 列表读取。`opc-os/agent_knowledge` 下以 JSONL 保存的复核事件属于研究归档，不是活跃运行存储。若以后要求整台机器只有一个物理数据根，需要另行迁移 pi-taskd，不能把其并发任务目录直接混入 Pi Web 的 `sessions/`。

## 双设备部署

Mac 与 Linux 必须各自拥有 OPC Pi checkout，并部署同一对精确 commit：

1. OPC Pi commit；
2. Pi Web commit。

每台设备依次执行 OPC 安装/构建、Pi Web `npm ci`、`npm run pi:prepare`、`npm run pi:verify -- --production` 和 Pi Web production build。缺少 OPC checkout 的设备不是可部署的 Pi Web 节点。Session、Provider 凭据和 Agent 进程仍保持设备本地，不因源码版本一致而自动同步。
