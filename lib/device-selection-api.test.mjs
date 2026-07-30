import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import("../app/api/devices/select/route.ts");

test("gateway selection validates origin, device, body limit, and secure cookie", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-web-device-selection-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "devices.json");
  await writeFile(file, JSON.stringify({
    version: 1,
    devices: [{ id: "linux-home", name: "Home Linux", url: "https://linux.example.com" }],
  }));

  const previous = saveEnvironment([
    "PI_WEB_DEVICE_ID",
    "PI_WEB_DEVICE_NAME",
    "PI_WEB_PUBLIC_URL",
    "PI_WEB_DEVICES_FILE",
    "PI_WEB_DEVICE_GATEWAY_URL",
    "PI_WEB_ALLOWED_HOSTS",
  ]);
  Object.assign(process.env, {
    PI_WEB_DEVICE_ID: "mac-main",
    PI_WEB_DEVICE_NAME: "Main Mac",
    PI_WEB_PUBLIC_URL: "https://mac.example.com",
    PI_WEB_DEVICES_FILE: file,
    PI_WEB_DEVICE_GATEWAY_URL: "https://pi.example.com",
    PI_WEB_ALLOWED_HOSTS: "pi.example.com,linux.example.com",
  });
  t.after(() => restoreEnvironment(previous));

  const selected = await POST(selectionRequest("https://pi.example.com", { deviceId: "linux-home" }));
  assert.equal(selected.status, 200);
  assert.deepEqual(await selected.json(), { ok: true, currentDeviceId: "linux-home" });
  assert.match(selected.headers.get("set-cookie") ?? "", /pi_web_device=linux-home/);
  assert.match(selected.headers.get("set-cookie") ?? "", /HttpOnly/i);
  assert.match(selected.headers.get("set-cookie") ?? "", /Secure/i);
  assert.match(selected.headers.get("set-cookie") ?? "", /SameSite=lax/i);
  assert.equal(selected.headers.get("cache-control"), "private, no-store, max-age=0");

  const unknown = await POST(selectionRequest("https://pi.example.com", { deviceId: "unknown" }));
  assert.equal(unknown.status, 404);

  const direct = await POST(selectionRequest("https://linux.example.com", { deviceId: "mac-main" }));
  assert.equal(direct.status, 409);

  const crossOrigin = await POST(selectionRequest(
    "https://pi.example.com",
    { deviceId: "linux-home" },
    "https://attacker.example.com",
  ));
  assert.equal(crossOrigin.status, 403);

  const oversized = await POST(selectionRequest(
    "https://pi.example.com",
    { deviceId: "x".repeat(2048) },
  ));
  assert.equal(oversized.status, 413);
});

function selectionRequest(origin, body, requestOrigin = origin) {
  return new NextRequest(`${origin}/api/devices/select`, {
    method: "POST",
    headers: {
      host: new URL(origin).host,
      origin: requestOrigin,
      "content-type": "application/json",
      "x-forwarded-proto": "https",
    },
    body: JSON.stringify(body),
  });
}

function saveEnvironment(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
