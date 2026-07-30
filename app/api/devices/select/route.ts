import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { loadDeviceDirectory } from "@/lib/device-directory";
import {
  DEVICE_SELECTION_COOKIE,
  DEVICE_SELECTION_COOKIE_MAX_AGE_SECONDS,
  MAX_DEVICE_SELECTION_BODY_BYTES,
} from "@/lib/device-selection";
import { getExternalRequestOrigin, isExternalRequestSecure } from "@/lib/request-origin";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

class DeviceSelectionBodyTooLargeError extends Error {}

function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new SyntaxError("Missing request body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DEVICE_SELECTION_BODY_BYTES) {
      await reader.cancel();
      throw new DeviceSelectionBodyTooLargeError("Device selection request is too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return noStoreJson({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return noStoreJson({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_DEVICE_SELECTION_BODY_BYTES) {
    return noStoreJson({ error: "Device selection request is too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof DeviceSelectionBodyTooLargeError) {
      return noStoreJson({ error: "Device selection request is too large" }, { status: 413 });
    }
    return noStoreJson({ error: "Invalid device selection request" }, { status: 400 });
  }

  const directory = await loadDeviceDirectory({
    requestOrigin: getExternalRequestOrigin(request),
  });
  if (directory.selectionMode !== "gateway") {
    return noStoreJson({ error: "Gateway device selection is not active for this origin" }, { status: 409 });
  }

  const deviceId = body && typeof body === "object" && "deviceId" in body
    ? (body as { deviceId?: unknown }).deviceId
    : null;
  if (typeof deviceId !== "string" || !directory.devices.some((device) => device.id === deviceId)) {
    return noStoreJson({ error: "Unknown device" }, { status: 404 });
  }

  const response = noStoreJson({ ok: true, currentDeviceId: deviceId });
  response.cookies.set(DEVICE_SELECTION_COOKIE, deviceId, {
    httpOnly: true,
    secure: isExternalRequestSecure(request),
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_SELECTION_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
