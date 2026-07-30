export const DEVICE_SELECTION_TIMEOUT_MS = 5_000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface SelectGatewayDeviceOptions {
  fetchFn?: FetchLike;
  timeoutMs?: number;
}
export async function selectGatewayDevice(
  deviceId: string,
  {
    fetchFn = fetch,
    timeoutMs = DEVICE_SELECTION_TIMEOUT_MS,
  }: SelectGatewayDeviceOptions = {},
): Promise<void> {
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
    if (response.ok) return;

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
