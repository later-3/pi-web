import { NextResponse } from "next/server";
import { hasJsonContentType } from "@/lib/request-security";
import {
  getPushPublicKey,
  normalizePushSubscription,
  removePushSubscription,
  savePushSubscription,
  sendPushTest,
} from "@/lib/push-notifications";
import { getWebAuthSubject } from "@/lib/web-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;

function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function requestOrigin(request: Request): string {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const host = request.headers.get("host");
  if (forwardedProto === "https" && host) {
    try {
      return new URL(`https://${host}`).origin;
    } catch {
      // Fall back to the request URL below.
    }
  }
  return new URL(request.url).origin;
}

function authenticatedAccount(request: Request): string | NextResponse {
  const account = getWebAuthSubject(request);
  return account ?? noStoreJson({ error: "Authentication required" }, { status: 401 });
}

export async function GET(request: Request) {
  const account = authenticatedAccount(request);
  if (account instanceof NextResponse) return account;
  return noStoreJson({ publicKey: getPushPublicKey() });
}

export async function POST(request: Request) {
  const account = authenticatedAccount(request);
  if (account instanceof NextResponse) return account;
  if (!hasJsonContentType(request)) {
    return noStoreJson({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return noStoreJson({ error: "Push subscription is too large" }, { status: 413 });
  }

  let body: { subscription?: unknown; locale?: unknown; test?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return noStoreJson({ error: "Invalid push subscription" }, { status: 400 });
  }
  const subscription = normalizePushSubscription(body.subscription);
  if (!subscription) {
    return noStoreJson({ error: "Invalid push subscription" }, { status: 400 });
  }

  const saved = savePushSubscription(account, subscription, {
    locale: body.locale,
    vapidSubject: requestOrigin(request),
  });
  if (body.test === true) {
    try {
      await sendPushTest(saved);
    } catch (error) {
      const statusCode = (error as { statusCode?: unknown })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        removePushSubscription(account, subscription.endpoint);
      }
      console.error("[pi-web] push test failed:", {
        statusCode: typeof statusCode === "number" ? statusCode : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
      return noStoreJson({
        error: "Test notification could not be delivered",
        code: "delivery_failed",
      }, { status: 502 });
    }
    return noStoreJson({ ok: true, verified: true });
  }
  return noStoreJson({ ok: true, verified: Boolean(saved.verifiedAt) });
}

export async function DELETE(request: Request) {
  const account = authenticatedAccount(request);
  if (account instanceof NextResponse) return account;
  if (!hasJsonContentType(request)) {
    return noStoreJson({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: { endpoint?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return noStoreJson({ error: "Invalid request" }, { status: 400 });
  }
  if (typeof body.endpoint !== "string" || body.endpoint.length > 4096) {
    return noStoreJson({ error: "Invalid push endpoint" }, { status: 400 });
  }
  removePushSubscription(account, body.endpoint);
  return noStoreJson({ ok: true });
}
