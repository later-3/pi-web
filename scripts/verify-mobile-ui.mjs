#!/usr/bin/env node

/**
 * verify-mobile-ui.mjs
 *
 * Validates that the mobile UI CSS breakpoints and class names are
 * consistent between globals.css and useIsMobile.ts.
 *
 * Run: node scripts/verify-mobile-ui.mjs
 * Exit 0 on success, 1 on failure.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

let failures = 0;
let passes = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("Mobile UI Verification\n");

// 1. Check that globals.css uses 768px breakpoint
console.log("1. CSS breakpoint consistency");
const css = readFileSync(resolve(root, "app/globals.css"), "utf8");

const mobileBreakpoints = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)]
  .map((m) => Number(m[1]));

const desktopBreakpoints = [...css.matchAll(/@media\s*\(min-width:\s*(\d+)px\)/g)]
  .map((m) => Number(m[1]));

const primaryMobileBps = mobileBreakpoints.filter((bp) => bp >= 700);
check(
  "Primary mobile breakpoint is 768px",
  primaryMobileBps.length > 0 && primaryMobileBps.every((bp) => bp === 768),
  `found: [${[...new Set(primaryMobileBps)].join(", ")}]`,
);

check(
  "All desktop breakpoints are 769px",
  desktopBreakpoints.every((bp) => bp === 769),
  `found: [${[...new Set(desktopBreakpoints)].join(", ")}]`,
);
check(
  "Desktop CSS excludes short coarse-pointer landscape",
  css.includes("(min-height: 501px)") && css.includes("(hover: hover) and (pointer: fine)"),
);

check(
  "No old 640px breakpoints remain",
  !css.includes("max-width: 640px") && !css.includes("min-width: 641px"),
);
check(
  "Mobile CSS covers coarse-pointer landscape",
  css.includes("pointer: coarse") && css.includes("max-height: 500px"),
);

// 2. Check that useIsMobile.ts uses matching query
console.log("\n2. Hook breakpoint consistency");
const hook = readFileSync(resolve(root, "hooks/useIsMobile.ts"), "utf8");

check(
  "useIsMobile uses 768px query",
  hook.includes('(max-width: 768px)'),
);
check(
  "useIsMobile covers coarse-pointer landscape",
  hook.includes("pointer: coarse") && hook.includes("max-height: 500px"),
);

// 3. Check safe-area CSS variables exist
console.log("\n3. Safe-area CSS variables");
check(
  "--safe-area-top defined",
  css.includes("--safe-area-top"),
);
check(
  "--safe-area-bottom defined",
  css.includes("--safe-area-bottom"),
);
check(
  "--safe-area-left defined",
  css.includes("--safe-area-left"),
);
check(
  "--safe-area-right defined",
  css.includes("--safe-area-right"),
);

// 4. Check mobile-specific CSS classes exist
console.log("\n4. Mobile CSS classes");
check(
  ".mobile-topbar class exists",
  css.includes(".mobile-topbar"),
);
check(
  ".mobile-file-toggle class exists",
  css.includes(".mobile-file-toggle"),
);
check(
  ".mobile-composer class exists",
  css.includes(".mobile-composer"),
);
check(
  "Composer keeps safe-area padding inside the card",
  css.includes("padding: 10px 10px max(10px, calc(var(--safe-area-bottom) - 8px))") &&
    css.includes("margin: 8px 10px max(12px, calc(var(--safe-area-bottom) - 20px))"),
);
check(
  ".mobile-textarea class exists",
  css.includes(".mobile-textarea"),
);
check(
  ".mobile-top-panel class exists",
  css.includes(".mobile-top-panel"),
);
check(
  ".app-shell-root uses visual viewport height",
  css.includes("var(--visual-viewport-height, 100dvh)"),
);

// 5. Check key components import useVisualViewport
console.log("\n5. Visual viewport hook");
const appShell = readFileSync(resolve(root, "components/AppShell.tsx"), "utf8");
check(
  "AppShell imports useVisualViewport",
  appShell.includes('useVisualViewport'),
);

// 6. Check MobileDebugOverlay exists and is imported
console.log("\n6. Mobile debug overlay");
check(
  "MobileDebugOverlay component exists",
  readFileSync(resolve(root, "components/MobileDebugOverlay.tsx"), "utf8").length > 100,
);
check(
  "AppShell imports MobileDebugOverlay",
  appShell.includes("MobileDebugOverlay"),
);
check(
  "Installed PWA has an in-app self-check entry",
  appShell.includes("Run mobile self-check") && appShell.includes("mobileDebugOpen"),
);
check(
  "Mobile workspace header is mounted only in the mobile shell",
  appShell.includes("MobileWorkspaceHeader") && appShell.includes("{isMobile && ("),
);
check(
  "Mobile workspace header leaves session selection in the sidebar",
  !appShell.includes("onSelectSession={(session) => handleSelectSession(session)}") &&
    !css.includes(".mobile-session-deck"),
);
check(
  "Mobile workspace header exposes new session",
  appShell.includes("onNewSession={(cwd) => handleNewSession") &&
    readFileSync(resolve(root, "components/MobileWorkspaceHeader.tsx"), "utf8").includes("Create new session in current project"),
);
check(
  "Mobile sidebar starts below the measured header",
  css.includes("top: calc(var(--visual-viewport-offset-top, 0px) + var(--mobile-header-height))") &&
    css.includes("height: calc(var(--visual-viewport-height, 100dvh) - var(--mobile-header-height))"),
);
check(
  "Session rename and delete have a touch action sheet",
  readFileSync(resolve(root, "components/SessionSidebar.tsx"), "utf8").includes("Session actions for") &&
    readFileSync(resolve(root, "components/SessionSidebar.tsx"), "utf8").includes("Rename session") &&
    readFileSync(resolve(root, "components/SessionSidebar.tsx"), "utf8").includes("Delete session"),
);
check(
  "File mention and download have a touch action sheet",
  readFileSync(resolve(root, "components/FileExplorer.tsx"), "utf8").includes("File actions for") &&
    readFileSync(resolve(root, "components/FileExplorer.tsx"), "utf8").includes("Insert into chat") &&
    readFileSync(resolve(root, "components/FileExplorer.tsx"), "utf8").includes("Download file"),
);
check(
  "Visual viewport delegates standalone height calculation",
  readFileSync(resolve(root, "hooks/useVisualViewport.ts"), "utf8").includes("resolveMobileViewport"),
);
check(
  "Mobile shell has theme-ready tokens",
  css.includes("--mobile-surface") && css.includes("--mobile-radius-control"),
);

// 7. Check ChatWindow mobile layout
console.log("\n7. ChatWindow mobile empty layout");
const chatWindow = readFileSync(resolve(root, "components/ChatWindow.tsx"), "utf8");
check(
  "ChatWindow uses justify-between on mobile",
  chatWindow.includes("justify-between"),
);
check(
  "ChatWindow conditionally places composer at bottom on mobile",
  chatWindow.includes("isMobile") && chatWindow.includes("marginTop"),
);

// 8. Check ChatInput mobile font-size
console.log("\n8. ChatInput mobile textarea");
const chatInput = readFileSync(resolve(root, "components/ChatInput.tsx"), "utf8");
check(
  "ChatInput uses 16px font on mobile",
  chatInput.includes("isMobile ? 16 : 14"),
);
check(
  "ChatInput applies mobile-textarea class",
  chatInput.includes("mobile-textarea"),
);
check(
  "ChatInput applies mobile-composer class",
  chatInput.includes("mobile-composer"),
);

const messageView = readFileSync(resolve(root, "components/MessageView.tsx"), "utf8");
check(
  "Message copy actions are visible on mobile",
  messageView.includes("hovered || isMobile") && messageView.includes("mobile-message-action"),
);

// 9. Check docs exist
console.log("\n9. Documentation");
check(
  "mobile-feature-parity.md exists",
  readFileSync(resolve(root, "docs/mobile-feature-parity.md"), "utf8").length > 500,
);

// 10. Check drawer mutual exclusion in AppShell
console.log("\n10. Drawer mutual exclusion");
check(
  "handleSidebarToggle closes rightPanelOpen on mobile",
  appShell.includes("setRightPanelOpen(false)") &&
    appShell.includes("handleSidebarToggle"),
);
check(
  "handleOpenFile closes sidebar on mobile",
  appShell.includes("setSidebarOpen(false)") &&
    appShell.includes("handleOpenFile"),
);

// 11. Check right panel is fixed overlay on mobile
console.log("\n11. Right panel mobile overlay");
check(
  "Right panel uses fixed positioning on mobile",
  css.includes(".right-panel-container") &&
    css.includes("position: fixed !important"),
);
check(
  "Right panel uses transform for slide animation",
  css.includes("transform: translateX(100%)"),
);

// Summary
console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
