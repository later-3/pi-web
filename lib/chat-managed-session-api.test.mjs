import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-web-chat-api-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = root;
const chatDir = join(root, "chat-sessions");
mkdirSync(chatDir, { recursive: true });
const sessionId = "chat-tool-api-smoke";
const sessionPath = join(chatDir, `2026-07-28T00-00-00Z_${sessionId}.jsonl`);
writeFileSync(
  sessionPath,
  `${JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-07-28T00:00:00.000Z",
    cwd: root,
  })}\n`,
);
chmodSync(sessionPath, 0o400);

const jiti = createJiti(import.meta.url, {
  alias: { "@": fileURLToPath(new URL("..", import.meta.url)) },
});
const agentRoute = await jiti.import("../app/api/agent/[id]/route.ts");
const eventsRoute = await jiti.import("../app/api/agent/[id]/events/route.ts");
const sessionRoute = await jiti.import("../app/api/sessions/[id]/route.ts");
const autoNameRoute = await jiti.import("../app/api/sessions/[id]/auto-name/route.ts");

const context = { params: Promise.resolve({ id: sessionId }) };

test.after(() => {
  chmodSync(sessionPath, 0o600);
  rmSync(root, { recursive: true, force: true });
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

test("rejects every pi-web write/start route for Chat-managed sessions", async () => {
  const responses = await Promise.all([
    agentRoute.POST(
      new Request(`http://localhost/api/agent/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "prompt", message: "must not run" }),
      }),
      context,
    ),
    eventsRoute.GET(new Request(`http://localhost/api/agent/${sessionId}/events`), context),
    sessionRoute.PATCH(
      new Request(`http://localhost/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "must not rename" }),
      }),
      context,
    ),
    sessionRoute.DELETE(new Request(`http://localhost/api/sessions/${sessionId}`), context),
    autoNameRoute.POST(new Request(`http://localhost/api/sessions/${sessionId}/auto-name`), context),
  ]);

  assert.deepEqual(responses.map((response) => response.status), [403, 403, 403, 403, 403]);
});
