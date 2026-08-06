import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-web-unpersisted-api-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = root;

const jiti = createJiti(import.meta.url, {
  alias: { "@": fileURLToPath(new URL("..", import.meta.url)) },
});
const agentRoute = await jiti.import("../app/api/agent/[id]/route.ts");
const eventsRoute = await jiti.import("../app/api/agent/[id]/events/route.ts");

test.after(() => {
  globalThis.__piSessions = undefined;
  rmSync(root, { recursive: true, force: true });
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

function runtime(sessionFile = join(root, "sessions", "pending-session.jsonl")) {
  const commands = [];
  return {
    commands,
    sessionFile,
    isAlive: () => true,
    setNotificationAudience: () => {},
    send: async (command) => {
      commands.push(command);
      return { accepted: true };
    },
    onEvent: () => () => {},
  };
}

test("allows a server-registered new session before its JSONL file exists", async () => {
  const sessionId = "unpersisted-runtime";
  const live = runtime();
  globalThis.__piSessions = new Map([[sessionId, live]]);

  const postResponse = await agentRoute.POST(
    new Request(`http://localhost/api/agent/${sessionId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "prompt", message: "first message" }),
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );
  assert.equal(postResponse.status, 200);
  assert.deepEqual(live.commands, [{ type: "prompt", message: "first message" }]);

  const controller = new AbortController();
  const eventsResponse = await eventsRoute.GET(
    new Request(`http://localhost/api/agent/${sessionId}/events`, { signal: controller.signal }),
    { params: Promise.resolve({ id: sessionId }) },
  );
  assert.equal(eventsResponse.status, 200);
  assert.match(eventsResponse.headers.get("content-type") ?? "", /^text\/event-stream/);
  controller.abort();
});

test("does not let a registered persisted runtime bypass Chat-managed read-only checks", async () => {
  const chatDir = join(root, "chat-sessions");
  mkdirSync(chatDir, { recursive: true });
  const sessionId = "registered-chat-runtime";
  const sessionPath = join(chatDir, `2026-08-06T00-00-00Z_${sessionId}.jsonl`);
  writeFileSync(sessionPath, `${JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-08-06T00:00:00.000Z",
    cwd: root,
  })}\n`);
  chmodSync(sessionPath, 0o400);
  const live = runtime(sessionPath);
  globalThis.__piSessions = new Map([[sessionId, live]]);

  const responses = await Promise.all([
    agentRoute.POST(
      new Request(`http://localhost/api/agent/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "prompt", message: "must not run" }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    ),
    eventsRoute.GET(
      new Request(`http://localhost/api/agent/${sessionId}/events`),
      { params: Promise.resolve({ id: sessionId }) },
    ),
  ]);

  assert.deepEqual(responses.map((response) => response.status), [403, 403]);
  assert.deepEqual(live.commands, []);
  chmodSync(sessionPath, 0o600);
});
