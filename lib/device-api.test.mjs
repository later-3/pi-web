import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("../app/api/devices/route.ts");

test("returns a private no-store device directory with external origin metadata", async () => {
  const previous = {
    id: process.env.PI_WEB_DEVICE_ID,
    name: process.env.PI_WEB_DEVICE_NAME,
    url: process.env.PI_WEB_PUBLIC_URL,
    file: process.env.PI_WEB_DEVICES_FILE,
    gateway: process.env.PI_WEB_DEVICE_GATEWAY_URL,
  };
  process.env.PI_WEB_DEVICE_ID = "mac-main";
  process.env.PI_WEB_DEVICE_NAME = "Main Mac";
  process.env.PI_WEB_DEVICE_GATEWAY_URL = "https://mac.pi.example.com";
  delete process.env.PI_WEB_PUBLIC_URL;
  delete process.env.PI_WEB_DEVICES_FILE;

  try {
    const response = await GET(new NextRequest("http://localhost:30141/api/devices", {
      headers: {
        host: "mac.pi.example.com",
        "x-forwarded-proto": "https",
      },
    }));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(payload.currentDeviceId, "mac-main");
    assert.equal(payload.selectionMode, "gateway");
    assert.equal(payload.gatewayUrl, "https://mac.pi.example.com");
    assert.deepEqual(payload.devices, [{
      id: "mac-main",
      name: "Main Mac",
      url: "https://mac.pi.example.com",
    }]);
  } finally {
    restore("PI_WEB_DEVICE_ID", previous.id);
    restore("PI_WEB_DEVICE_NAME", previous.name);
    restore("PI_WEB_PUBLIC_URL", previous.url);
    restore("PI_WEB_DEVICES_FILE", previous.file);
    restore("PI_WEB_DEVICE_GATEWAY_URL", previous.gateway);
  }
});

test("reports the gateway-selected logical device from the trusted proxy header", async (t) => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), "pi-web-device-api-"));
  t.after(() => rm(directoryPath, { recursive: true, force: true }));
  const file = path.join(directoryPath, "devices.json");
  await writeFile(file, JSON.stringify({
    version: 1,
    devices: [{ id: "linux-home", name: "Home Linux", url: "https://linux.example.com" }],
  }));

  const previous = Object.fromEntries([
    "PI_WEB_DEVICE_ID",
    "PI_WEB_DEVICE_NAME",
    "PI_WEB_PUBLIC_URL",
    "PI_WEB_DEVICES_FILE",
    "PI_WEB_DEVICE_GATEWAY_URL",
  ].map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    PI_WEB_DEVICE_ID: "mac-main",
    PI_WEB_DEVICE_NAME: "Main Mac",
    PI_WEB_PUBLIC_URL: "https://mac.example.com",
    PI_WEB_DEVICES_FILE: file,
    PI_WEB_DEVICE_GATEWAY_URL: "https://pi.example.com",
  });
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) restore(key, value);
  });

  const response = await GET(new NextRequest("https://pi.example.com/api/devices", {
    headers: {
      host: "pi.example.com",
      "x-forwarded-proto": "https",
      "x-pi-web-selected-device": "linux-home",
    },
  }));
  const payload = await response.json();
  assert.equal(payload.currentDeviceId, "linux-home");
  assert.deepEqual(payload.devices.map((device) => device.id), ["mac-main", "linux-home"]);
});

function restore(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
