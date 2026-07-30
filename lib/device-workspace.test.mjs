import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  DEVICE_WORKSPACE_STORAGE_KEY,
  loadDeviceWorkspaceSnapshot,
  navigationFromSearch,
  normalizeDeviceWorkspaceSnapshot,
  saveDeviceWorkspaceSnapshot,
  workspaceUrlFromNavigation,
} = await jiti.import("./device-workspace.ts");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: (key) => values.get(key) ?? null,
  };
}

test("restores only root workspace navigation and lets cwd win over session", () => {
  assert.deepEqual(navigationFromSearch("?session=abc"), { requestedCwd: null, sessionId: "abc" });
  assert.deepEqual(navigationFromSearch("?cwd=%2Ftmp%2Frepo&session=abc"), {
    requestedCwd: "/tmp/repo",
    sessionId: null,
  });
  assert.equal(workspaceUrlFromNavigation({ requestedCwd: null, sessionId: "abc" }), "/?session=abc");
  assert.equal(workspaceUrlFromNavigation({ requestedCwd: "/tmp/repo", sessionId: null }), "/?cwd=%2Ftmp%2Frepo");
});

test("keeps a bounded device-local file workspace", () => {
  const storage = memoryStorage();
  saveDeviceWorkspaceSnapshot(storage, "linux-home", {
    navigation: { requestedCwd: null, sessionId: "linux-session" },
    fileTabs: [{ id: "file:/tmp/a.ts", label: "a.ts", filePath: "/tmp/a.ts" }],
    activeFileTabId: "file:/tmp/a.ts",
    rightPanelOpen: true,
  });
  assert.deepEqual(loadDeviceWorkspaceSnapshot(storage, "linux-home"), {
    navigation: { requestedCwd: null, sessionId: "linux-session" },
    fileTabs: [{ id: "file:/tmp/a.ts", label: "a.ts", filePath: "/tmp/a.ts" }],
    activeFileTabId: "file:/tmp/a.ts",
    rightPanelOpen: true,
  });
  assert.match(storage.value(DEVICE_WORKSPACE_STORAGE_KEY), /linux-home/);
});

test("drops corrupt tabs and never opens an empty file panel", () => {
  assert.deepEqual(normalizeDeviceWorkspaceSnapshot({
    navigation: { requestedCwd: null, sessionId: "ok" },
    fileTabs: [{ id: "bad" }],
    activeFileTabId: "bad",
    rightPanelOpen: true,
  }), {
    navigation: { requestedCwd: null, sessionId: "ok" },
    fileTabs: [],
    activeFileTabId: null,
    rightPanelOpen: false,
  });
});
