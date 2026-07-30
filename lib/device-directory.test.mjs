import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  loadDeviceDirectory,
  MAX_DEVICE_DIRECTORY_BYTES,
} = await jiti.import("./device-directory.ts");

test("loads a bounded JSON file and injects current device environment metadata", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-web-devices-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "devices.json");
  await writeFile(file, JSON.stringify({
    version: 1,
    devices: [{ id: "linux-home", name: "Home Linux", url: "https://linux.example.com" }],
  }));

  const result = await loadDeviceDirectory({
    requestOrigin: "http://127.0.0.1:30141",
    env: {
      PI_WEB_DEVICES_FILE: file,
      PI_WEB_DEVICE_ID: "mac-main",
      PI_WEB_DEVICE_NAME: "Main Mac",
      PI_WEB_PUBLIC_URL: "https://mac.example.com",
    },
  });

  assert.deepEqual(result.devices.map((device) => device.id), ["mac-main", "linux-home"]);
  assert.deepEqual(result.diagnostics, []);
});
test("returns the current device and a sanitized diagnostic for a missing file", async () => {
  const result = await loadDeviceDirectory({
    requestOrigin: "http://127.0.0.1:30141",
    env: { PI_WEB_DEVICES_FILE: "/path/that/does/not/exist/devices.json" },
  });

  assert.equal(result.devices.length, 1);
  assert.equal(result.diagnostics[0]?.code, "device-file-missing");
  assert.doesNotMatch(result.diagnostics[0]?.message ?? "", /path\/that/);
});

test("rejects an oversized file before parsing it", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-web-devices-large-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "devices.json");
  await writeFile(file, " ".repeat(MAX_DEVICE_DIRECTORY_BYTES + 1));

  const result = await loadDeviceDirectory({
    requestOrigin: "http://127.0.0.1:30141",
    env: { PI_WEB_DEVICES_FILE: file },
  });

  assert.equal(result.devices.length, 1);
  assert.equal(result.diagnostics[0]?.code, "device-file-too-large");
});

test("reloads the directory when file metadata changes", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-web-devices-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "devices.json");
  const env = { PI_WEB_DEVICES_FILE: file };
  await writeFile(file, JSON.stringify({ version: 1, devices: [] }));
  const first = await loadDeviceDirectory({ requestOrigin: "http://localhost:30141", env });

  await writeFile(file, JSON.stringify({
    version: 1,
    devices: [{ id: "linux-home", name: "Home Linux", url: "https://linux.example.com" }],
  }));
  const second = await loadDeviceDirectory({ requestOrigin: "http://localhost:30141", env });

  assert.equal(first.devices.length, 1);
  assert.equal(second.devices.length, 2);
});

test("derives gateway mode from the external request origin", async () => {
  const env = {
    PI_WEB_DEVICE_ID: "mac-main",
    PI_WEB_DEVICE_NAME: "Main Mac",
    PI_WEB_PUBLIC_URL: "https://mac.example.com",
    PI_WEB_DEVICE_GATEWAY_URL: "https://pi.example.com",
  };
  const gateway = await loadDeviceDirectory({ requestOrigin: "https://pi.example.com", env });
  const direct = await loadDeviceDirectory({ requestOrigin: "https://mac.example.com", env });

  assert.equal(gateway.selectionMode, "gateway");
  assert.equal(gateway.gatewayUrl, "https://pi.example.com");
  assert.equal(direct.selectionMode, "direct");
});
