import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = await readFile(new URL("../deploy/nginx/pi-web.conf", import.meta.url), "utf8");

test("same-origin gateway maps only known device cookie values", () => {
  assert.match(config, /map \$cookie_pi_web_device \$pi_web_backend/);
  assert.match(config, /default\s+http:\/\/127\.0\.0\.1:33041/);
  assert.match(config, /mac-main\s+http:\/\/127\.0\.0\.1:33041/);
  assert.match(config, /linux-home\s+http:\/\/127\.0\.0\.1:33043/);
  assert.match(config, /proxy_pass \$pi_web_backend/);
});

test("control plane fails over between compatible devices", () => {
  assert.match(config, /upstream pi_web_control \{[\s\S]*?127\.0\.0\.1:33041[\s\S]*?127\.0\.0\.1:33043 backup;/);
  assert.match(config, /location ~ \^\/api\/[\s\S]*?proxy_pass http:\/\/pi_web_control;/);
  assert.match(config, /proxy_next_upstream error timeout http_502 http_503 http_504/);
  assert.match(config, /proxy_set_header X-Pi-Web-Selected-Device \$pi_web_device_id;/);
});

test("gateway preserves unbuffered agent streams and exposes selected device metadata", () => {
  assert.match(config, /location \^~ \/api\/agent\/ \{[\s\S]*?proxy_buffering off;/);
  assert.match(config, /add_header X-Pi-Web-Device \$pi_web_device_id always;/);
});

test("application shell, login, directory, and selection stay on the failover control plane", () => {
  assert.match(config, /location ~ \^\(\?:\/\$\|\/login\$/);
  assert.match(config, /location ~ \^\/api\/\(\?:auth\/session\|devices/);
  assert.match(config, /error_page 502 504 = @pi_web_control_offline_page;/);
  assert.match(config, /error_page 502 504 = @pi_web_control_offline_api;/);
});

test("device APIs follow the selected backend and return structured offline state", () => {
  assert.match(config, /location \^~ \/api\/agent\/ \{[\s\S]*?proxy_pass \$pi_web_backend;/);
  assert.match(config, /location = \/api\/health \{[\s\S]*?error_page 502 504 = @pi_web_device_offline;[\s\S]*?proxy_pass \$pi_web_backend;/);
  assert.doesNotMatch(config, /location \/ \{[\s\S]*?error_page 502 504 = @pi_web_device_offline;/);
  assert.match(config, /location @pi_web_device_offline \{/);
  assert.match(config, /"error":\s*"?device_offline|\\"error\\":\\"device_offline/);
  assert.match(config, /add_header X-Pi-Web-Device-Status offline always;/);
});

test("cloud gateway owns a useful page even when every backend is offline", () => {
  assert.match(config, /location @pi_web_control_offline_page \{/);
  assert.match(config, /云端暂时无法连接执行设备/);
  assert.match(config, /设备本身可能仍在线/);
  assert.doesNotMatch(config, /所有 Pi Web 设备都离线/);
  assert.doesNotMatch(config, /^\s*auth_basic/m);
});
