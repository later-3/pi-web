# Mobile Feature Parity — Phase 1

This document tracks desktop-to-mobile feature parity for Pi Web.
All features share the same `AppShell` / `ChatWindow` / `ChatInput` / `useAgentSession` stack — no `/mobile` route, no duplicated logic.

## Breakpoint

- **Mobile**: `max-width: 768px`, plus coarse-pointer devices at `max-height: 500px`
- Covers current iPhone portrait and landscape viewports; tablets keep the desktop layout unless their CSS viewport is 768px or narrower

## Safe Area Strategy

- CSS custom properties `--safe-area-top/right/bottom/left` read from `env(safe-area-inset-*)`.
- `viewportFit=cover` is preserved; content is inset via padding/margin so nothing enters the status-bar tap region.
- `useVisualViewport()` switches to the shorter visual viewport only while the software keyboard is open. In an installed iOS PWA it uses the physical CSS `screen.height` while the keyboard is closed, because iOS can report a shorter `100dvh`/`innerHeight` and otherwise leave a blank strip below the composer.
- Soft keyboard: the composer keeps the bottom safe area inside its card rather than as an external blank margin; keyboard-open height still follows the visual viewport.

## Feature Matrix

| Feature | Desktop Entry | Mobile Entry | Status |
|---------|--------------|--------------|--------|
| **Session list / sidebar** | Left sidebar (260px) | Full-width workspace browser with a dedicated Sessions tab | ✅ |
| **New session** | Sidebar "+" button | Persistent header `+` and the same button in the overlay drawer | ✅ |
| **Session select** | Click in sidebar | Searchable list in the full-width workspace browser | ✅ |
| **Project select** | Sidebar selector | Project control in the mobile header → full-width workspace browser | ✅ |
| **Manual refresh** | Sidebar refresh | Mobile overflow sheet header refresh for sessions + files | ✅ |
| **Execution device** | Desktop top-bar selector | Persistent header device pill → dedicated bottom sheet; target reached in 2 taps | ✅ |
| **Session rename / delete** | Hover actions in sidebar | Per-session touch action sheet | ✅ |
| **Session fork** | Fork button on user message | Same button | ✅ |
| **Branch navigator** | Top bar inline button | Same button (compact mode) | ✅ |
| **Continue / navigate_tree** | BranchNavigator dropdown | Same dropdown | ✅ |
| **Send message** | Enter key / Send button | Same (44px touch target) | ✅ |
| **SSE streaming** | Real-time events | Same | ✅ |
| **Steer / Follow-up** | Enter during streaming | Same buttons (44px) | ✅ |
| **Model selector** | Bottom bar dropdown | Same (full-width on mobile, 44px) | ✅ |
| **Thinking level** | Bottom bar dropdown | "More" menu → Thinking | ✅ |
| **Tool preset** | Bottom bar dropdown | "More" menu → Tools | ✅ |
| **Compact** | Bottom bar button | "More" menu → Compact | ✅ |
| **Sound toggle** | Bottom bar speaker icon | "More" menu → Sound | ✅ |
| **Image attach** | Bottom bar image button | Same (44px touch target) | ✅ |
| **Image paste** | Ctrl+V / Cmd+V | Same | ✅ |
| **Copy text** | Message hover copy button | Always-visible 44px action | ✅ |
| **Slash commands** | Type "/" in textarea | Same (grid layout adapts) | ✅ |
| **@ file mention** | Type "@" in textarea | Same | ✅ |
| **Input history** | ArrowUp in empty input | Same | ✅ |
| **System prompt** | Top bar "System" button | Same (icon-only on mobile) | ✅ |
| **Session stats** | Top bar stats button → popover | Same (icon + tap → popover) | ✅ |
| **Full history** | Top bar "Full history" button | Same (icon-only on mobile) | ✅ |
| **Auto-name** | Top bar "Generate title" button | Same (icon-only on mobile) | ✅ |
| **File browser** | Expandable tree in the sidebar | Dedicated Files tab with full-row folder drill-down, breadcrumbs, and All/Changed filters | ✅ |
| **File viewer** | Right panel (42% width) | Full-screen overlay panel opened from the file browser | ✅ |
| **File mention / download** | File-tree hover actions | Per-file touch action sheet | ✅ |
| **File panel toggle** | Fixed top-right button | Same (safe-area aware, 44px) | ✅ |
| **File tabs** | TabBar in right panel header | Same | ✅ |
| **Worktrees** | Sidebar project section | Same | ✅ |
| **Models config** | Sidebar bottom "Models" button | Mobile overflow menu | ✅ |
| **Skills config** | Sidebar bottom "Skills" button | Mobile overflow menu | ✅ |
| **Plugins config** | Sidebar bottom "Plugins" button | Mobile overflow menu | ✅ |
| **Extensions config** | Sidebar bottom "Ext" button | Mobile overflow menu | ✅ |
| **Auth (OAuth/API key)** | ModelsConfig modal | Same modal | ✅ |
| **Theme toggle** | Top bar sun/moon button | Same (44px touch target) | ✅ |
| **Drag & drop images** | Drop onto chat area | Use the same image attachment picker (native mobile alternative) | ✅ |
| **Keyboard shortcuts** | Ctrl+Alt+N, Esc, etc. | N/A (no hardware keyboard) | ✅ (graceful) |
| **Mermaid zoom** | Dialog overlay | Same | ✅ |
| **Directory picker** | Sidebar inline | Same (44px touch targets via CSS) | ✅ |
| **Empty session welcome** | Centered π + composer | Welcome top, composer bottom | ✅ |
| **Minimap** | Right side of chat | Hidden on mobile | ✅ (intentional) |

## Mobile Shell

- The compact header opens a full-width workspace browser below the persistent header. Sessions and files use separate tabs, so neither list loses vertical space to the other.
- The mobile Files tab drills into one directory at a time. A 44px parent control and horizontally scrollable breadcrumbs preserve path context without deep tree indentation.
- Running state still comes from `/api/agent/running/events`, and all chat work stays on the shared `ChatWindow` / `useAgentSession` stack.
- The mobile overflow sheet exposes projects/sessions, files, full history, theme, advanced session controls, and self-check without restoring the desktop toolbar to the primary screen.
- Multi-device installations expose the current execution device beside the project control. Its dedicated sheet keeps the current device disabled, commits visible switching feedback before the workspace transition, traps focus, closes on Escape/backdrop, and restores focus to the trigger.
- Mobile appearance is separated behind `--mobile-*` tokens so future themes can change color, surface, radius, and state styling without changing navigation or session behavior.

## Drawer Mutual Exclusion

On mobile, only one overlay panel can be open at a time:
- Opening workspace browser → closes right panel + top panel dropdowns
- Opening right panel (file viewer) → closes sidebar + top panel dropdowns
- Opening a top panel dropdown → closes sidebar + right panel
- Selecting a session/project in the workspace browser → returns to chat

When every backend tunnel is unavailable, the cloud-owned recovery page says the gateway cannot reach an execution device. It must not claim that the physical Mac or Linux device is offline, because the local service may still be healthy while only the reverse SSH relay is down.

## Horizontal Overflow Prevention

- `html, body { overflow-x: hidden }` on mobile breakpoint
- Code blocks and tables retain their own `overflow-x: auto`
- No page-level horizontal scroll

## Verification

- `?mobileDebug=1` URL parameter shows `MobileDebugOverlay` with live checks
- The mobile sidebar exposes **Run mobile self-check**, so the same live checks can be opened from an installed PWA without an address bar
- Select or create a session before running it; missing topbar/textarea/composer elements are reported as failures rather than silently skipped
- `scripts/verify-mobile-ui.mjs` validates CSS breakpoint consistency (no dependencies)
- `rg --files -g '*.test.mjs' -0 | xargs -0 node --test` — all 314 tests pass
- `tsc --noEmit` — zero type errors
- `npm run lint` — zero lint errors
