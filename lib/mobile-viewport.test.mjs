import assert from "node:assert/strict";
import test from "node:test";
import { resolveMobileViewport } from "./mobile-viewport.ts";

test("fills the physical CSS screen in a closed iOS standalone PWA", () => {
  assert.deepEqual(resolveMobileViewport({
    innerHeight: 844,
    visualHeight: 844,
    visualOffsetTop: 0,
    screenHeight: 932,
    standalone: true,
  }), {
    height: "932px",
    offsetTop: "0px",
    keyboardOpen: false,
  });
});

test("uses the visual viewport when the standalone software keyboard opens", () => {
  assert.deepEqual(resolveMobileViewport({
    innerHeight: 844,
    visualHeight: 500,
    visualOffsetTop: 8,
    screenHeight: 932,
    standalone: true,
  }), {
    height: "500px",
    offsetTop: "8px",
    keyboardOpen: true,
  });
});

test("keeps dynamic viewport units for a normal mobile browser", () => {
  assert.deepEqual(resolveMobileViewport({
    innerHeight: 780,
    visualHeight: 780,
    visualOffsetTop: 0,
    screenHeight: 932,
    standalone: false,
  }), {
    height: "100dvh",
    offsetTop: "0px",
    keyboardOpen: false,
  });
});
