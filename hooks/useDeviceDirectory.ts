"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isDeviceDirectoryResponse,
  type DeviceDirectoryResponse,
} from "@/lib/device-directory-core";
import {
  DeviceUnavailableError,
  probeSelectedGatewayDevice,
} from "@/lib/device-selection-client";

export const DEVICE_DIRECTORY_TIMEOUT_MS = 3_000;

interface DeviceDirectoryState {
  directory: DeviceDirectoryResponse | null;
  offlineDeviceId: string | null;
  loading: boolean;
  checking: boolean;
  error: string | null;
  retry: () => void;
  refresh: () => void;
  checkSelectedDevice: () => Promise<boolean | null>;
}

export function useDeviceDirectory(): DeviceDirectoryState {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<DeviceDirectoryState, "retry" | "refresh" | "checkSelectedDevice">>({
    directory: null,
    offlineDeviceId: null,
    loading: true,
    checking: false,
    error: null,
  });

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
      if (active) {
        setState({
          directory: payload,
          offlineDeviceId: null,
          loading: false,
          checking: false,
          error: null,
        });
      }
    }).catch((error: unknown) => {
      if (!active) return;
      if (controller.signal.aborted) {
        setState({
          directory: null,
          offlineDeviceId: null,
          loading: false,
          checking: false,
          error: "Device directory request timed out",
        });
        return;
      }
      setState({
        directory: null,
        offlineDeviceId: null,
        loading: false,
        checking: false,
        error: error instanceof Error ? error.message : "Device directory request failed",
      });
    }).finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  const checkSelectedDevice = useCallback(async (): Promise<boolean | null> => {
    const directory = state.directory;
    if (!directory || directory.selectionMode !== "gateway") return true;
    const deviceId = directory.currentDeviceId;
    setState((current) => ({ ...current, checking: true, error: null }));
    try {
      await probeSelectedGatewayDevice(deviceId, {
        timeoutMs: DEVICE_DIRECTORY_TIMEOUT_MS,
      });
      setState((current) => current.directory?.currentDeviceId === deviceId
        ? { ...current, offlineDeviceId: null, checking: false }
        : { ...current, checking: false });
      return true;
    } catch (error) {
      if (error instanceof DeviceUnavailableError) {
        setState((current) => current.directory?.currentDeviceId === deviceId
          ? { ...current, offlineDeviceId: deviceId, checking: false }
          : { ...current, checking: false });
        return false;
      }
      setState((current) => ({ ...current, checking: false }));
      return null;
    }
  }, [state.directory]);

  const retry = useCallback(() => {
    void checkSelectedDevice();
  }, [checkSelectedDevice]);

  const refresh = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return {
    ...state,
    retry,
    refresh,
    checkSelectedDevice,
  };
}
