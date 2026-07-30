import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = await readFile(new URL("../deploy/nginx/pi-web.conf", import.meta.url), "utf8");

test("same-origin gateway maps only known device cookie values", () => {
  assert.match(config, /map \$cookie_pi_web_device \$pi_web_backend/);
  assert.match(config, /default\s+http:\/\/127\.0\.0\.1:33041/);
  assert.match(config, /mac-main\s+http:\/\/127\.0\.0\.1:33041/);
  assert.match(config, /linux-home\s+http:\/\/127\.0\.0\.1:33043/);
  assert.match(config, /proxy_pass \$pi_web_request_backend/);
});

test("device selection control plane stays on Main Mac", () => {
  assert.match(
    config,
    /location = \/api\/devices\/select \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:33041;/,
  );
});

test("gateway preserves unbuffered agent streams and exposes selected device metadata", () => {
  assert.match(config, /location \^~ \/api\/agent\/ \{[\s\S]*?proxy_buffering off;/);
  assert.match(config, /add_header X-Pi-Web-Device \$pi_web_request_device_id always;/);
});

test("application shell and app login stay on the control plane", () => {
  assert.match(config, /map \$uri \$pi_web_request_backend/);
  for (const path of ["/", "/login", "/manifest.webmanifest", "/sw.js", "/api/auth/session"]) {
    assert.match(config, new RegExp(`"${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s+http://127\\.0\\.0\\.1:33041`));
  }
  assert.match(config, /~\^\/_next\/\s+http:\/\/127\.0\.0\.1:33041/);
  assert.match(config, /~\^\/icons\/\s+http:\/\/127\.0\.0\.1:33041/);
});

test("device APIs still follow the selected backend", () => {
  assert.match(config, /map \$uri \$pi_web_request_backend \{\s*default\s+\$pi_web_backend;/);
  assert.match(config, /location \^~ \/api\/agent\/ \{[\s\S]*?proxy_pass \$pi_web_request_backend;/);
  assert.match(config, /location = \/api\/health \{[\s\S]*?proxy_pass \$pi_web_request_backend;/);
});
