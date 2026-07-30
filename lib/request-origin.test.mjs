import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getExternalRequestOrigin,
  isExternalRequestSecure,
} = await jiti.import("./request-origin.ts");

test("uses trusted proxy protocol and external Host metadata", () => {
  const request = new Request("http://localhost:30141/api/devices", {
    headers: {
      host: "mac.pi.example.com",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(getExternalRequestOrigin(request), "https://mac.pi.example.com");
  assert.equal(isExternalRequestSecure(request), true);
});

test("uses the first forwarded protocol value", () => {
  const request = new Request("http://localhost:30141/api/devices", {
    headers: {
      host: "pi.example.com",
      "x-forwarded-proto": "https, http",
    },
  });
  assert.equal(getExternalRequestOrigin(request), "https://pi.example.com");
});

test("marks proxy HTTPS secure even when Host metadata is unavailable", () => {
  const request = new Request("http://localhost:30141/api/auth/session", {
    headers: { "x-forwarded-proto": "https" },
  });
  assert.equal(isExternalRequestSecure(request), true);
});

test("falls back to request URL for malformed Host while preserving proxy security", () => {
  const request = new Request("http://localhost:30141/api/devices", {
    headers: {
      host: "example.com/path",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(getExternalRequestOrigin(request), "http://localhost:30141");
  assert.equal(isExternalRequestSecure(request), true);
});
