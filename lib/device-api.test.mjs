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
  };
  process.env.PI_WEB_DEVICE_ID = "mac-main";
  process.env.PI_WEB_DEVICE_NAME = "Main Mac";
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
  }
});

function restore(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
