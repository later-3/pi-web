"use client";

import { useEffect, useState } from "react";

interface CheckResult {
  label: string;
  pass: boolean;
  detail: string;
}

function getChecks(): CheckResult[] {
  const results: CheckResult[] = [];
  const cs = getComputedStyle(document.documentElement);

  // 1. Standalone mode (PWA)
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  results.push({
    label: "Standalone (PWA)",
    pass: isStandalone,
    detail: isStandalone ? "display-mode: standalone" : "browser tab",
  });

  // 2. Safe-area insets readable
  const safTop = cs.getPropertyValue("--safe-area-top").trim();
  const safBottom = cs.getPropertyValue("--safe-area-bottom").trim();
  const hasSafeArea = safTop !== "" && safBottom !== "";
  results.push({
    label: "Safe-area CSS vars",
    pass: hasSafeArea,
    detail: `top=${safTop || "0px"} bottom=${safBottom || "0px"}`,
  });

  // 3. No horizontal overflow on body
  const body = document.body;
  const root = document.documentElement;
  const scrollWidth = Math.max(body.scrollWidth, root.scrollWidth);
  const clientWidth = root.clientWidth;
  const hasOverflowX = scrollWidth > clientWidth + 1;
  results.push({
    label: "No horizontal overflow",
    pass: !hasOverflowX,
    detail: `scroll=${scrollWidth} client=${clientWidth}`,
  });

  // 4. Top bar respects safe area
  const topBar = document.querySelector(".mobile-session-header, .mobile-topbar");
  if (topBar) {
    const rect = topBar.getBoundingClientRect();
    const firstControl = topBar.querySelector("button");
    const controlRect = firstControl?.getBoundingClientRect();
    const safeTop = parseFloat(safTop) || 0;
    const visibleTop = window.visualViewport?.offsetTop ?? 0;
    const expectedTop = visibleTop + safeTop;
    const topBarOk = Boolean(controlRect) && controlRect!.top >= expectedTop - 1;
    results.push({
      label: "Topbar safe area",
      pass: topBarOk,
      detail: `bar=${rect.top.toFixed(0)} control=${controlRect?.top.toFixed(0) ?? "?"} expected≥${expectedTop.toFixed(0)}`,
    });
  } else {
    results.push({ label: "Topbar safe area", pass: false, detail: "topbar missing" });
  }

  // 5. Textarea font-size >= 16px
  const textarea = document.querySelector("textarea");
  if (textarea) {
    const fs = parseFloat(getComputedStyle(textarea).fontSize);
    results.push({
      label: "Textarea ≥ 16px",
      pass: fs >= 16,
      detail: `${fs}px`,
    });
  } else {
    results.push({ label: "Textarea ≥ 16px", pass: false, detail: "select or create a session" });
  }

  // 6. Composer visible
  const composer = document.querySelector(".mobile-composer");
  if (composer) {
    const rect = composer.getBoundingClientRect();
    const vv = window.visualViewport;
    const visualBottom = (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight);
    const shellBottom = document.querySelector(".app-shell-root")?.getBoundingClientRect().bottom;
    const keyboardOpen = document.documentElement.dataset.virtualKeyboard === "open";
    // In a closed standalone PWA, WebKit can under-report VisualViewport by
    // exactly the omitted safe areas. The 100vh shell is the resting viewport.
    const visibleBottom = keyboardOpen
      ? visualBottom
      : Math.max(visualBottom, shellBottom ?? visualBottom);
    const composerVisible = rect.bottom <= visibleBottom + 2;
    results.push({
      label: "Composer visible",
      pass: composerVisible,
      detail: `bottom=${rect.bottom.toFixed(0)} visible=${visibleBottom.toFixed(0)}`,
    });

    // A composer can be technically visible while the entire application has
    // been sized to a stale short iOS PWA viewport. Allow exactly the normal
    // 8px gap or the device safe area, plus a small sub-pixel tolerance.
    const safeBottom = parseFloat(safBottom) || 0;
    const bottomGap = Math.max(0, visibleBottom - rect.bottom);
    const expectedGap = Math.max(8, safeBottom);
    results.push({
      label: "Composer bottom gap",
      pass: bottomGap <= expectedGap + 4,
      detail: `gap=${bottomGap.toFixed(0)} expected≤${(expectedGap + 4).toFixed(0)}`,
    });
  } else {
    results.push({ label: "Composer visible", pass: false, detail: "select or create a session" });
    results.push({ label: "Composer bottom gap", pass: false, detail: "composer missing" });
  }

  // 7. Drawer count (sidebar + right panel should not both be open)
  const sidebarOpen = document.querySelector(".sidebar-container.sidebar-open");
  const rightPanelOpen = document.querySelector(
    ".right-panel-container.right-panel-open",
  );
  const drawerCount = (sidebarOpen ? 1 : 0) + (rightPanelOpen ? 1 : 0);
  results.push({
    label: "Drawer exclusivity",
    pass: drawerCount <= 1,
    detail: `open=${drawerCount}`,
  });

  // 8. Main touch targets >= 44px
  const touchTargets = document.querySelectorAll(
    ".mobile-session-shell button, .mobile-topbar button, .mobile-composer button, .mobile-message-action, .markdown-code-action",
  );
  let allTouchTargetsOk = true;
  let smallestTarget = 999;
  let visibleTargetCount = 0;
  touchTargets.forEach((btn) => {
    const r = btn.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    visibleTargetCount += 1;
    const minDim = Math.min(r.width, r.height);
    if (minDim < smallestTarget) smallestTarget = minDim;
    if (minDim < 44) allTouchTargetsOk = false;
  });
  results.push({
    label: "Touch targets ≥ 44px",
    pass: visibleTargetCount > 0 && allTouchTargetsOk,
    detail: `count=${visibleTargetCount} smallest=${smallestTarget === 999 ? "?" : smallestTarget.toFixed(0)}px`,
  });

  return results;
}

export function MobileDebugOverlay({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const [queryRequested, setQueryRequested] = useState(false);
  const [checks, setChecks] = useState<CheckResult[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setQueryRequested(params.get("mobileDebug") === "1");
  }, []);

  const visible = open || queryRequested;

  useEffect(() => {
    if (!visible) return;
    const refresh = () => setChecks(getChecks());
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  const allPass = checks.length > 0 && checks.every((c) => c.pass);

  return (
    <div
      style={{
        position: "fixed",
        bottom: "max(8px, var(--safe-area-bottom, 0px))",
        left: "max(8px, var(--safe-area-left, 0px))",
        right: "max(8px, var(--safe-area-right, 0px))",
        zIndex: 9999,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "8px 12px",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--text)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        maxHeight: "40vh",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <span style={{ fontWeight: 700 }}>
          Mobile Debug{" "}
          <span style={{ color: allPass ? "#10b981" : "#ef4444" }}>
            {allPass ? "✓ ALL PASS" : "✗ ISSUES"}
          </span>
        </span>
        <button
          onClick={() => {
            setQueryRequested(false);
            onClose?.();
          }}
          aria-label="Close mobile debug overlay"
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 18,
            padding: 0,
            width: 44,
            height: 44,
          }}
        >
          ×
        </button>
      </div>
      {checks.map((check) => (
        <div
          key={check.label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 0",
          }}
        >
          <span
            style={{
              color: check.pass ? "#10b981" : "#ef4444",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {check.pass ? "●" : "○"}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>{check.label}</span>
          <span
            style={{
              color: "var(--text-dim)",
              flexShrink: 0,
              fontSize: 10,
            }}
          >
            {check.detail}
          </span>
        </div>
      ))}
    </div>
  );
}
