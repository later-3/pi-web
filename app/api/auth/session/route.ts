import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import {
  WEB_AUTH_COOKIE,
  createWebAuthToken,
  findWebAuthCredential,
  getWebAuthConfig,
  isSecureWebAuthRequest,
  readCookieValue,
  verifyWebAuthToken,
} from "@/lib/web-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

class LoginPayloadTooLargeError extends Error {}

interface FailureRecord {
  count: number;
  resetAt: number;
}

type LoginAttemptGlobal = typeof globalThis & {
  __piWebLoginAttempts?: Map<string, FailureRecord>;
};

function loginAttempts(): Map<string, FailureRecord> {
  const globalState = globalThis as LoginAttemptGlobal;
  return (globalState.__piWebLoginAttempts ??= new Map());
}

function requestClientKey(request: Request): string {
  return request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    ?? "local";
}

function currentFailure(request: Request, now = Date.now()): FailureRecord | null {
  const attempts = loginAttempts();
  const key = requestClientKey(request);
  const record = attempts.get(key);
  if (!record) return null;
  if (record.resetAt <= now) {
    attempts.delete(key);
    return null;
  }
  return record;
}

function recordFailure(request: Request, now = Date.now()): FailureRecord {
  const attempts = loginAttempts();
  const key = requestClientKey(request);
  const current = currentFailure(request, now);
  const record = current
    ? { ...current, count: current.count + 1 }
    : { count: 1, resetAt: now + FAILURE_WINDOW_MS };
  attempts.set(key, record);
  return record;
}

function clearFailures(request: Request): void {
  loginAttempts().delete(requestClientKey(request));
}

function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function unavailable(): NextResponse {
  return noStoreJson({ error: "Pi Web login is not configured correctly" }, { status: 503 });
}

async function readBoundedLoginBody(request: Request): Promise<{
  username?: unknown;
  password?: unknown;
  persistent?: unknown;
}> {
  if (!request.body) throw new SyntaxError("Missing request body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new LoginPayloadTooLargeError("Login request is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as {
    username?: unknown;
    password?: unknown;
    persistent?: unknown;
  };
}

export async function GET(request: NextRequest) {
  const config = getWebAuthConfig();
  if (config.state === "disabled") {
    return noStoreJson({ enabled: false, authenticated: true });
  }
  if (config.state === "misconfigured") return unavailable();

  const verification = verifyWebAuthToken(config, readCookieValue(request));
  if (!verification.valid) {
    return noStoreJson({ enabled: true, authenticated: false }, { status: 401 });
  }
  return noStoreJson({
    enabled: true,
    authenticated: true,
    expiresAt: new Date(verification.expiresAt * 1000).toISOString(),
  });
}

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return noStoreJson({ error: "Untrusted API request" }, { status: 403 });
  }

  const config = getWebAuthConfig();
  if (config.state !== "enabled") return unavailable();

  const blocked = currentFailure(request);
  if (blocked && blocked.count >= MAX_FAILURES) {
    const retryAfter = Math.max(1, Math.ceil((blocked.resetAt - Date.now()) / 1000));
    const response = noStoreJson({ error: "Too many login attempts" }, { status: 429 });
    response.headers.set("Retry-After", String(retryAfter));
    return response;
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return noStoreJson({ error: "Login request is too large" }, { status: 413 });
  }

  let body: { username?: unknown; password?: unknown; persistent?: unknown };
  try {
    body = await readBoundedLoginBody(request);
  } catch (error) {
    if (error instanceof LoginPayloadTooLargeError) {
      return noStoreJson({ error: "Login request is too large" }, { status: 413 });
    }
    return noStoreJson({ error: "Invalid login request" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.slice(0, 128) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 1024) : "";
  const persistent = body.persistent === true;

  const credential = findWebAuthCredential(config, username, password);
  if (!credential) {
    recordFailure(request);
    return noStoreJson({ error: "Invalid username or password" }, { status: 401 });
  }

  clearFailures(request);
  const session = createWebAuthToken(config, credential, persistent);
  const response = noStoreJson({ ok: true, expiresAt: new Date(session.expiresAt * 1000).toISOString() });
  response.cookies.set(WEB_AUTH_COOKIE, session.token, {
    httpOnly: true,
    secure: isSecureWebAuthRequest(request),
    sameSite: "lax",
    path: "/",
    ...(session.maxAge ? { maxAge: session.maxAge } : {}),
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return noStoreJson({ error: "Untrusted API request" }, { status: 403 });
  }
  const response = noStoreJson({ ok: true });
  response.cookies.set(WEB_AUTH_COOKIE, "", {
    httpOnly: true,
    secure: isSecureWebAuthRequest(request),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
