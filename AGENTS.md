# Pi Web - Development Notes

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

## Cross-device access

Mac、Pop!_OS 与云服务器的可提交事实位于 `ops/device-inventory.json`，完整操作说明见 `docs/device-access.zh-CN.md`，新增/下线/轮换流程见 `docs/device-onboarding.zh-CN.md`。访问或配置另一台设备时：

1. 先运行 `./scripts/device-access.sh facts <device-id>`，不要依赖会变化的 LAN IP；跨网 SSH 别名固定为 `later-mac`、`later-pop`、`later-cloud-admin`。
2. 使用 `./scripts/device-access.sh run <device-id> -- <command>` 或 `ssh <alias>`；Pop!_OS 的独立安装副本是 `/home/later/.local/share/later-device-access/scripts/device-access.sh`。
3. 设备 id 为 `mac-main`、`linux-home`、`cloud-relay`。`audit all` 做完整只读检查；`probe all` 只验证连通；`verify-write all` 会创建权限 `600` 的临时文件并立即删除。
4. Inventory 只能保存账号、地址、路径、认证方式和公钥指纹；密码、私钥、Token、Cookie、Provider Key 与会话密钥不得写入 Git、聊天、命令参数或日志。
5. 管理链路使用云端 loopback 反向 SSH relay；不得把 `33101/33102` 监听改到公网，也不得放宽云端 `permitopen`/`permitlisten` 白名单。
6. 新增、下线或修改设备路由时，只更新 inventory 与 tracked public keys；运行 `check → render-device-ssh-config → test-device-access → install-cloud --plan`。不得直接手改生成的 `deploy/device-access/ssh-config` 或各机器 installed SSH config。

## Project Recovery & Maintenance

Before substantial work, read `PROJECT_STATE.md` and the relevant document:

- `docs/later-customizations.zh-CN.md` — Later-only features, configuration, and invariants
- `docs/linux-deployment.zh-CN.md` — clean Linux deployment and rollback
- `docs/maintenance-playbook.zh-CN.md` — upstream sync procedure and recurring incident cases
- `docs/pi-web-service.zh-CN.md` — current Mac/mobile production operations

Run `./scripts/check-upstream.sh` before the first development session of the day or whenever upstream sync is requested. The check may fetch, but it must never auto-merge. Save a dirty worktree as reviewed commits before merging `upstream/main`, then update `PROJECT_STATE.md` with the upstream commit and validation evidence.

Before pushing Later-only work, verify that `origin` is the intended private repository. Do not rely on the repository name or owner as proof of visibility.

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running ───────▶ running id snapshot   │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** (read-only): reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
app/api/
  sessions/route.ts               GET  list all sessions
  sessions/[id]/route.ts          GET/PATCH/DELETE session
  sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
  sessions/[id]/export/route.ts   GET exported HTML for a session
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET state | POST any command
  agent/[id]/events/route.ts      GET SSE stream
  agent/running/route.ts          GET currently-running session ids
  agent/running/events/route.ts   GET SSE stream of currently-running session ids
  auth/session/route.ts           GET/POST/DELETE Pi Web app login session
  auth/all-providers/route.ts     GET API-key provider list
  auth/api-key/[provider]/route.ts GET/POST/DELETE provider API key status/storage
  auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts POST OAuth logout
  auth/providers/route.ts         GET OAuth provider list
  cwd/validate/route.ts           POST validate/select a cwd
  default-cwd/route.ts            POST create ~/pi-cwd-YYYYMMDD
  files/[...path]/route.ts        GET file contents for viewer
  home/route.ts                   GET user home directory
  models/route.ts                 GET { models, modelList, defaultModel }
  models-config/route.ts          GET/PUT — read/write ~/.pi/agent/models.json
  models-config/catalog/route.ts  GET models.dev pricing presets
  models-config/discover/route.ts POST fetch a configured provider's upstream model list
  models-config/test/route.ts     POST test a configured model/provider
  devices/route.ts                GET non-sensitive current/configured device directory
  devices/select/route.ts         POST same-origin gateway device preference cookie
  plugins/route.ts                GET/POST package plugin management
  skills/route.ts                 GET/PATCH loaded skills and disable-model-invocation
  skills/install/route.ts         POST install skills through npx skills add
  skills/search/route.ts          GET/POST skills.sh search
  worktrees/route.ts              GET/POST/DELETE git worktrees

app/login/
  page.tsx                        public app-owned login route for PWA recovery

lib/
  agent-client.ts      typed fetch helper for /api/agent commands
  draft-store.ts       local draft persistence helpers
  file-access.ts       allowed file roots for /api/files and worktrees
  file-paths.ts        client/server path encoding helpers
  markdown.ts          shared markdown helpers
  npx.ts               npx runner used by skill install
  pi-types.ts          local structural types for pi SDK objects
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  tool-presets.ts     PRESET_NONE/DEFAULT/FULL + getPresetFromTools()
  types.ts            shared TypeScript types
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  web-auth.ts         signed app-session tokens + auth configuration
  device-directory-core.ts pure device validation, normalization, and limits
  device-directory.ts environment/file adapter with bounded metadata cache
  device-selection.ts gateway cookie/body constants
  device-selection-client.ts bounded same-origin selection request
  request-origin.ts  shared reverse-proxy-aware external origin metadata
  worktree.ts         project/worktree resolution and git worktree operations

components/
  AuthSessionMonitor.tsx redirects expired fetch/SSE/PWA sessions to /login
  AppShell.tsx        layout + URL state + tab management
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      chat composition + completion sound wrapper
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  ChatMinimap.tsx     scroll minimap alongside the message list
  MarkdownBody.tsx    markdown renderer
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  PluginsConfig.tsx   modal for installed package plugins
  SkillsConfig.tsx    modal for loaded/search/installable skills
  FileExplorer.tsx    file tree inside sidebar
  FileIcons.tsx       file icon helpers
  FileViewer.tsx      file content in a tab
  TabBar.tsx          tab bar (Chat + open file tabs)
  DeviceSwitcher.tsx desktop/mobile multi-device selector

hooks/
  useAgentSession.ts  messages + streaming + SSE + fork/navigate/reconciliation logic
  useAudio.ts         completion sound + browser AudioContext unlock
  useDragDrop.ts      shared drag/drop state
  useIsMobile.ts      responsive breakpoint hook
  useTheme.ts         theme state
  useDeviceDirectory.ts one-shot device directory fetch with timeout/abort
```

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

### Fork must destroy the wrapper immediately
`AgentSession.fork()` **mutates the wrapper's inner state in-place** — after fork, `inner.sessionId` is the *new* session's id. If the wrapper stays alive in the registry under the old id, the next request gets the already-forked state and subsequent forks produce a corrupt `parentSession` chain.

**Fix**: `send("fork")` captures `newSessionId`, then calls `this.destroy()` before returning. The next request for the original session reloads a clean AgentSession from the original file.

### Two kinds of branching — don't confuse them
- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** (Continue button / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()` (streaming).

### New session tool preset
Tool names are passed at session creation (`POST /api/agent/new` → `toolNames[]`). For existing sessions, the active preset is inferred on mount via `get_tools` → `getPresetFromTools()`. When tools are fully disabled (`toolNames = []`), `rpc-manager.ts` passes an empty tool allow-list and forces `agent.state.systemPrompt = ""` after startup/reload/resource discovery.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions. Explicit browser model/thinking selections are applied atomically during AgentSession construction, then `lib/startup-preferences.ts` persists their effective values without replaying `set_model`/`set_thinking_level`; implicit `enabledModels` fallbacks and thinking pins are not persisted.

### `enabledModels` scoping
The `enabledModels` setting uses pi's `--models` syntax: minimatch globs against `provider/modelId` or a bare `modelId`, fuzzy matching for non-glob patterns, and an optional `:thinkingLevel` suffix. Never compare those patterns as literal strings — `lib/model-scope.ts` delegates to the SDK's `resolveModelScopeWithDiagnostics()` so pi-web and the TUI agree on the visible model list, and falls back to all available models when patterns resolve to nothing. `startRpcSession()` resolves that scope before creating an AgentSession and passes the selected initial model, thinking pin, and SDK-native `scopedModels` atomically; `GET /api/models` reuses the helper only for selector data, `thinkingLevelPins`, and `modelScopeWarnings` display.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Running state polling + reconciliation
- The sidebar polls `/api/agent/running` every 2.5 seconds while the tab is visible and pauses polling in background tabs. The session-list response remains the initial fallback.
- `useAgentSession` treats per-session SSE as primary for chat events and opens it before each prompt. `prompt_done` completes the current UI stage and notification immediately, but the idle SSE stays open for a 30-second grace window and is reused by the next prompt. `agent_start` cancels that close timer; `agent_settled` finishes extension-injected runs that have no wrapper-level `prompt_done` and starts a fresh grace window. Do not close on the first `agent_end`: retries, compaction, and extension-queued messages can continue the same logical prompt.
- While a run is active, `useAgentSession` periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed terminal events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.

### File access allow-list
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/pi-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.

### Plugins and skills
- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

### Auth and model config
- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- Pi Web application login supports multiple accounts from `PI_WEB_AUTH_CREDENTIALS_FILE`; signed cookies are bound to the matching account. The legacy single-account username/password-file settings remain supported.
- Provider listing is capability-driven, never id-driven: `lib/provider-listing.ts` decides membership from `auth.apiKey.login` / `auth.oauth` plus the stored credential type, so dual-auth providers (anthropic and github-copilot today — which providers declare both changes between SDK releases, so never assume it from an id) appear exactly once and never fall through both lists (#309). `lib/provider-listing-runtime.ts` adapts `ModelRuntime` to those pure helpers.
- auth.json holds **one** credential per provider and `ModelRuntime.logout()` deletes whichever it is. The delete routes therefore use `removeStoredCredentialIfType()` to compare and delete under the same file lock used by pi's auth storage. `ModelsConfig` also refreshes *both* provider lists after any auth change — refreshing one leaves a dual-auth provider rendered twice.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must never return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is not a real route.

### PWA app authentication
- Public mobile deployment uses the app-owned `/login` route, not Nginx `auth_basic`; native Basic Auth prompts are unreliable in installed iOS PWAs.
- Upstream `PI_WEB_PASSWORD` Basic Auth remains available for simple non-PWA deployments, but it is mutually exclusive with every `PI_WEB_AUTH_*` app-login setting. Configuring both fails closed with `503`.
- `proxy.ts` protects pages and APIs with the signed `pi-web-session` HttpOnly cookie while allowing only login prerequisites, static app assets, and `/api/health` through.
- Authentication is disabled for ordinary local development unless any `PI_WEB_AUTH_*` variable is present. Partial configuration fails closed with `503`.
- Password and cookie-signing key stay in separate gitignored files. Rotating the password invalidates existing cookies through the token credential fingerprint.
- `AuthSessionMonitor` redirects `401` fetch responses immediately and checks `/api/auth/session` every 60 seconds plus `visibilitychange`/`online`/`pageshow`, covering EventSource reconnects that hide their HTTP status.

### Multi-device access
- Phase 1 uses a bounded, non-sensitive JSON device directory plus `PI_WEB_DEVICE_*` environment metadata. Invalid configuration hides the switcher but never blocks the current device.
- Device reachability is demand-driven: do not probe on startup, intervals, `online`, or `visibilitychange`. A normal send has no preflight; after a real send/SSE connection failure, probe health once. Device switching and the explicit retry button also probe exactly once. UI wording must describe gateway reachability, not claim that the physical device is offline.
- `AppShell` loads `/api/devices` once; parsing and file IO stay in `lib/device-directory*`, while `DeviceSwitcher` owns only interaction and navigation.
- When `PI_WEB_DEVICE_GATEWAY_URL` matches the external request origin, switching POSTs to `/api/devices/select`, sets the HttpOnly `pi_web_device` preference, and reloads the same origin. Other origins retain direct-URL fallback behavior.
- The gateway must map only known cookie values, default unknown values to the primary device, and route `/api/devices/select` through the primary control plane so users can switch back from an unavailable worker.
- All devices behind one gateway origin must run a compatible build and share the application credentials/session-signing secret. Sessions, files, Provider credentials, Agent state, and Pi data remain device-local.
- Direct per-device origins are break-glass/maintenance adapters, not the normal phone UX. Health aggregation and centralized Push brokering remain later gateway work.
- Do not implement runtime `/devices/<id>` path-prefix proxying inside Pi Web: Next.js `basePath` is build-time, while the app, APIs, manifest, and Service Worker use root paths.
- Full decision, performance budgets, failure modes, and SSH deployment sequence: `docs/multi-device-architecture.zh-CN.md`.

### Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

### Linux production process ownership
- The tracked Pop!_OS unit is `deploy/linux/pi-web.service`. systemd must execute Node + Next CLI directly with `PI_WEB_DIST_DIR=.next-mobile`; do not restore an `npm run start:mobile` wrapper.
- The npm → shell → next-server chain can survive a 30-second stop timeout as an orphan. It may keep `/api/health` green while the unit loops in `activating (auto-restart)` because the port is occupied.
- Before any restart, authenticate to `/api/agent/running` and wait for zero running sessions. Deployment success requires all three: health `200`, `systemctl is-active pi-web` exactly `active`, and the port listener owned by the unit cgroup.
- Never use broad `killall node`. When recovery is necessary, capture unit/cgroup/port/PGID evidence and reclaim only the verified Pi Web process after running sessions have naturally settled.

### Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then patches recursive tree helpers in the generated HTML to iterative versions so very deep linear sessions do not overflow the browser call stack.

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```
