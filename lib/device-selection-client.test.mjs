import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  DeviceUnavailableError,
  loadSelectedGatewayDevice,
  probeSelectedGatewayDevice,
  selectGatewayDevice,
  switchGatewayDevice,
} = await jiti.import("./device-selection-client.ts");

const gatewayDirectory = {
  version: 1,
  currentDeviceId: "linux-home",
  devices: [
    { id: "linux-home", name: "Pop!_OS", url: "https://linux.example.com" },
    { id: "mac-main", name: "Main Mac", url: "https://mac.example.com" },
  ],
  diagnostics: [],
  selectionMode: "gateway",
  gatewayUrl: "https://pi.example.com",
};

test("posts a same-origin gateway selection request", async () => {
  let captured;
  await selectGatewayDevice("linux-home", {
    fetchFn: async (input, init) => {
      captured = { input, init };
      return new Response(JSON.stringify({ ok: true, currentDeviceId: "linux-home" }), { status: 200 });
    },
  });

  assert.equal(captured.input, "/api/devices/select");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.credentials, "same-origin");
  assert.deepEqual(JSON.parse(captured.init.body), { deviceId: "linux-home" });
});

test("verifies that the selected device owns both metadata and gateway routing", async () => {
  const directory = await loadSelectedGatewayDevice("linux-home", {
    fetchFn: async (input) => input === "/api/devices"
      ? new Response(JSON.stringify(gatewayDirectory), {
          status: 200,
          headers: { "X-Pi-Web-Device": "linux-home" },
        })
      : new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "X-Pi-Web-Device": "linux-home" },
        }),
  });
  assert.equal(directory.currentDeviceId, "linux-home");
});

test("turns a structured gateway outage into a typed device-offline error", async () => {
  await assert.rejects(
    probeSelectedGatewayDevice("linux-home", {
      fetchFn: async () => new Response(JSON.stringify({
        error: "device_offline",
        deviceId: "linux-home",
        message: "Selected device is offline",
      }), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "X-Pi-Web-Device": "linux-home",
          "X-Pi-Web-Device-Status": "offline",
        },
      }),
    }),
    (error) => error instanceof DeviceUnavailableError
      && error.deviceId === "linux-home"
      && error.status === 503,
  );
});

test("rejects a stale or misrouted device response", async () => {
  await assert.rejects(
    loadSelectedGatewayDevice("linux-home", {
      fetchFn: async () => new Response(JSON.stringify(gatewayDirectory), {
        status: 200,
        headers: { "X-Pi-Web-Device": "mac-main" },
      }),
    }),
    /wrong device/,
  );
});

test("rolls the preference back when the target device is unavailable", async () => {
  const selections = [];
  await assert.rejects(
    switchGatewayDevice("linux-home", "mac-main", {
      fetchFn: async (input, init) => {
        if (input === "/api/devices/select") {
          const deviceId = JSON.parse(init.body).deviceId;
          selections.push(deviceId);
          return new Response(JSON.stringify({ ok: true, currentDeviceId: deviceId }), { status: 200 });
        }
        return new Response("unavailable", { status: 502 });
      },
    }),
    /unavailable/,
  );
  assert.deepEqual(selections, ["linux-home", "mac-main"]);
});

test("rolls back after metadata succeeds but the selected health probe is offline", async () => {
  const selections = [];
  await assert.rejects(
    switchGatewayDevice("linux-home", "mac-main", {
      fetchFn: async (input, init) => {
        if (input === "/api/devices/select") {
          const deviceId = JSON.parse(init.body).deviceId;
          selections.push(deviceId);
          return new Response(JSON.stringify({ ok: true, currentDeviceId: deviceId }), { status: 200 });
        }
        if (input === "/api/devices") {
          return new Response(JSON.stringify(gatewayDirectory), {
            status: 200,
            headers: { "X-Pi-Web-Device": "linux-home" },
          });
        }
        return new Response(JSON.stringify({ error: "device_offline", deviceId: "linux-home" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      },
    }),
    DeviceUnavailableError,
  );
  assert.deepEqual(selections, ["linux-home", "mac-main"]);
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
