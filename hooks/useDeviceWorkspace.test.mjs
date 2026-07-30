import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useDeviceWorkspace.ts", import.meta.url), "utf8");
const rootSource = await readFile(new URL("../components/DeviceWorkspaceRoot.tsx", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("unmounts the old workspace before changing the gateway preference", () => {
  const phaseIndex = source.indexOf('phase: "switching"');
  const teardownIndex = source.indexOf("await waitForReactPaint()");
  const switchIndex = source.indexOf("await switchGatewayDevice(device.id, currentDeviceId)");
  assert.ok(phaseIndex >= 0 && phaseIndex < teardownIndex && teardownIndex < switchIndex);
});

test("keeps the real previous workspace visible during a supported async switch", () => {
  assert.match(source, /"startViewTransition" in document/);
  assert.match(source, /document\.startViewTransition\(update\)/);
  assert.match(source, /await ready/);
  assert.match(source, /prefers-reduced-motion: reduce/);
});

test("switches the React workspace without navigating the document", () => {
  assert.match(source, /window\.history\.replaceState/);
  assert.match(rootSource, /key=\{workspace\.workspaceEpoch\}/);
  assert.match(rootSource, /workspace\.transition\.phase === "switching"/);
  assert.match(pageSource, /<DeviceWorkspaceRoot \/>/);
  assert.doesNotMatch(rootSource, /window\.location\.(?:assign|reload)/);
});

test("persists per-device navigation and file state", () => {
  assert.match(source, /saveDeviceWorkspaceSnapshot\(window\.sessionStorage, currentDeviceId/);
  assert.match(source, /loadDeviceWorkspaceSnapshot\(window\.sessionStorage, device\.id\)/);
  assert.match(source, /navigationFromSearch\(window\.location\.search\)/);
});
