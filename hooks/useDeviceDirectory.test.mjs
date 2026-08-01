import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useDeviceDirectory.ts", import.meta.url), "utf8");

test("bounds the directory request with AbortController and a three-second timeout", () => {
  assert.match(source, /DEVICE_DIRECTORY_TIMEOUT_MS = 3_000/);
  assert.match(source, /const controller = new AbortController\(\)/);
  assert.match(source, /window\.setTimeout\(\(\) => controller\.abort\(\), DEVICE_DIRECTORY_TIMEOUT_MS\)/);
});
test("does not update React state after unmount", () => {
  assert.match(source, /let active = true/);
  assert.match(source, /if \(active\) \{[\s\S]*setState/);
  assert.match(source, /if \(!active\) return/);
  assert.match(source, /active = false;[\s\S]*controller\.abort\(\)/);
});

test("probes the selected gateway backend and preserves metadata when it is offline", () => {
  assert.match(source, /probeSelectedGatewayDevice\(payload\.currentDeviceId/);
  assert.match(source, /error instanceof DeviceUnavailableError/);
  assert.match(source, /directory: payload,[\s\S]*offlineDeviceId: error\.deviceId/);
  assert.match(source, /const retry = useCallback/);
  assert.match(source, /DEVICE_AVAILABILITY_POLL_MS = 5_000/);
  assert.match(source, /window\.setInterval\(\(\) => void checkAvailability\(\)/);
});
