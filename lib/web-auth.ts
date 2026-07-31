import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isExternalRequestSecure } from "./request-origin";
import { readFileSync } from "node:fs";

export const WEB_AUTH_COOKIE = "pi-web-session";

const TOKEN_VERSION = "v1";
const TRANSIENT_SESSION_SECONDS = 12 * 60 * 60;
const DEFAULT_PERSISTENT_SESSION_DAYS = 30;

export interface WebAuthCredential {
  username: string;
  password: string;
}

export type WebAuthConfig =
  | { state: "disabled" }
  | { state: "misconfigured"; reason: string }
  | {
      state: "enabled";
      credentials: WebAuthCredential[];
      sessionSecret: string;
      persistentSessionDays: number;
    };

export type WebAuthVerification =
  | { valid: true; expiresAt: number }
  | { valid: false; reason: "missing" | "expired" | "invalid" | "misconfigured" };

function readRequiredSecret(path: string, label: string): string {
  const value = readFileSync(path, "utf8").trim();
  if (!value) throw new Error(`${label} is empty`);
  return value;
}

function readCredentialsFile(path: string): WebAuthCredential[] {
  const parsed = JSON.parse(readRequiredSecret(path, "Authentication credentials file")) as unknown;
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { credentials?: unknown }).credentials)
      ? (parsed as { credentials: unknown[] }).credentials
      : null;
  if (!entries || entries.length === 0 || entries.length > 100) {
    throw new Error("Authentication credentials file must contain 1 to 100 accounts");
  }

  const credentials = entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Authentication account ${index + 1} is invalid`);
    }
    const username = (entry as { username?: unknown }).username;
    const password = (entry as { password?: unknown }).password;
    if (typeof username !== "string" || !username.trim() || username.length > 128) {
      throw new Error(`Authentication account ${index + 1} has an invalid username`);
    }
    if (typeof password !== "string" || !password || password.length > 1024) {
      throw new Error(`Authentication account ${index + 1} has an invalid password`);
    }
    return { username: username.trim(), password };
  });

  if (new Set(credentials.map(({ username }) => username)).size !== credentials.length) {
    throw new Error("Authentication usernames must be unique");
  }
  return credentials;
}

function persistentSessionDays(): number {
  const parsed = Number.parseInt(process.env.PI_WEB_AUTH_SESSION_DAYS ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PERSISTENT_SESSION_DAYS;
  return Math.min(90, Math.max(1, parsed));
}

/**
 * Authentication is opt-in for normal local development. Once any auth
 * variable is present, incomplete configuration fails closed instead of
 * silently exposing Pi Web.
 */
export function getWebAuthConfig(): WebAuthConfig {
  const authRequired = /^(?:1|true|yes|on)$/i.test(process.env.PI_WEB_AUTH_REQUIRED?.trim() ?? "");
  const credentialsFile = process.env.PI_WEB_AUTH_CREDENTIALS_FILE?.trim();
  const username = process.env.PI_WEB_AUTH_USERNAME?.trim();
  const passwordFile = process.env.PI_WEB_AUTH_PASSWORD_FILE?.trim();
  const sessionSecretFile = process.env.PI_WEB_AUTH_SESSION_SECRET_FILE?.trim();

  if (!authRequired && !credentialsFile && !username && !passwordFile && !sessionSecretFile) {
    return { state: "disabled" };
  }
  if (!sessionSecretFile || (!credentialsFile && (!username || !passwordFile))) {
    return { state: "misconfigured", reason: "Required Pi Web authentication settings are missing" };
  }
  if (credentialsFile && (username || passwordFile)) {
    return {
      state: "misconfigured",
      reason: "Use either PI_WEB_AUTH_CREDENTIALS_FILE or the legacy single-account settings, not both",
    };
  }

  try {
    const credentials = credentialsFile
      ? readCredentialsFile(credentialsFile)
      : [{
          username: username as string,
          password: readRequiredSecret(passwordFile as string, "Authentication password file"),
        }];
    const sessionSecret = readRequiredSecret(sessionSecretFile, "Session secret file");
    if (sessionSecret.length < 32) {
      return { state: "misconfigured", reason: "Session secret must contain at least 32 characters" };
    }
    return {
      state: "enabled",
      credentials,
      sessionSecret,
      persistentSessionDays: persistentSessionDays(),
    };
  } catch (error) {
    return {
      state: "misconfigured",
      reason: error instanceof Error ? error.message : "Authentication configuration could not be loaded",
    };
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function constantTimeEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(digest(actual), digest(expected));
}

export function findWebAuthCredential(
  config: Extract<WebAuthConfig, { state: "enabled" }>,
  username: string,
  password: string,
): WebAuthCredential | null {
  let match: WebAuthCredential | null = null;
  for (const credential of config.credentials) {
    const usernameMatches = constantTimeEqual(username, credential.username);
    const passwordMatches = constantTimeEqual(password, credential.password);
    if (usernameMatches && passwordMatches) match = credential;
  }
  return match;
}

function credentialFingerprint(
  config: Extract<WebAuthConfig, { state: "enabled" }>,
  credential: WebAuthCredential,
): string {
  return createHmac("sha256", config.sessionSecret)
    .update(credential.username)
    .update("\0")
    .update(credential.password)
    .digest("base64url")
    .slice(0, 22);
}

function tokenSignature(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`${TOKEN_VERSION}.${payload}`).digest("base64url");
}

export function createWebAuthToken(
  config: Extract<WebAuthConfig, { state: "enabled" }>,
  credential: WebAuthCredential,
  persistent: boolean,
  nowSeconds = Math.floor(Date.now() / 1000),
): { token: string; expiresAt: number; maxAge?: number } {
  const lifetime = persistent
    ? config.persistentSessionDays * 24 * 60 * 60
    : TRANSIENT_SESSION_SECONDS;
  const expiresAt = nowSeconds + lifetime;
  const payload = Buffer.from(JSON.stringify({
    exp: expiresAt,
    sub: credential.username,
    cred: credentialFingerprint(config, credential),
  })).toString("base64url");
  const token = `${TOKEN_VERSION}.${payload}.${tokenSignature(config.sessionSecret, payload)}`;
  return {
    token,
    expiresAt,
    ...(persistent ? { maxAge: lifetime } : {}),
  };
}

export function verifyWebAuthToken(
  config: WebAuthConfig,
  token: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): WebAuthVerification {
  if (config.state === "misconfigured") return { valid: false, reason: "misconfigured" };
  if (config.state === "disabled") return { valid: true, expiresAt: Number.MAX_SAFE_INTEGER };
  if (!token) return { valid: false, reason: "missing" };
  if (token.length > 2048) return { valid: false, reason: "invalid" };

  const [version, payload, signature, extra] = token.split(".");
  if (version !== TOKEN_VERSION || !payload || !signature || extra !== undefined) {
    return { valid: false, reason: "invalid" };
  }

  const expectedSignature = tokenSignature(config.sessionSecret, payload);
  if (!constantTimeEqual(signature, expectedSignature)) return { valid: false, reason: "invalid" };

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
      sub?: unknown;
      cred?: unknown;
    };
    if (!Number.isInteger(decoded.exp) || typeof decoded.sub !== "string" || typeof decoded.cred !== "string") {
      return { valid: false, reason: "invalid" };
    }
    const credential = config.credentials.find(({ username }) => constantTimeEqual(decoded.sub as string, username));
    if (!credential || !constantTimeEqual(decoded.cred, credentialFingerprint(config, credential))) {
      return { valid: false, reason: "invalid" };
    }
    const expiresAt = decoded.exp as number;
    if (expiresAt <= nowSeconds) return { valid: false, reason: "expired" };
    return { valid: true, expiresAt };
  } catch {
    return { valid: false, reason: "invalid" };
  }
}

export function readCookieValue(request: Request, name = WEB_AUTH_COOKIE): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Return the authenticated account that owns a request. Authentication is
 * already enforced by proxy.ts, but server-side background work (such as Web
 * Push) needs a stable account key after the request has finished.
 */
export function getWebAuthSubject(request: Request): string | null {
  const config = getWebAuthConfig();
  if (config.state === "disabled") return "local";

  const token = readCookieValue(request);
  const verification = verifyWebAuthToken(config, token);
  if (!verification.valid || !token) return null;

  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown };
    return typeof decoded.sub === "string" && decoded.sub ? decoded.sub : null;
  } catch {
    return null;
  }
}

export function isSecureWebAuthRequest(request: Request): boolean {
  return isExternalRequestSecure(request);
}

export function sanitizeWebAuthNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (/\p{Cc}/u.test(value)) return "/";
  try {
    const parsed = new URL(value, "https://pi-web.invalid");
    if (parsed.origin !== "https://pi-web.invalid") return "/";
    if (parsed.pathname === "/login") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function isPublicWebAuthPath(pathname: string): boolean {
  return pathname === "/login"
    || pathname === "/api/auth/session"
    || pathname === "/api/health"
    || pathname === "/manifest.webmanifest"
    || pathname === "/sw.js"
    || pathname === "/favicon.ico"
    || pathname === "/apple-touch-icon.png"
    || pathname.startsWith("/_next/")
    || /^\/icon-(?:maskable-)?(?:192x192|512x512)\.png$/.test(pathname);
}

export const PI_WEB_BASIC_AUTH_USERNAME = "pi";

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secretsEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(hashSecret(actual), hashSecret(expected));
}

export function isWebPasswordEnabled(
  password: string | undefined = process.env.PI_WEB_PASSWORD,
): password is string {
  return typeof password === "string" && password.length > 0;
}

export function isValidBasicAuthorization(
  authorization: string | null,
  password = process.env.PI_WEB_PASSWORD,
): boolean {
  if (!isWebPasswordEnabled(password) || !authorization) return false;

  const match = /^Basic\s+(\S+)$/i.exec(authorization);
  if (!match) return false;

  let credentials: string;
  try {
    const decoded = Buffer.from(match[1], "base64");
    if (decoded.toString("base64") !== match[1]) return false;
    credentials = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch {
    return false;
  }

  const separator = credentials.indexOf(":");
  if (separator === -1) return false;

  const username = credentials.slice(0, separator);
  const suppliedPassword = credentials.slice(separator + 1);
  const usernameMatches = secretsEqual(username, PI_WEB_BASIC_AUTH_USERNAME);
  const passwordMatches = secretsEqual(suppliedPassword, password);
  return usernameMatches && passwordMatches;
}
