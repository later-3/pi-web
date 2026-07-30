import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./push-notifications.ts");
  } catch {
    return import("./push-notifications.ts");
  }
}

const { buildCompletionPayload, buildWebPushTopic, getPushPublicKey, normalizePushSubscription } = await loadSubject();

test("validates browser push subscriptions", () => {
  const subscription = {
    endpoint: "https://push.example.test/subscription/123",
    expirationTime: null,
    keys: { p256dh: "abcdefgh", auth: "ijklmnop" },
  };
  assert.deepEqual(normalizePushSubscription(subscription), subscription);
  assert.equal(normalizePushSubscription({ ...subscription, endpoint: "http://push.example.test/123" }), null);
  assert.equal(normalizePushSubscription({ ...subscription, keys: { ...subscription.keys, auth: "bad key" } }), null);
});

test("builds a private, bounded completion preview and session deep link", () => {
  const payload = buildCompletionPayload({
    sessionId: "session id",
    sessionName: "推送测试",
    cwd: "/tmp/pi-web",
    lastAssistantText: `## 完成\n[详情](https://example.test) ${"🙂".repeat(130)}`,
  }, "zh-CN");

  assert.equal(payload.title, "Pi 已完成");
  assert.match(payload.body, /^推送测试 · 完成 详情 /);
  assert.equal(payload.body.endsWith("…"), true);
  assert.equal(payload.data.url, "/?session=session%20id");
  assert.equal(payload.body.includes("https://"), false);
});

test("builds an Apple-compatible deterministic Web Push topic", () => {
  const first = buildWebPushTopic("pi-push-ready");
  const second = buildWebPushTopic("pi-push-ready");
  assert.equal(first, second);
  assert.equal(first.length, 32);
  assert.match(first, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(first, buildWebPushTopic("pi-session-other"));
});

test("persists one VAPID keypair in a protected agent file", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-push-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = directory;
    const first = getPushPublicKey();
    const second = getPushPublicKey();
    const path = join(directory, "pi-web-push.json");
    const stored = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(first, second);
    assert.equal(stored.vapid.publicKey, first);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
