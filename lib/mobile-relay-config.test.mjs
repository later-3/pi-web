import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const installer = await readFile(
  new URL("../scripts/install-mobile-relay.sh", import.meta.url),
  "utf8",
);
const relayTemplate = await readFile(
  new URL("../deploy/macos/com.later.pi-web.cloud-relay.plist.in", import.meta.url),
  "utf8",
);
const relayRunner = await readFile(
  new URL("../scripts/run-pi-web-cloud-relay.sh", import.meta.url),
  "utf8",
);

test("Mac production installer exposes all multi-device settings", () => {
  for (const variable of [
    "PI_WEB_DEVICE_ID",
    "PI_WEB_DEVICE_NAME",
    "PI_WEB_PUBLIC_URL",
    "PI_WEB_DEVICE_GATEWAY_URL",
    "PI_WEB_DEVICES_FILE",
  ]) {
    assert.match(installer, new RegExp(`EnvironmentVariables\\.${variable}`));
  }
});

test("Mac production installer uses plutil for device values", () => {
  assert.match(installer, /plutil -insert EnvironmentVariables\.PI_WEB_DEVICE_ID/);
  assert.match(installer, /-string "\$device_name" "\$production_plist"/);
  assert.match(installer, /-string "\$device_public_url" "\$production_plist"/);
  assert.match(installer, /-string "\$device_gateway_url" "\$production_plist"/);
  assert.match(installer, /-string "\$devices_file" "\$production_plist"/);
});

test("Mac relay uses a self-healing wrapper instead of raw ssh", () => {
  const sharedSshOptions = relayRunner.slice(
    relayRunner.indexOf("ssh_options=("),
    relayRunner.indexOf('ssh_target="'),
  );
  const preflight = relayRunner.slice(
    relayRunner.indexOf("set +e"),
    relayRunner.indexOf('if [[ "$preflight_status" -eq 10 ]]'),
  );
  assert.match(relayTemplate, /run-pi-web-cloud-relay\.sh/);
  assert.match(installer, /__PROJECT_ROOT__/);
  assert.match(installer, /__CLOUD_HOST__/);
  assert.match(installer, /__REMOTE_PORT__/);
  assert.match(installer, /__LOCAL_PORT__/);
  assert.match(relayRunner, /curl --fail --silent --max-time 2/);
  assert.ok(relayRunner.includes('test \\"\\$comm\\" = sshd'));
  assert.match(sharedSshOptions, /ServerAliveInterval=10/);
  assert.match(sharedSshOptions, /ServerAliveCountMax=2/);
  assert.match(preflight, /preflight_pid="\$!"/);
  assert.match(preflight, /sleep "\$preflight_timeout_seconds"/);
  assert.match(preflight, /kill -TERM "\$preflight_pid"/);
  assert.match(preflight, /kill -KILL "\$preflight_pid"/);
  assert.match(relayRunner, /exec \/usr\/bin\/ssh -NT/);
});
