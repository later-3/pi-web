# Pi Web PWA 安装指南

## 前提条件

⚠️ **Pi Web 需要 Mac 服务端在线**。这是一个纯客户端壳，所有功能（会话、聊天、SSE 流、认证）都依赖远端 Mac 上运行的 Pi agent。离线状态下应用不可用。

PWA 安装仅影响「打开方式」——以独立窗口运行、显示自定义图标——不改变任何功能逻辑。

---

## 安装步骤

### Android Chrome

1. 用 Chrome 打开 `https://pi.ai4child.asia`
2. 点击浏览器右上角菜单（⋮）或地址栏右侧图标
3. 选择「安装应用」/「Add to Home screen」/「Install app」
4. 确认安装

安装后从主屏幕启动，Pi Web 以 standalone 模式运行（无地址栏、无浏览器 UI）。

### iOS Safari（iPhone / iPad）

1. 用 Safari 打开 `https://pi.ai4child.asia`
2. 点击底部分享按钮（□↑）
3. 向下滑动，选择「添加到主屏幕」/「Add to Home Screen」
4. 点击右上角「添加」

> **注意**：现代 iOS Safari 支持 Web App Manifest；Next.js 的 `appleWebApp.capable` 同时作为 Apple 平台兼容补充。iOS 16.4+ 支持从主屏幕启动的 PWA 使用 Web Push。

### 验证安装成功

- 主屏幕出现 Pi 图标
- 启动后无浏览器地址栏和工具栏
- 状态栏颜色为蓝色（`theme-color: #2563eb`）

---

## 技术实现

### Web App Manifest

由 `app/manifest.ts` 通过 Next.js 原生 metadata API 生成，路由 `/manifest.webmanifest`。

| 字段 | 值 | 说明 |
|------|-----|------|
| `display` | `standalone` | 独立窗口，无浏览器 UI |
| `start_url` | `/` | 启动页面 |
| `scope` | `/` | 导航范围 |
| `theme_color` | `#2563eb` | 状态栏/标题栏颜色 |
| `background_color` | `#1a1a1a` | 启动屏背景色（深色） |
| `orientation` | `any` | 不锁定方向 |

### 图标

| 文件 | 尺寸 | 用途 |
|------|------|------|
| `icon-192x192.png` | 192×192 | manifest 标准图标 |
| `icon-512x512.png` | 512×512 | manifest 标准图标 |
| `icon-maskable-192x192.png` | 192×192 | Android 自适应图标（maskable） |
| `icon-maskable-512x512.png` | 512×512 | Android 自适应图标（maskable） |
| `apple-touch-icon.png` | 180×180 | iOS 主屏幕图标 |

所有图标从 `app/favicon.ico`（π 符号）生成，maskable 版本在蓝色背景上居中放置图标（70% 尺寸），确保在 Android 各种形裁剪安全区内。

### Service Worker

**策略：不拦截任何请求。**

`public/sw.js` 是一个最小化 Service Worker：
- ✅ 处理 `install` / `activate` 生命周期
- ✅ `skipWaiting()` + `clients.claim()` 确保更新即时生效
- ✅ 接收 Web Push、显示完成通知并处理会话深链
- ✅ 响应 `GET_SW_VERSION` 消息用于诊断
- ❌ 不注册 `fetch` 事件——所有请求直达网络
- ❌ 不缓存任何资源

**为什么不缓存？**
- Pi Web 是服务端渲染应用，离线时无法工作
- 缓存 HTML 会导致部署后页面陈旧
- 缓存 `/api/**` 会破坏 SSE 流、认证、会话操作
- POST 请求不能被 SW 正确重放
- 缓存登录页或认证响应会导致过期状态无法可靠恢复

**更新机制：**
- `/sw.js` 响应头设置为 `no-cache, no-store, must-revalidate`
- 浏览器每次加载页面时都会重新请求 SW 文件
- 文件内容变化（`SW_VERSION` 更新）触发 `install` → `activate` 流程
- 旧 SW 被替换，新 SW 立即接管

### 完成推送

聊天输入区右下角的“运行设置”按钮会在输入框上方打开两列设置面板，其中的推送项用于开启、关闭或重试推送。首次开启会立即发送一条测试通知；之后由服务端在 `agent_end` 时发送：

- 标题：`Pi 已完成`
- 正文：`会话名 · 最后回复摘要`，摘要最多 120 个字符
- 点击：打开 `/?session=<sessionId>` 对应会话
- 隔离：只向发起该任务的登录账号所绑定设备发送

推送项使用文字显示真实状态：`已开启`、`已关闭`、`待测试`、`发送失败`、`系统已阻止`。系统通知权限已开启不等于 Web Push 订阅已经验证；只有测试通知成功投递后才显示 `已开启`。

VAPID 密钥和设备订阅保存在 `~/.pi/agent/pi-web-push.json`，权限为 `0600`。过期订阅收到推送服务的 `404/410` 后自动清理。可用 `PI_WEB_PUSH_SUBJECT` 指定 VAPID 联系主体；反向代理提供 HTTPS 外部 Origin 时无需额外配置。

iOS 上必须满足 3 个条件：iOS/iPadOS 16.4+、已添加到主屏幕并以 Web App 打开、由用户点击铃铛触发系统授权。普通 Safari 标签页不能订阅 iPhone Web Push。

### 缓存策略总结

| 资源 | Cache-Control | 原因 |
|------|---------------|------|
| `/`（HTML） | `private, no-cache, must-revalidate` | 始终获取最新版本 |
| `/login` | `private, no-store, max-age=0` | 登录状态必须实时判断 |
| `/api/auth/session` | `private, no-store, max-age=0` | 禁止缓存认证响应 |
| `/manifest.webmanifest` | `public, no-cache, max-age=0, must-revalidate` | 安装元数据随部署更新 |
| `/sw.js` | `no-cache, no-store, must-revalidate` | SW 更新检测 |
| `/icon-*.png` | `public, max-age=86400, stale-while-revalidate=604800` | 固定文件名，一天后允许后台更新 |
| `/apple-touch-icon.png` | `public, max-age=86400, stale-while-revalidate=604800` | 固定文件名，一天后允许后台更新 |
| `/api/**` | 不额外设置 | 由各 route handler 决定 |
| SSE / EventSource | 不经过 SW | SW 无 fetch handler |

---

## 不影响的功能

以下功能与 PWA 认证恢复机制协同工作：

- ✅ 独立 `/login` 页面（不依赖浏览器原生密码框）
- ✅ HttpOnly 签名 Cookie（密码不保存在浏览器中）
- ✅ PWA 从后台恢复时检查登录状态
- ✅ API 返回 401 时立即跳转登录页，并保留原会话 URL
- ✅ SSE 重连由认证心跳兜底，最长 60 秒进入登录页
- ✅ SSE 流式传输（无 fetch handler）
- ✅ 图片上传（POST 不经过 SW）
- ✅ 复制粘贴（standalone 模式保留剪贴板 API）
- ✅ 历史 session 浏览
- ✅ 新建 session
- ✅ 所有 `/api/**` 端点

---

## 已知限制

1. **离线不可用**：Mac 必须在线，否则所有功能不可用。PWA 不提供离线能力。
2. **iOS 无安装提示**：iOS Safari 不会自动弹出「安装」提示，需用户手动通过分享菜单添加。
3. **iOS 无 SW 更新通知**：iOS Safari 对 SW 更新较保守，但本项目 SW 不缓存内容，所以无影响。
4. **standalone 模式无地址栏**：用户无法在 PWA 窗口中看到 URL，需通过应用内导航。
5. **iOS 不支持 beforeinstallprompt**：仅 Android Chrome 支持程序化触发安装提示。
