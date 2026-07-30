"use client";

import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconDevices,
  IconExternalLink,
  IconX,
} from "@tabler/icons-react";
import { useI18n } from "@/hooks/useI18n";
import type { DeviceDescriptor, DeviceDirectoryResponse } from "@/lib/device-directory-core";
import styles from "./MobileDeviceSwitcher.module.css";

interface Props {
  directory: DeviceDirectoryResponse | null;
  runningCount: number;
  onNavigate: (device: DeviceDescriptor) => void | Promise<void>;
}

export function MobileDeviceSwitcher({ directory, runningCount, onNavigate }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;

      const controls = Array.from(
        sheetRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!directory || directory.devices.length < 2) return null;

  const current = directory.devices.find((device) => device.id === directory.currentDeviceId)
    ?? directory.devices[0];

  const closeSheet = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const navigate = async (device: DeviceDescriptor) => {
    if (device.id === directory.currentDeviceId || switchingId) return;
    setSwitchError(null);
    flushSync(() => setSwitchingId(device.id));

    try {
      await onNavigate(device);
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : t("devices.switchFailed"));
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => {
          setSwitchError(null);
          setOpen(true);
        }}
        aria-label={t(runningCount > 0 ? "devices.openWithRunning" : "devices.open", {
          name: current.name,
          count: runningCount,
        })}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <IconDevices size={18} stroke={1.8} aria-hidden="true" />
        <span className={styles.triggerName}>{current.name}</span>
        <IconChevronDown className={styles.triggerChevron} size={15} stroke={1.8} aria-hidden="true" />
        {runningCount > 0 && <span className={styles.liveDot} aria-hidden="true" />}
      </button>

      {open && (
        <>
          <button
            type="button"
            className={styles.backdrop}
            onClick={closeSheet}
            aria-label={t("devices.close")}
          />
          <section
            ref={sheetRef}
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
          >
            <div className={styles.header}>
              <div className={styles.heading}>
                <strong id={titleId}>{t("devices.sheetTitle")}</strong>
                <span id={descriptionId}>{t("devices.sheetDescription")}</span>
              </div>
              <button
                ref={closeRef}
                type="button"
                className={styles.closeButton}
                onClick={closeSheet}
                aria-label={t("devices.close")}
              >
                <IconX size={22} stroke={1.8} aria-hidden="true" />
              </button>
            </div>

            <div className={styles.deviceList}>
              {directory.devices.map((device) => {
                const isCurrent = device.id === directory.currentDeviceId;
                const isSwitching = switchingId === device.id;
                return (
                  <button
                    key={device.id}
                    type="button"
                    className={styles.deviceRow}
                    disabled={isCurrent || switchingId !== null}
                    aria-busy={isSwitching || undefined}
                    aria-current={isCurrent ? "page" : undefined}
                    title={directory.selectionMode === "direct" ? device.url : device.name}
                    onClick={() => void navigate(device)}
                  >
                    <span className={`${styles.deviceIcon}${isCurrent ? ` ${styles.currentIcon}` : ""}`}>
                      {isCurrent
                        ? <IconCheck size={18} stroke={2} aria-hidden="true" />
                        : directory.selectionMode === "gateway"
                          ? <IconChevronRight size={18} stroke={1.8} aria-hidden="true" />
                          : <IconExternalLink size={18} stroke={1.8} aria-hidden="true" />}
                    </span>
                    <span className={styles.deviceText}>
                      <strong>{device.name}</strong>
                      <span aria-live="polite">
                        {isSwitching
                          ? t("devices.switching")
                          : isCurrent
                            ? t("devices.currentWorkspace")
                            : directory.selectionMode === "direct"
                              ? device.url
                              : t("devices.switchTo", { name: device.name })}
                      </span>
                    </span>
                    {isCurrent && <span className={styles.currentBadge}>{t("devices.current")}</span>}
                  </button>
                );
              })}
            </div>

            {switchError && <div className={styles.error} role="alert">{switchError}</div>}
          </section>
        </>
      )}
    </>
  );
}
