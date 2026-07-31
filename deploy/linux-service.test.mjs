import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync(new URL("./linux/pi-web.service", import.meta.url), "utf8");

test("systemd manages Next directly instead of an npm and shell wrapper", () => {
  assert.match(service, /^Environment=PI_WEB_DIST_DIR=\.next-mobile$/m);
  assert.match(service, /^ExecStart=\/usr\/bin\/node .*\/next\/dist\/bin\/next start /m);
  assert.doesNotMatch(service, /^ExecStart=.*npm/m);
});

test("systemd reclaims residual Next children after the graceful stop window", () => {
  assert.match(service, /^KillSignal=SIGTERM$/m);
  assert.match(service, /^KillMode=mixed$/m);
  assert.match(service, /^TimeoutStopSec=30$/m);
});
