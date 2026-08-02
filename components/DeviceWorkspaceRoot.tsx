"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IconDevices, IconRefresh, IconWifiOff } from "@tabler/icons-react";
import { useDeviceDirectory } from "@/hooks/useDeviceDirectory";
import { useDeviceWorkspace } from "@/hooks/useDeviceWorkspace";
import { useI18n } from "@/hooks/useI18n";
import { getInitialNavigation } from "@/lib/initial-navigation";
import { AppShell } from "./AppShell";
import styles from "./DeviceWorkspaceRoot.module.css";

export function DeviceWorkspaceRoot() {
  const searchParams = useSearchParams();
  const [initialNavigation] = useState(() => getInitialNavigation(searchParams));
  const deviceDirectory = useDeviceDirectory();
  const { directory, refresh: refreshDeviceDirectory } = deviceDirectory;
  const { t } = useI18n();
  const workspace = useDeviceWorkspace(directory, initialNavigation);
  const switching = workspace.transition.phase === "switching";
  const loading = workspace.transition.phase === "loading";
  const offlineDevice = deviceDirectory.offlineDeviceId === workspace.currentDeviceId
    ? workspace.directory?.devices.find((device) => device.id === workspace.currentDeviceId) ?? null
    : null;
  const deviceOffline = Boolean(offlineDevice);

  useEffect(() => {
    if (
      workspace.currentDeviceId
      && directory
      && workspace.currentDeviceId !== directory.currentDeviceId
    ) {
      refreshDeviceDirectory();
    }
  }, [directory, refreshDeviceDirectory, workspace.currentDeviceId]);

  const statusCard = (
    <div className={styles.statusCard} role="status" aria-live="polite">
      <span className={styles.statusIcon}><IconDevices size={20} stroke={1.8} aria-hidden="true" /></span>
      <span className={styles.statusText}>
        <strong>{t("devices.connecting", { name: workspace.transition.targetDeviceName ?? "Pi Web" })}</strong>
        <span>{t(switching ? "devices.disconnectingCurrent" : "devices.loadingWorkspace")}</span>
      </span>
      <span className={styles.spinner} aria-hidden="true" />
    </div>
  );

  const directoryStatusCard = (
    <div className={styles.statusCard} role="status" aria-live="polite">
      <span className={styles.statusIcon}><IconDevices size={20} stroke={1.8} aria-hidden="true" /></span>
      <span className={styles.statusText}>
        <strong>{t("devices.checkingAvailability")}</strong>
        <span>{t("devices.checkingAvailabilityDescription")}</span>
      </span>
      <span className={styles.spinner} aria-hidden="true" />
    </div>
  );

  const offlineCard = offlineDevice && workspace.directory ? (
    <div className={styles.offlineCard} role="alert" aria-live="assertive">
      <span className={styles.offlineIcon}><IconWifiOff size={28} stroke={1.7} aria-hidden="true" /></span>
      <div className={styles.offlineCopy}>
        <h1>{t("devices.offlineTitle", { name: offlineDevice.name })}</h1>
        <p>{t("devices.offlineDescription")}</p>
      </div>
      <div className={styles.offlineActions}>
        {workspace.directory.devices
          .filter((device) => device.id !== offlineDevice.id)
          .map((device) => (
            <button
              key={device.id}
              type="button"
              className={styles.primaryAction}
              onClick={() => void workspace.switchDevice(device)}
            >
              {t("devices.switchToAvailable", { name: device.name })}
            </button>
          ))}
        <button
          type="button"
          className={styles.secondaryAction}
          onClick={deviceDirectory.retry}
          disabled={deviceDirectory.checking}
        >
          <IconRefresh size={17} stroke={1.8} aria-hidden="true" />
          {t(deviceDirectory.checking ? "devices.checking" : "devices.checkAgain")}
        </button>
      </div>
      <p className={styles.offlineHint}>{t("devices.offlineHint")}</p>
    </div>
  ) : null;

  return (
    <div className={styles.root}>
      {!deviceDirectory.loading && !deviceOffline && !switching && (
        <AppShell
          key={workspace.workspaceEpoch}
          deviceDirectory={workspace.directory}
          initialNavigation={workspace.workspaceSnapshot.navigation}
          initialWorkspaceSnapshot={workspace.workspaceSnapshot}
          onDeviceNavigate={workspace.switchDevice}
          onWorkspaceReady={workspace.markWorkspaceReady}
          onWorkspaceSnapshot={workspace.saveSnapshot}
          onConnectionFailure={deviceDirectory.checkSelectedDevice}
        />
      )}
      {deviceDirectory.loading && (
        <div className={styles.switchScreen}>{directoryStatusCard}</div>
      )}
      {!deviceDirectory.loading && deviceOffline && !switching && (
        <div className={styles.offlineScreen}>{offlineCard}</div>
      )}
      {switching && <div className={styles.switchScreen}>{statusCard}</div>}
      {loading && <div className={styles.loadingShield}>{statusCard}</div>}
      {workspace.switchError && (
        <div className={styles.errorToast} role="alert">
          <span>{workspace.switchError}</span>
          <button type="button" onClick={workspace.dismissSwitchError} aria-label={t("common.close")}>×</button>
        </div>
      )}
    </div>
  );
}
