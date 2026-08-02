"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createDeviceAvailabilityTracker,
  recordDeviceAvailabilitySample,
} from "@/lib/device-availability";
import {
  isDeviceDirectoryResponse,
  type DeviceDirectoryResponse,
} from "@/lib/device-directory-core";
import {
  confirmSelectedGatewayDevice,
  DEVICE_CONFIRMATION_PROBE_TIMEOUT_MS,
  DeviceUnavailableError,
  probeSelectedGatewayDevice,
} from "@/lib/device-selection-client";

export const DEVICE_DIRECTORY_TIMEOUT_MS = 3_000;
export const DEVICE_AVAILABILITY_POLL_MS = 5_000;

interface DeviceDirectoryState {
  directory: DeviceDirectoryResponse | null;
  offlineDeviceId: string | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
  refresh: () => void;
}

export function useDeviceDirectory(): DeviceDirectoryState {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<DeviceDirectoryState, "retry" | "refresh">>({
    directory: null,
    offlineDeviceId: null,
    loading: true,
    error: null,
  });
  const monitoredDeviceId = state.directory?.selectionMode === "gateway"
    ? state.directory.currentDeviceId
    : null;
  const monitoredDeviceOffline = monitoredDeviceId !== null
    && state.offlineDeviceId === monitoredDeviceId;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), DEVICE_DIRECTORY_TIMEOUT_MS);

    void fetch("/api/devices", {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Device directory request failed (${response.status})`);
      const payload: unknown = await response.json();
      if (!isDeviceDirectoryResponse(payload)) throw new Error("Device directory response is invalid");
      window.clearTimeout(timeout);
      if (payload.selectionMode === "gateway") {
        try {
          await confirmSelectedGatewayDevice(payload.currentDeviceId, {
            timeoutMs: DEVICE_CONFIRMATION_PROBE_TIMEOUT_MS,
          });
        } catch (error) {
          if (error instanceof DeviceUnavailableError) {
            if (active) {
              setState({
                directory: payload,
                offlineDeviceId: error.deviceId,
                loading: false,
                error: null,
              });
            }
            return;
          }
          throw error;
        }
      }
      if (active) {
        setState({ directory: payload, offlineDeviceId: null, loading: false, error: null });
      }
    }).catch((error: unknown) => {
      if (!active) return;
      if (controller.signal.aborted) {
        setState({
          directory: null,
          offlineDeviceId: null,
          loading: false,
          error: "Device directory request timed out",
        });
        return;
      }
      setState({
        directory: null,
        offlineDeviceId: null,
        loading: false,
        error: error instanceof Error ? error.message : "Device directory request failed",
      });
    }).finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  useEffect(() => {
    if (!monitoredDeviceId) return;
    let active = true;
    let inFlight = false;
    let tracker = createDeviceAvailabilityTracker(
      monitoredDeviceId,
      monitoredDeviceOffline,
    );

    const applySample = (sample: "online" | "offline") => {
      const wasOffline = tracker.offline;
      tracker = recordDeviceAvailabilitySample(tracker, sample, performance.now());
      if (!active || tracker.offline === wasOffline) return;
      const offline = tracker.offline;
      setState((current) => current.directory?.currentDeviceId === monitoredDeviceId
        ? { ...current, offlineDeviceId: offline ? monitoredDeviceId : null }
        : current);
    };

    const checkAvailability = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        await probeSelectedGatewayDevice(monitoredDeviceId, {
          timeoutMs: DEVICE_DIRECTORY_TIMEOUT_MS,
        });
        applySample("online");
      } catch (error) {
        if (error instanceof DeviceUnavailableError) applySample("offline");
      } finally {
        inFlight = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkAvailability();
    };
    const interval = window.setInterval(() => void checkAvailability(), DEVICE_AVAILABILITY_POLL_MS);
    window.addEventListener("online", checkAvailability);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("online", checkAvailability);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [monitoredDeviceId, monitoredDeviceOffline]);

  const retry = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    setAttempt((current) => current + 1);
  }, []);

  const refresh = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return {
    ...state,
    retry,
    refresh,
  };
}
