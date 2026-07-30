import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildDeviceDirectory,
  isDeviceDirectoryResponse,
  MAX_DEVICE_COUNT,
} = await jiti.import("./device-directory-core.ts");

const current = {
  id: "mac-main",
  name: "Main Mac",
  url: "https://mac.example.com",
};

test("returns the current device when no directory is configured", () => {
  const result = buildDeviceDirectory(undefined, current, "http://127.0.0.1:30141");
  assert.equal(result.currentDeviceId, "mac-main");
  assert.deepEqual(result.devices, [current]);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.selectionMode, "direct");
  assert.equal(result.gatewayUrl, null);
  assert.equal(isDeviceDirectoryResponse(result), true);
});

test("enables gateway selection only on the configured gateway origin", () => {
  const gateway = buildDeviceDirectory(
    { version: 1, devices: [] },
    current,
    "https://pi.example.com",
    "https://pi.example.com/",
  );
  const direct = buildDeviceDirectory(
    { version: 1, devices: [] },
    current,
    "https://mac.example.com",
    "https://pi.example.com",
  );

  assert.equal(gateway.selectionMode, "gateway");
  assert.equal(gateway.gatewayUrl, "https://pi.example.com");
  assert.equal(direct.selectionMode, "direct");
  assert.equal(direct.gatewayUrl, "https://pi.example.com");
});

test("invalid gateway metadata fails back to direct mode", () => {
  const result = buildDeviceDirectory(null, current, "https://mac.example.com", "javascript:alert(1)");
  assert.equal(result.selectionMode, "direct");
  assert.equal(result.gatewayUrl, null);
  assert.equal(result.diagnostics[0]?.code, "invalid-gateway-url");
});

test("canonicalizes origins and lets current environment metadata win", () => {
  const result = buildDeviceDirectory({
    version: 1,
    devices: [
      { id: "mac-main", name: "Stale Mac", url: "https://old.example.com" },
      { id: "linux-home", name: "Home Linux", url: "https://linux.example.com/" },
    ],
  }, current, "http://127.0.0.1:30141");

  assert.deepEqual(result.devices, [
    current,
    { id: "linux-home", name: "Home Linux", url: "https://linux.example.com" },
  ]);
});

test("skips duplicate ids, duplicate URLs, and the current device URL", () => {
  const result = buildDeviceDirectory({
    version: 1,
    devices: [
      { id: "linux-home", name: "Linux", url: "https://linux.example.com" },
      { id: "linux-home", name: "Duplicate id", url: "https://other.example.com" },
      { id: "linux-two", name: "Duplicate URL", url: "https://linux.example.com" },
      { id: "mac-alias", name: "Current URL", url: "https://mac.example.com" },
    ],
  }, current, "http://127.0.0.1:30141");

  assert.equal(result.devices.length, 2);
  assert.deepEqual(
    result.diagnostics.map((item) => item.code),
    ["duplicate-device-id", "duplicate-device-url", "duplicate-current-device-url"],
  );
});

test("rejects unsafe or non-root device URLs", () => {
  const result = buildDeviceDirectory({
    version: 1,
    devices: [
      { id: "ftp-host", name: "FTP", url: "ftp://example.com" },
      { id: "credential-host", name: "Credential", url: "https://user:pass@example.com" },
      { id: "path-host", name: "Path", url: "https://example.com/pi" },
      { id: "query-host", name: "Query", url: "https://example.com/?device=1" },
      { id: "control-name", name: "Bad\nName", url: "https://control.example.com" },
    ],
  }, current, "http://127.0.0.1:30141");

  assert.deepEqual(result.devices, [current]);
  assert.equal(result.diagnostics.length, 5);
  assert.deepEqual(
    result.diagnostics.map((item) => item.code),
    [
      "invalid-device-url",
      "invalid-device-url",
      "invalid-device-url",
      "invalid-device-url",
      "invalid-device-name",
    ],
  );
});

test("falls back to the local device for invalid current metadata", () => {
  const result = buildDeviceDirectory(null, {
    id: "Invalid ID",
    name: "",
    url: "not-a-url",
  }, "http://localhost:30141");

  assert.equal(result.currentDeviceId, "local");
  assert.deepEqual(result.devices, [{ id: "local", name: "Pi Web", url: "http://localhost:30141" }]);
  assert.equal(result.diagnostics[0]?.code, "invalid-device-id");
});

test("rejects unsupported directory versions without breaking the current device", () => {
  const result = buildDeviceDirectory({ version: 2, devices: [] }, current, "http://localhost:30141");
  assert.deepEqual(result.devices, [current]);
  assert.equal(result.diagnostics[0]?.code, "unsupported-directory-version");
});

test("bounds the number of configured devices", () => {
  const devices = Array.from({ length: MAX_DEVICE_COUNT + 4 }, (_, index) => ({
    id: `device-${index}`,
    name: `Device ${index}`,
    url: `https://device-${index}.example.com`,
  }));
  const result = buildDeviceDirectory({ version: 1, devices }, current, "http://localhost:30141");

  assert.equal(result.devices.length, MAX_DEVICE_COUNT + 1);
  assert.equal(result.diagnostics[0]?.code, "device-limit-exceeded");
});

test("rejects structurally invalid API responses", () => {
  assert.equal(isDeviceDirectoryResponse({ version: 1, currentDeviceId: "local", devices: "nope" }), false);
  assert.equal(isDeviceDirectoryResponse({ version: 2, currentDeviceId: "local", devices: [], diagnostics: [] }), false);
  assert.equal(isDeviceDirectoryResponse({
    version: 1,
    currentDeviceId: "missing",
    devices: [{ id: "local", name: "Pi Web", url: "http://localhost:30141" }],
    diagnostics: [],
    selectionMode: "direct",
    gatewayUrl: null,
  }), false);
  assert.equal(isDeviceDirectoryResponse({
    version: 1,
    currentDeviceId: "local",
    devices: [{ id: "local", name: "Pi Web", url: "http://localhost:30141" }],
    diagnostics: [],
    selectionMode: "gateway",
    gatewayUrl: null,
  }), false);
});
