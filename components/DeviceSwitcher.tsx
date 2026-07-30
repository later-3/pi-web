"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck, IconChevronDown, IconDevices, IconExternalLink } from "@tabler/icons-react";
import { useI18n } from "@/hooks/useI18n";
import type { DeviceDescriptor, DeviceDirectoryResponse } from "@/lib/device-directory-core";
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

  const navigate = (device: DeviceDescriptor) => {
    if (device.id === directory.currentDeviceId) return;
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
        onClick={() => setOpen((value) => !value)}
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
            return (
              <button
                key={device.id}
                type="button"
                className={styles.item}
                role="menuitem"
                disabled={isCurrent}
                aria-current={isCurrent ? "page" : undefined}
                title={device.url}
                onClick={() => navigate(device)}
              >
                {isCurrent
                  ? <IconCheck size={16} stroke={2} aria-hidden="true" />
                  : <IconExternalLink size={15} stroke={1.8} aria-hidden="true" />}
                <span className={styles.itemText}>
                  <span className={styles.itemName}>{device.name}</span>
                  <span className={styles.itemUrl}>{device.url}</span>
                </span>
                {isCurrent && <span className={styles.current}>{t("devices.current")}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
