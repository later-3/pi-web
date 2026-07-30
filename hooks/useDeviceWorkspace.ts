"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { DeviceDescriptor, DeviceDirectoryResponse } from "@/lib/device-directory-core";
import { switchGatewayDevice } from "@/lib/device-selection-client";
import type { InitialNavigation } from "@/lib/initial-navigation";
import {
  emptyDeviceWorkspaceSnapshot,
  loadDeviceWorkspaceSnapshot,
  navigationFromSearch,
  saveDeviceWorkspaceSnapshot,
  workspaceUrlFromNavigation,
  type DeviceWorkspaceSnapshot,
} from "@/lib/device-workspace";

export const DEVICE_WORKSPACE_READY_TIMEOUT_MS = 6_000;

export interface DeviceWorkspaceTransition {
  phase: "idle" | "switching" | "loading";
  targetDeviceId: string | null;
  targetDeviceName: string | null;
}

interface WorkspaceState {
  deviceId: string | null;
  directory: DeviceDirectoryResponse | null;
  epoch: number;
  snapshot: DeviceWorkspaceSnapshot;
}

function waitForReactPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

async function runWithViewTransition(update: () => Promise<void>): Promise<void> {
  if (
    !("startViewTransition" in document)
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    await update();
    return;
  }
  const transition = document.startViewTransition(update);
  // The DOM update is authoritative even when the browser declines or aborts
  // the visual transition (for example after losing visibility mid-switch).
  // Do not turn a cosmetic transition failure into a device-switch failure.
  await transition.finished.catch(() => undefined);
}

export function useDeviceWorkspace(
  directory: DeviceDirectoryResponse | null,
  initialNavigation: InitialNavigation,
) {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => ({
    deviceId: null,
    directory: null,
    epoch: 0,
    snapshot: emptyDeviceWorkspaceSnapshot(initialNavigation),
  }));
  const [transition, setTransition] = useState<DeviceWorkspaceTransition>({
    phase: "idle",
    targetDeviceId: null,
    targetDeviceName: null,
  });
  const [switchError, setSwitchError] = useState<string | null>(null);
  const switchLockRef = useRef(false);
  const readyTimerRef = useRef<number | null>(null);

  const effectiveDirectory = useMemo(() => {
    const source = workspace.directory ?? directory;
    if (!source || !workspace.deviceId || source.currentDeviceId === workspace.deviceId) return source;
    return { ...source, currentDeviceId: workspace.deviceId };
  }, [directory, workspace.deviceId, workspace.directory]);
  const currentDeviceId = workspace.deviceId ?? effectiveDirectory?.currentDeviceId ?? null;

  const saveSnapshot = useCallback((snapshot: DeviceWorkspaceSnapshot) => {
    if (!currentDeviceId || typeof window === "undefined") return;
    saveDeviceWorkspaceSnapshot(window.sessionStorage, currentDeviceId, {
      ...snapshot,
      navigation: navigationFromSearch(window.location.search),
    });
  }, [currentDeviceId]);

  const switchDevice = useCallback(async (device: DeviceDescriptor) => {
    if (!effectiveDirectory || !currentDeviceId || device.id === currentDeviceId || switchLockRef.current) return;
    if (effectiveDirectory.selectionMode === "direct") {
      window.location.assign(device.url);
      return;
    }

    switchLockRef.current = true;
    setSwitchError(null);

    const updateWorkspace = async () => {
      setTransition({ phase: "switching", targetDeviceId: device.id, targetDeviceName: device.name });

      // The root stops rendering the old workspace in this phase. Two frames let
      // React run effect cleanup before the preference cookie changes, so old
      // EventSource/fetch work cannot cross the device boundary. When supported,
      // the View Transition API keeps the real previous workspace visible while
      // this async control-plane transaction runs.
      await waitForReactPaint();

      try {
        const nextDirectory = await switchGatewayDevice(device.id, currentDeviceId);
        const nextSnapshot = loadDeviceWorkspaceSnapshot(window.sessionStorage, device.id)
          ?? emptyDeviceWorkspaceSnapshot();
        window.history.replaceState(
          window.history.state,
          "",
          workspaceUrlFromNavigation(nextSnapshot.navigation),
        );
        readyTimerRef.current = window.setTimeout(() => {
          readyTimerRef.current = null;
          setTransition({ phase: "idle", targetDeviceId: null, targetDeviceName: null });
        }, DEVICE_WORKSPACE_READY_TIMEOUT_MS);
        setWorkspace((current) => ({
          deviceId: device.id,
          directory: nextDirectory,
          epoch: current.epoch + 1,
          snapshot: nextSnapshot,
        }));
        setTransition({ phase: "loading", targetDeviceId: device.id, targetDeviceName: device.name });
        // Resolve the View Transition callback after React has committed the
        // target workspace's first paint. Data readiness remains governed by
        // markWorkspaceReady/the bounded timer outside the visual transaction.
        await waitForReactPaint();
      } catch (error) {
        const restoredSnapshot = loadDeviceWorkspaceSnapshot(window.sessionStorage, currentDeviceId)
          ?? emptyDeviceWorkspaceSnapshot(navigationFromSearch(window.location.search));
        setWorkspace((current) => ({ ...current, epoch: current.epoch + 1, snapshot: restoredSnapshot }));
        setTransition({ phase: "idle", targetDeviceId: null, targetDeviceName: null });
        setSwitchError(error instanceof Error ? error.message : "Unable to switch device");
        await waitForReactPaint();
      }
    };

    try {
      await runWithViewTransition(updateWorkspace);
    } finally {
      switchLockRef.current = false;
    }
  }, [currentDeviceId, effectiveDirectory]);

  const markWorkspaceReady = useCallback(() => {
    if (readyTimerRef.current) window.clearTimeout(readyTimerRef.current);
    readyTimerRef.current = null;
    setTransition((current) => current.phase === "loading"
      ? { phase: "idle", targetDeviceId: null, targetDeviceName: null }
      : current);
  }, []);

  return {
    currentDeviceId,
    directory: effectiveDirectory,
    workspaceEpoch: workspace.epoch,
    workspaceSnapshot: workspace.snapshot,
    transition,
    switchError,
    dismissSwitchError: () => setSwitchError(null),
    saveSnapshot,
    switchDevice,
    markWorkspaceReady,
  };
}
