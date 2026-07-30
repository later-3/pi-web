"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck, IconChevronDown, IconChevronRight, IconDevices, IconExternalLink } from "@tabler/icons-react";
import { useI18n } from "@/hooks/useI18n";
import type { DeviceDescriptor, DeviceDirectoryResponse } from "@/lib/device-directory-core";
import { selectGatewayDevice } from "@/lib/device-selection-client";
import styles from "./DeviceSwitcher.module.css";

interface Props {
  variant: "desktop" | "mobile";
  directory: DeviceDirectoryResponse | null;
  initialOpen?: boolean;
  onBeforeNavigate?: () => void;
  onNavigate?: (device: DeviceDescriptor) => void;
}

export function DeviceSwitcher({
  variant,
  directory: directoryOverride,
  initialOpen = false,
  onBeforeNavigate,
  onNavigate,
}: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(initialOpen);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const directory = directoryOverride;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!directory || directory.devices.length < 2) return null;

  const current = directory.devices.find((device) => device.id === directory.currentDeviceId)
    ?? directory.devices[0];

  const navigate = async (device: DeviceDescriptor) => {
    if (device.id === directory.currentDeviceId || switchingId) return;
    setSwitchError(null);

    if (directory.selectionMode === "gateway") {
      setSwitchingId(device.id);
      try {
        await selectGatewayDevice(device.id);
        setOpen(false);
        onBeforeNavigate?.();
        if (onNavigate) onNavigate(device);
        else window.location.assign(directory.gatewayUrl ?? "/");
      } catch (error) {
        setSwitchError(error instanceof Error ? error.message : t("devices.switchFailed"));
      } finally {
        setSwitchingId(null);
      }
      return;
    }

    setOpen(false);
    onBeforeNavigate?.();
    if (onNavigate) onNavigate(device);
    else window.location.assign(device.url);
  };

  return (
    <div ref={rootRef} className={`${styles.root} ${styles[variant]}`}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => {
          setSwitchError(null);
          setOpen((value) => !value);
        }}
        aria-label={t("devices.open", { name: current.name })}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <IconDevices size={17} stroke={1.8} aria-hidden="true" />
        <span className={styles.name}>{current.name}</span>
        <IconChevronDown className={styles.chevron} size={15} stroke={1.8} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.menu} role="menu" aria-label={t("devices.label")}>
          {directory.devices.map((device) => {
            const isCurrent = device.id === directory.currentDeviceId;
            const isSwitching = switchingId === device.id;
            return (
              <button
                key={device.id}
                type="button"
                className={styles.item}
                role="menuitem"
                disabled={isCurrent || switchingId !== null}
                aria-busy={isSwitching || undefined}
                aria-current={isCurrent ? "page" : undefined}
                title={directory.selectionMode === "direct" ? device.url : device.name}
                onClick={() => void navigate(device)}
              >
                {isCurrent
                  ? <IconCheck size={16} stroke={2} aria-hidden="true" />
                  : directory.selectionMode === "gateway"
                    ? <IconChevronRight size={15} stroke={1.8} aria-hidden="true" />
                    : <IconExternalLink size={15} stroke={1.8} aria-hidden="true" />}
                <span className={styles.itemText}>
                  <span className={styles.itemName}>{device.name}</span>
                  {directory.selectionMode === "direct" && <span className={styles.itemUrl}>{device.url}</span>}
                  {isSwitching && <span className={styles.itemStatus}>{t("devices.switching")}</span>}
                </span>
                {isCurrent && <span className={styles.current}>{t("devices.current")}</span>}
              </button>
            );
          })}
          {switchError && <div className={styles.error} role="alert">{switchError}</div>}
        </div>
      )}
    </div>
  );
}
