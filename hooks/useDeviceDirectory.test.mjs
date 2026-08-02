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

test("checks the selected backend only through an explicit action", () => {
  assert.match(source, /const checkSelectedDevice = useCallback/);
  assert.match(source, /probeSelectedGatewayDevice\(deviceId/);
  assert.match(source, /error instanceof DeviceUnavailableError/);
  assert.match(source, /offlineDeviceId: deviceId/);
  assert.match(source, /void checkSelectedDevice\(\)/);
});

test("does not probe on startup, on a timer, or on browser lifecycle events", () => {
  const directoryLoad = source.slice(source.indexOf("useEffect(() =>"), source.indexOf("const checkSelectedDevice"));
  assert.doesNotMatch(directoryLoad, /probeSelectedGatewayDevice/);
  assert.doesNotMatch(source, /setInterval/);
  assert.doesNotMatch(source, /visibilitychange/);
  assert.doesNotMatch(source, /addEventListener\("online"/);
});
