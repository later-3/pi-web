import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
});
const { AgentCommandError, isPromptRejectedError, sendAgentCommand } = await jiti.import("./agent-client.ts");
const { DeviceUnavailableError } = await jiti.import("./device-selection-client.ts");

test("classifies a gateway execution failure as selected-device unavailability", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Bad gateway", {
    status: 502,
    headers: { "X-Pi-Web-Device": "mac-main" },
  });
  try {
    await assert.rejects(
      sendAgentCommand("session-id", { type: "prompt", message: "hello" }),
      (error) => error instanceof DeviceUnavailableError
        && error.deviceId === "mac-main"
        && error.status === 502,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("keeps ordinary agent errors distinct from connectivity failures", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Invalid command" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
  try {
    await assert.rejects(
      sendAgentCommand("session-id", { type: "unknown" }),
      (error) => error instanceof Error
        && !(error instanceof DeviceUnavailableError)
        && error.message === "Invalid command",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("does not mistake an application 503 for a device connectivity failure", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Pi Web login is not configured correctly" }), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      "X-Pi-Web-Device-Status": "online",
    },
  });
  try {
    await assert.rejects(
      sendAgentCommand("session-id", { type: "prompt", message: "hello" }),
      (error) => error instanceof Error
        && !(error instanceof DeviceUnavailableError)
        && error.message === "Pi Web login is not configured correctly",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("agent command HTTP rejections are distinguishable from transport failures", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => new Response(
    JSON.stringify({
      error: "Authentication failed",
      code: "prompt_rejected",
      accepted: false,
    }),
    { status: 500, headers: { "Content-Type": "application/json" } },
  );

  await assert.rejects(
    sendAgentCommand("session-id", { type: "prompt", message: "hello" }),
    (error) => {
      assert.equal(error instanceof AgentCommandError, true);
      assert.equal(error.status, 500);
      assert.equal(error.message, "Authentication failed");
      assert.equal(error.code, "prompt_rejected");
      assert.equal(error.accepted, false);
      assert.equal(isPromptRejectedError(error), true);
      return true;
    },
  );

  const transportError = new TypeError("connection reset");
  globalThis.fetch = async () => {
    throw transportError;
  };

  await assert.rejects(
    sendAgentCommand("session-id", { type: "prompt", message: "hello" }),
    (error) => {
      assert.equal(error, transportError);
      assert.equal(error instanceof AgentCommandError, false);
      assert.equal(isPromptRejectedError(error), false);
      return true;
    },
  );
});

test("only an explicit negative prompt acknowledgement is definitive", () => {
  assert.equal(
    isPromptRejectedError(new AgentCommandError("proxy failure", 502)),
    false,
  );
  assert.equal(
    isPromptRejectedError(new AgentCommandError("generic API failure", 500, "internal_error", false)),
    false,
  );
});
