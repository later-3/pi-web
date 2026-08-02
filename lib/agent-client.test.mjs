import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { sendAgentCommand } = await jiti.import("./agent-client.ts");
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
