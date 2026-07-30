"use client";

import { useEffect, useState } from "react";
import {
  isDeviceDirectoryResponse,
  type DeviceDirectoryResponse,
} from "@/lib/device-directory-core";

export const DEVICE_DIRECTORY_TIMEOUT_MS = 3_000;

interface DeviceDirectoryState {
  directory: DeviceDirectoryResponse | null;
  loading: boolean;
  error: string | null;
}

export function useDeviceDirectory(): DeviceDirectoryState {
  const [state, setState] = useState<DeviceDirectoryState>({
    directory: null,
    loading: true,
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
      if (active) setState({ directory: payload, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!active) return;
      if (controller.signal.aborted) {
        setState({ directory: null, loading: false, error: "Device directory request timed out" });
        return;
      }
      setState({
        directory: null,
        loading: false,
        error: error instanceof Error ? error.message : "Device directory request failed",
      });
    }).finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return state;
}
