export interface MobileViewportInput {
  innerHeight: number;
  visualHeight: number;
  visualOffsetTop: number;
  visualScale: number;
  editableFocused: boolean;
  standalone: boolean;
}

export interface MobileViewportResult {
  height: string;
  offsetTop: string;
  keyboardOpen: boolean;
}

/**
 * Resolve the height used by the fixed mobile shell.
 *
 * CSS viewport units are authoritative while the keyboard is closed. WebKit
 * currently subtracts safe-area insets from dynamic/small viewport units in
 * some installed apps with `viewport-fit=cover`, while legacy `vh` includes
 * that area. Use `100vh` only in standalone mode and keep `100dvh` in Safari.
 *
 * The Visual Viewport API is used only for its intended exception: an editable
 * control has focus and the on-screen keyboard has substantially reduced the
 * visible viewport. Requiring focus also prevents a stale standalone-PWA
 * visual viewport (or browser chrome changes) from leaving a permanent gap.
 */
export function resolveMobileViewport({
  innerHeight,
  visualHeight,
  visualOffsetTop,
  visualScale,
  editableFocused,
  standalone,
}: MobileViewportInput): MobileViewportResult {
  const viewportLoss = Math.max(
    0,
    innerHeight - visualHeight - visualOffsetTop,
  );
  const keyboardThreshold = Math.max(120, innerHeight * 0.15);
  const keyboardOpen = editableFocused
    && visualScale <= 1.05
    && visualHeight > 0
    && viewportLoss > keyboardThreshold;

  if (keyboardOpen) {
    return {
      height: `${visualHeight}px`,
      offsetTop: `${visualOffsetTop}px`,
      keyboardOpen: true,
    };
  }

  return {
    height: standalone ? "100vh" : "100dvh",
    offsetTop: "0px",
    keyboardOpen: false,
  };
}
