import {
  isDeviceDirectoryResponse,
  type DeviceDirectoryResponse,
} from "./device-directory-core";

export const DEVICE_SELECTION_TIMEOUT_MS = 5_000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface SelectGatewayDeviceOptions {
  fetchFn?: FetchLike;
  timeoutMs?: number;
}

export class DeviceUnavailableError extends Error {
  readonly deviceId: string;
  readonly status: number | null;

  constructor(deviceId: string, status: number | null, message = "Selected device is offline") {
    super(message);
    this.name = "DeviceUnavailableError";
    this.deviceId = deviceId;
    this.status = status;
  }
}

interface DeviceUnavailablePayload {
  error?: unknown;
  deviceId?: unknown;
  message?: unknown;
}

export function deviceUnavailableErrorFromResponse(
  response: Pick<Response, "status" | "headers">,
  payload: DeviceUnavailablePayload | null,
  fallbackDeviceId = "",
): DeviceUnavailableError | null {
  const gatewayStatus = response.headers.get("X-Pi-Web-Device-Status");
  const unavailable = response.status === 502
    || response.status === 504
    || payload?.error === "device_offline"
    || (response.status === 503 && gatewayStatus === "offline");
  if (!unavailable) return null;
  const deviceId = typeof payload?.deviceId === "string"
    ? payload.deviceId
    : response.headers.get("X-Pi-Web-Device") ?? fallbackDeviceId;
  const message = typeof payload?.message === "string"
    ? payload.message
    : "The gateway cannot currently reach the selected device";
  return new DeviceUnavailableError(deviceId, response.status, message);
}

export async function probeSelectedGatewayDevice(
  deviceId: string,
  {
    fetchFn = fetch,
    timeoutMs = DEVICE_SELECTION_TIMEOUT_MS,
  }: SelectGatewayDeviceOptions = {},
): Promise<void> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn("/api/health", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    const routedDeviceId = response.headers.get("X-Pi-Web-Device");
    if (response.ok) {
      if (routedDeviceId && routedDeviceId !== deviceId) {
        throw new Error("Gateway routed the health probe to the wrong device");
      }
      return;
    }

    const payload = await response.json().catch(() => null) as DeviceUnavailablePayload | null;
    const unavailableError = deviceUnavailableErrorFromResponse(response, payload, deviceId);
    if (unavailableError) throw unavailableError;
    throw new Error(`Selected device health check failed (${response.status})`);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new DeviceUnavailableError(deviceId, null, "Selected device connection timed out");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function selectGatewayDevice(
  deviceId: string,
  {
    fetchFn = fetch,
    timeoutMs = DEVICE_SELECTION_TIMEOUT_MS,
  }: SelectGatewayDeviceOptions = {},
): Promise<{ currentDeviceId: string }> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn("/api/devices/select", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
      signal: controller.signal,
    });
    if (response.ok) {
      const payload: unknown = await response.json();
      if (
        !payload
        || typeof payload !== "object"
        || !("currentDeviceId" in payload)
        || typeof payload.currentDeviceId !== "string"
        || payload.currentDeviceId !== deviceId
      ) {
        throw new Error("Device selection response is invalid");
      }
      return { currentDeviceId: payload.currentDeviceId };
    }

    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    const message = typeof payload?.error === "string"
      ? payload.error
      : `Device selection failed (${response.status})`;
    throw new Error(message);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Device selection request timed out");
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function loadSelectedGatewayDevice(
  deviceId: string,
  {
    fetchFn = fetch,
    timeoutMs = DEVICE_SELECTION_TIMEOUT_MS,
  }: SelectGatewayDeviceOptions = {},
): Promise<DeviceDirectoryResponse> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn("/api/devices", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Selected device is unavailable (${response.status})`);
    const payload: unknown = await response.json();
    if (!isDeviceDirectoryResponse(payload) || payload.currentDeviceId !== deviceId) {
      throw new Error("Selected device returned incompatible metadata");
    }
    const routedDeviceId = response.headers.get("X-Pi-Web-Device");
    if (routedDeviceId && routedDeviceId !== deviceId) {
      throw new Error("Gateway routed the request to the wrong device");
    }
    globalThis.clearTimeout(timeout);
    await probeSelectedGatewayDevice(deviceId, { fetchFn, timeoutMs });
    return payload;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Selected device connection timed out");
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function switchGatewayDevice(
  deviceId: string,
  previousDeviceId: string,
  options: SelectGatewayDeviceOptions = {},
): Promise<DeviceDirectoryResponse> {
  try {
    await selectGatewayDevice(deviceId, options);
    return await loadSelectedGatewayDevice(deviceId, options);
  } catch (error) {
    if (previousDeviceId && previousDeviceId !== deviceId) {
      try {
        await selectGatewayDevice(previousDeviceId, options);
      } catch {
        throw new Error("Unable to connect to the selected device or restore the previous device");
      }
    }
    throw error;
  }
}
