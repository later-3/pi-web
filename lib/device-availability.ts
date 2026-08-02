export const DEVICE_OFFLINE_FAILURE_THRESHOLD = 3;
export const DEVICE_OFFLINE_MIN_DURATION_MS = 8_000;
export const DEVICE_ONLINE_SUCCESS_THRESHOLD = 2;

export type DeviceAvailabilitySample = "online" | "offline";

export interface DeviceAvailabilityTracker {
  deviceId: string;
  offline: boolean;
  consecutiveFailures: number;
  firstFailureAt: number | null;
  consecutiveSuccesses: number;
}

export function createDeviceAvailabilityTracker(
  deviceId: string,
  offline = false,
): DeviceAvailabilityTracker {
  return {
    deviceId,
    offline,
    consecutiveFailures: 0,
    firstFailureAt: null,
    consecutiveSuccesses: 0,
  };
}

export function recordDeviceAvailabilitySample(
  tracker: DeviceAvailabilityTracker,
  sample: DeviceAvailabilitySample,
  now: number,
): DeviceAvailabilityTracker {
  if (sample === "online") {
    if (!tracker.offline) {
      return createDeviceAvailabilityTracker(tracker.deviceId);
    }

    const consecutiveSuccesses = tracker.consecutiveSuccesses + 1;
    if (consecutiveSuccesses >= DEVICE_ONLINE_SUCCESS_THRESHOLD) {
      return createDeviceAvailabilityTracker(tracker.deviceId);
    }
    return {
      ...tracker,
      consecutiveFailures: 0,
      firstFailureAt: null,
      consecutiveSuccesses,
    };
  }

  if (tracker.offline) {
    return {
      ...tracker,
      consecutiveSuccesses: 0,
    };
  }

  const firstFailureAt = tracker.firstFailureAt ?? now;
  const consecutiveFailures = tracker.consecutiveFailures + 1;
  const confirmedOffline = consecutiveFailures >= DEVICE_OFFLINE_FAILURE_THRESHOLD
    && now - firstFailureAt >= DEVICE_OFFLINE_MIN_DURATION_MS;

  return {
    ...tracker,
    offline: confirmedOffline,
    consecutiveFailures,
    firstFailureAt,
    consecutiveSuccesses: 0,
  };
}
