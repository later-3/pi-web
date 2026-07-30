"use client";

import { useEffect } from "react";
import { resolveMobileViewport } from "@/lib/mobile-viewport";

/**
 * Tracks the browser Visual Viewport only while an editable control has focus
 * and the software keyboard is actually reducing the visible area. At rest,
 * CSS owns the shell height: `100vh` in an installed iOS app (WebKit's
 * viewport-fit workaround) and `100dvh` in an ordinary browser tab.
 *
 * AppShell consumes these variables in CSS, so this hook intentionally does
 * not keep React state or re-render the entire application while the keyboard
 * animates.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    let focusFrame = 0;

    const hasEditableFocus = () => {
      const active = document.activeElement;
      return active instanceof HTMLElement
        && active.matches("textarea, input, [contenteditable]:not([contenteditable='false'])");
    };

    const update = () => {
      const standalone = window.matchMedia("(display-mode: standalone)").matches
        || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const viewport = resolveMobileViewport({
        innerHeight: window.innerHeight,
        visualHeight: vv?.height ?? window.innerHeight,
        visualOffsetTop: vv?.offsetTop ?? 0,
        visualScale: vv?.scale ?? 1,
        editableFocused: hasEditableFocus(),
        standalone,
      });

      document.documentElement.style.setProperty(
        "--visual-viewport-height",
        viewport.height,
      );
      document.documentElement.style.setProperty(
        "--visual-viewport-offset-top",
        viewport.offsetTop,
      );
      document.documentElement.dataset.virtualKeyboard = viewport.keyboardOpen
        ? "open"
        : "closed";
    };

    const updateAfterFocusChange = () => {
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(update);
    };

    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("focusin", updateAfterFocusChange);
    document.addEventListener("focusout", updateAfterFocusChange);
    document.addEventListener("visibilitychange", update);
    update();

    return () => {
      cancelAnimationFrame(focusFrame);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("focusin", updateAfterFocusChange);
      document.removeEventListener("focusout", updateAfterFocusChange);
      document.removeEventListener("visibilitychange", update);
      document.documentElement.style.removeProperty("--visual-viewport-height");
      document.documentElement.style.removeProperty("--visual-viewport-offset-top");
      delete document.documentElement.dataset.virtualKeyboard;
    };
  }, []);
}
