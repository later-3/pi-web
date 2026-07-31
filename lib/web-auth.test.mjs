import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./web-auth.ts");
  } catch {
    return import("./web-auth.ts");
  }
}

const {
  createWebAuthToken,
  findWebAuthCredential,
  getWebAuthSubject,
  getWebAuthConfig,
  isPublicWebAuthPath,
  isSecureWebAuthRequest,
  readCookieValue,
  sanitizeWebAuthNext,
  verifyWebAuthToken,
} = await loadSubject();

function authorization(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function config(overrides = {}) {
  return {
    state: "enabled",
    credentials: [
      { username: "piweb", password: "correct-horse-battery-staple" },
      { username: "later", password: "123456" },
    ],
    sessionSecret: "a-session-secret-that-is-definitely-long-enough",
    persistentSessionDays: 30,
    ...overrides,
  };
}

test("finds each configured account and never accepts a partial match", () => {
  assert.deepEqual(findWebAuthCredential(config(), "piweb", "correct-horse-battery-staple"), {
    username: "piweb",
    password: "correct-horse-battery-staple",
  });
  assert.deepEqual(findWebAuthCredential(config(), "later", "123456"), {
    username: "later",
    password: "123456",
  });
  assert.equal(findWebAuthCredential(config(), "piweb", "wrong"), null);
  assert.equal(findWebAuthCredential(config(), "wrong", "correct-horse-battery-staple"), null);
});

test("required authentication fails closed when secret settings are incomplete", () => {
  const names = [
    "PI_WEB_AUTH_REQUIRED",
    "PI_WEB_AUTH_CREDENTIALS_FILE",
    "PI_WEB_AUTH_USERNAME",
    "PI_WEB_AUTH_PASSWORD_FILE",
    "PI_WEB_AUTH_SESSION_SECRET_FILE",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.PI_WEB_AUTH_REQUIRED = "1";
    delete process.env.PI_WEB_AUTH_USERNAME;
    delete process.env.PI_WEB_AUTH_CREDENTIALS_FILE;
    delete process.env.PI_WEB_AUTH_PASSWORD_FILE;
    delete process.env.PI_WEB_AUTH_SESSION_SECRET_FILE;
    assert.equal(getWebAuthConfig().state, "misconfigured");
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("loads and validates multiple accounts from a protected credentials file", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-auth-"));
  const credentialsFile = join(directory, "credentials.json");
  const secretFile = join(directory, "session-secret");
  writeFileSync(credentialsFile, JSON.stringify({ credentials: config().credentials }));
  writeFileSync(secretFile, "a-session-secret-that-is-definitely-long-enough");

  const names = [
    "PI_WEB_AUTH_REQUIRED",
    "PI_WEB_AUTH_CREDENTIALS_FILE",
    "PI_WEB_AUTH_USERNAME",
    "PI_WEB_AUTH_PASSWORD_FILE",
    "PI_WEB_AUTH_SESSION_SECRET_FILE",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.PI_WEB_AUTH_REQUIRED = "1";
    process.env.PI_WEB_AUTH_CREDENTIALS_FILE = credentialsFile;
    process.env.PI_WEB_AUTH_SESSION_SECRET_FILE = secretFile;
    delete process.env.PI_WEB_AUTH_USERNAME;
    delete process.env.PI_WEB_AUTH_PASSWORD_FILE;
    assert.deepEqual(getWebAuthConfig(), config());
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("creates signed persistent and transient sessions", () => {
  const credential = config().credentials[1];
  const persistent = createWebAuthToken(config(), credential, true, 1_000);
  const transient = createWebAuthToken(config(), credential, false, 1_000);

  assert.equal(persistent.expiresAt, 1_000 + 30 * 24 * 60 * 60);
  assert.equal(persistent.maxAge, 30 * 24 * 60 * 60);
  assert.equal(transient.expiresAt, 1_000 + 12 * 60 * 60);
  assert.equal(transient.maxAge, undefined);
  assert.deepEqual(verifyWebAuthToken(config(), persistent.token, 1_001), {
    valid: true,
    expiresAt: persistent.expiresAt,
  });
});

test("rejects tampered, expired, and password-rotated sessions", () => {
  const credential = config().credentials[1];
  const session = createWebAuthToken(config(), credential, true, 1_000);
  assert.deepEqual(verifyWebAuthToken(config(), `${session.token}x`, 1_001), {
    valid: false,
    reason: "invalid",
  });
  assert.deepEqual(verifyWebAuthToken(config(), session.token, session.expiresAt), {
    valid: false,
    reason: "expired",
  });
  const rotated = config({
    credentials: config().credentials.map((item) => item.username === credential.username
      ? { ...item, password: "rotated-password" }
      : item),
  });
  assert.deepEqual(verifyWebAuthToken(rotated, session.token, 1_001), {
    valid: false,
    reason: "invalid",
  });
});

test("rotating another account does not invalidate this account's session", () => {
  const credential = config().credentials[1];
  const session = createWebAuthToken(config(), credential, true, 1_000);
  const otherRotated = config({
    credentials: config().credentials.map((item) => item.username === "piweb"
      ? { ...item, password: "rotated-password" }
      : item),
  });
  assert.equal(verifyWebAuthToken(otherRotated, session.token, 1_001).valid, true);
});

test("sanitizes post-login destinations to local non-login paths", () => {
  assert.equal(sanitizeWebAuthNext("/?session=abc#message"), "/?session=abc#message");
  assert.equal(sanitizeWebAuthNext("https://attacker.example"), "/");
  assert.equal(sanitizeWebAuthNext("//attacker.example/path"), "/");
  assert.equal(sanitizeWebAuthNext("/\\attacker.example"), "/");
  assert.equal(sanitizeWebAuthNext("/login"), "/");
});

test("keeps only the login prerequisites public", () => {
  assert.equal(isPublicWebAuthPath("/login"), true);
  assert.equal(isPublicWebAuthPath("/api/auth/session"), true);
  assert.equal(isPublicWebAuthPath("/api/health"), true);
  assert.equal(isPublicWebAuthPath("/_next/static/chunk.js"), true);
  assert.equal(isPublicWebAuthPath("/sw.js"), true);
  assert.equal(isPublicWebAuthPath("/api/sessions"), false);
  assert.equal(isPublicWebAuthPath("/"), false);
});

test("reads the session cookie and honors forwarded HTTPS", () => {
  const request = new Request("http://localhost/", {
    headers: {
      cookie: "other=1; pi-web-session=abc%2E123; theme=dark",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(readCookieValue(request), "abc.123");
  assert.equal(isSecureWebAuthRequest(request), true);
  assert.equal(isSecureWebAuthRequest(new Request("http://localhost/")), false);
});

test("resolves the authenticated account for background work", () => {
  const original = {
    required: process.env.PI_WEB_AUTH_REQUIRED,
    username: process.env.PI_WEB_AUTH_USERNAME,
    passwordFile: process.env.PI_WEB_AUTH_PASSWORD_FILE,
    secretFile: process.env.PI_WEB_AUTH_SESSION_SECRET_FILE,
    credentialsFile: process.env.PI_WEB_AUTH_CREDENTIALS_FILE,
  };
  const directory = mkdtempSync(join(tmpdir(), "pi-web-auth-subject-"));
  const credentialsFile = join(directory, "credentials.json");
  const secretFile = join(directory, "session-secret");
  writeFileSync(credentialsFile, JSON.stringify({ credentials: config().credentials }));
  writeFileSync(secretFile, config().sessionSecret);
  try {
    process.env.PI_WEB_AUTH_REQUIRED = "1";
    process.env.PI_WEB_AUTH_CREDENTIALS_FILE = credentialsFile;
    process.env.PI_WEB_AUTH_SESSION_SECRET_FILE = secretFile;
    delete process.env.PI_WEB_AUTH_USERNAME;
    delete process.env.PI_WEB_AUTH_PASSWORD_FILE;

    const session = createWebAuthToken(config(), config().credentials[1], true);
    const request = new Request("https://pi.example/", {
      headers: { cookie: `pi-web-session=${encodeURIComponent(session.token)}` },
    });
    assert.equal(getWebAuthSubject(request), "later");
  } finally {
    if (original.required === undefined) delete process.env.PI_WEB_AUTH_REQUIRED;
    else process.env.PI_WEB_AUTH_REQUIRED = original.required;
    if (original.username === undefined) delete process.env.PI_WEB_AUTH_USERNAME;
    else process.env.PI_WEB_AUTH_USERNAME = original.username;
    if (original.passwordFile === undefined) delete process.env.PI_WEB_AUTH_PASSWORD_FILE;
    else process.env.PI_WEB_AUTH_PASSWORD_FILE = original.passwordFile;
    if (original.secretFile === undefined) delete process.env.PI_WEB_AUTH_SESSION_SECRET_FILE;
    else process.env.PI_WEB_AUTH_SESSION_SECRET_FILE = original.secretFile;
    if (original.credentialsFile === undefined) delete process.env.PI_WEB_AUTH_CREDENTIALS_FILE;
    else process.env.PI_WEB_AUTH_CREDENTIALS_FILE = original.credentialsFile;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("enables password authentication only for a non-empty configured password", async () => {
  const { isWebPasswordEnabled } = await loadSubject();
  assert.equal(isWebPasswordEnabled(undefined), false);
  assert.equal(isWebPasswordEnabled(""), false);
  assert.equal(isWebPasswordEnabled("secret"), true);
});

test("accepts only the fixed pi username and configured password", async () => {
  const { isValidBasicAuthorization } = await loadSubject();
  assert.equal(isValidBasicAuthorization(authorization("pi", "secret"), "secret"), true);
  assert.equal(isValidBasicAuthorization(authorization("admin", "secret"), "secret"), false);
  assert.equal(isValidBasicAuthorization(authorization("pi", "wrong"), "secret"), false);
});

test("supports UTF-8 passwords and colons in the password", async () => {
  const { isValidBasicAuthorization } = await loadSubject();
  const password = "口令:with:colons";
  assert.equal(isValidBasicAuthorization(authorization("pi", password), password), true);
});

test("rejects missing, malformed, and non-canonical authorization values", async () => {
  const { isValidBasicAuthorization } = await loadSubject();
  const valid = authorization("pi", "secret");

  assert.equal(isValidBasicAuthorization(null, "secret"), false);
  assert.equal(isValidBasicAuthorization("Bearer token", "secret"), false);
  assert.equal(isValidBasicAuthorization("Basic !!!", "secret"), false);
  assert.equal(isValidBasicAuthorization(`${valid}!`, "secret"), false);
  assert.equal(isValidBasicAuthorization(
    `Basic ${Buffer.from("missing-separator", "utf8").toString("base64")}`,
    "secret",
  ), false);
});

test("does not authenticate when password protection is disabled", async () => {
  const { isValidBasicAuthorization } = await loadSubject();
  assert.equal(isValidBasicAuthorization(authorization("pi", ""), ""), false);
  assert.equal(isValidBasicAuthorization(authorization("pi", "secret"), undefined), false);
});
