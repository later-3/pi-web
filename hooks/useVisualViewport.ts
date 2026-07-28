"use client";

import { useEffect } from "react";
import { resolveMobileViewport } from "@/lib/mobile-viewport";

/**
 * Tracks the browser visualViewport while the software keyboard is open.
 * A closed iOS standalone PWA can report a visual viewport that excludes the
 * home-indicator region even though CSS `100dvh` includes it. Applying that
 * shorter value all the time leaves a conspicuous blank strip below the app.
 * We therefore keep the normal dynamic viewport until the visual viewport is
 * substantially shorter, which is the signal that the keyboard is covering it.
 *
 * AppShell consumes these variables in CSS, so this hook intentionally does
 * not keep React state or re-render the entire application while the keyboard
 * animates.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;

    const update = () => {
      const standalone = window.matchMedia("(display-mode: standalone)").matches
        || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const viewport = resolveMobileViewport({
        innerHeight: window.innerHeight,
        visualHeight: vv?.height ?? window.innerHeight,
        visualOffsetTop: vv?.offsetTop ?? 0,
        screenHeight: window.screen.height,
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
    };

    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();

    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--visual-viewport-height");
      document.documentElement.style.removeProperty("--visual-viewport-offset-top");
    };
  }, []);
}
