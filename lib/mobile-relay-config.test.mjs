import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const installer = await readFile(
  new URL("../scripts/install-mobile-relay.sh", import.meta.url),
  "utf8",
);

test("Mac production installer exposes all multi-device settings", () => {
  for (const variable of [
    "PI_WEB_DEVICE_ID",
    "PI_WEB_DEVICE_NAME",
    "PI_WEB_PUBLIC_URL",
    "PI_WEB_DEVICES_FILE",
  ]) {
    assert.match(installer, new RegExp(`EnvironmentVariables\\.${variable}`));
  }
});

test("Mac production installer uses plutil for device values", () => {
  assert.match(installer, /plutil -insert EnvironmentVariables\.PI_WEB_DEVICE_ID/);
  assert.match(installer, /-string "\$device_name" "\$production_plist"/);
  assert.match(installer, /-string "\$device_public_url" "\$production_plist"/);
  assert.match(installer, /-string "\$devices_file" "\$production_plist"/);
});
