import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { selectGatewayDevice } = await jiti.import("./device-selection-client.ts");

test("posts a same-origin gateway selection request", async () => {
  let captured;
  await selectGatewayDevice("linux-home", {
    fetchFn: async (input, init) => {
      captured = { input, init };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  assert.equal(captured.input, "/api/devices/select");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.credentials, "same-origin");
  assert.deepEqual(JSON.parse(captured.init.body), { deviceId: "linux-home" });
});

test("surfaces bounded server errors", async () => {
  await assert.rejects(
    selectGatewayDevice("linux-home", {
      fetchFn: async () => new Response(JSON.stringify({ error: "Unknown device" }), { status: 404 }),
    }),
    /Unknown device/,
  );
});

test("aborts a gateway selection that exceeds its timeout", async () => {
  await assert.rejects(
    selectGatewayDevice("linux-home", {
      timeoutMs: 5,
      fetchFn: async (_input, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    }),
    /timed out/,
  );
});
