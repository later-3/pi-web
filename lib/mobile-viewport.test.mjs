import assert from "node:assert/strict";
import test from "node:test";
import { resolveMobileViewport } from "./mobile-viewport.ts";

test("uses dynamic viewport units while the keyboard is closed", () => {
  assert.deepEqual(resolveMobileViewport({
    innerHeight: 844,
    visualHeight: 844,
    visualOffsetTop: 0,
    visualScale: 1,
    editableFocused: false,
    standalone: false,
  }), {
    height: "100dvh",
    offsetTop: "0px",
    keyboardOpen: false,
  });
});

test("uses legacy viewport height for a closed standalone PWA", () => {
  assert.deepEqual(resolveMobileViewport({
    innerHeight: 811,
    visualHeight: 726,
    visualOffsetTop: 0,
    visualScale: 1,
    editableFocused: false,
    standalone: true,
  }), {
    height: "100vh",
    offsetTop: "0px",
    keyboardOpen: false,
  });
});

test("uses the visual viewport when a focused editor opens the keyboard", () => {
  assert.deepEqual(resolveMobileViewport({
    innerHeight: 844,
    visualHeight: 500,
    visualOffsetTop: 8,
    visualScale: 1,
    editableFocused: true,
    standalone: true,
  }), {
    height: "500px",
    offsetTop: "8px",
    keyboardOpen: true,
  });
});

test("does not confuse a small visual viewport with a keyboard without focus", () => {
  assert.deepEqual(resolveMobileViewport({
    innerHeight: 780,
    visualHeight: 500,
    visualOffsetTop: 0,
    visualScale: 1,
    editableFocused: false,
    standalone: false,
  }), {
    height: "100dvh",
    offsetTop: "0px",
    keyboardOpen: false,
  });
});

test("does not confuse pinch zoom with the software keyboard", () => {
  assert.deepEqual(resolveMobileViewport({
    innerHeight: 844,
    visualHeight: 500,
    visualOffsetTop: 0,
    visualScale: 1.5,
    editableFocused: true,
    standalone: true,
  }), {
    height: "100vh",
    offsetTop: "0px",
    keyboardOpen: false,
  });
});
