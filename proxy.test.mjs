import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url, { tsconfigPaths: true }).import("./proxy.ts");
}

const { proxy } = await loadSubject();

const AUTH_ENVIRONMENT_NAMES = [
  "PI_WEB_PASSWORD",
  "PI_WEB_AUTH_REQUIRED",
  "PI_WEB_AUTH_CREDENTIALS_FILE",
  "PI_WEB_AUTH_USERNAME",
  "PI_WEB_AUTH_PASSWORD_FILE",
  "PI_WEB_AUTH_SESSION_SECRET_FILE",
];

function request(headers = {}, pathname = "/") {
  return new NextRequest(`http://localhost:30141${pathname}`, {
    headers: { host: "localhost:30141", ...headers },
  });
}

async function withAuthenticationEnvironment(values, callback) {
  const previous = Object.fromEntries(AUTH_ENVIRONMENT_NAMES.map((name) => [name, process.env[name]]));
  try {
    for (const name of AUTH_ENVIRONMENT_NAMES) delete process.env[name];
    for (const [name, value] of Object.entries(values)) process.env[name] = value;
    await callback();
  } finally {
    for (const name of AUTH_ENVIRONMENT_NAMES) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("keeps upstream Basic Auth available when app login is disabled", async () => {
  await withAuthenticationEnvironment({ PI_WEB_PASSWORD: "secret" }, async () => {
    const unauthorized = proxy(request());
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), 'Basic realm="Pi Web", charset="UTF-8"');

    const authorization = `Basic ${Buffer.from("pi:secret").toString("base64")}`;
    const authorized = proxy(request({ authorization }));
    assert.equal(authorized.status, 200);
    assert.equal(authorized.headers.get("x-middleware-next"), "1");
  });
});

test("fails closed instead of stacking Basic Auth and app login", async () => {
  await withAuthenticationEnvironment({
    PI_WEB_PASSWORD: "secret",
    PI_WEB_AUTH_REQUIRED: "1",
  }, async () => {
    const response = proxy(request({
      authorization: `Basic ${Buffer.from("pi:secret").toString("base64")}`,
    }));
    assert.equal(response.status, 503);
    assert.match(await response.text(), /either PI_WEB_PASSWORD or PI_WEB_AUTH_/);
  });
});

test("leaves framework assets public in upstream Basic Auth mode", async () => {
  await withAuthenticationEnvironment({ PI_WEB_PASSWORD: "secret" }, async () => {
    const response = proxy(request({}, "/_next/static/chunks/app.js"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });
});

test("applies the host allow-list to page requests as well as APIs", async () => {
  await withAuthenticationEnvironment({}, async () => {
    const response = proxy(request({ host: "attacker.example:30141" }));
    assert.equal(response.status, 403);
  });
});
