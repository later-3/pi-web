export interface MobileViewportInput {
  innerHeight: number;
  visualHeight: number;
  visualOffsetTop: number;
  screenHeight: number;
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
 * iOS standalone PWAs can expose an inner/dynamic viewport that is shorter
 * than the physical CSS screen even with the keyboard closed. That missing
 * strip must not be mistaken for keyboard coverage. Once the viewport loss is
 * large enough to be a keyboard, however, the visual viewport is authoritative.
 */
export function resolveMobileViewport({
  innerHeight,
  visualHeight,
  visualOffsetTop,
  screenHeight,
  standalone,
}: MobileViewportInput): MobileViewportResult {
  const layoutCoverage = Math.max(0, innerHeight - visualHeight - visualOffsetTop);
  const standaloneCoverage = standalone
    ? Math.max(0, screenHeight - visualHeight - visualOffsetTop)
    : 0;
  const keyboardThreshold = Math.max(120, screenHeight * 0.15);
  const keyboardOpen = Math.max(layoutCoverage, standaloneCoverage) > keyboardThreshold;

  if (keyboardOpen) {
    return {
      height: `${visualHeight}px`,
      offsetTop: `${visualOffsetTop}px`,
      keyboardOpen: true,
    };
  }

  return {
    height: standalone ? `${Math.max(innerHeight, screenHeight)}px` : "100dvh",
    offsetTop: "0px",
    keyboardOpen: false,
  };
}
