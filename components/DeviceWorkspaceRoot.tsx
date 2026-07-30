"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { IconDevices } from "@tabler/icons-react";
import { useDeviceDirectory } from "@/hooks/useDeviceDirectory";
import { useDeviceWorkspace } from "@/hooks/useDeviceWorkspace";
import { useI18n } from "@/hooks/useI18n";
import { getInitialNavigation } from "@/lib/initial-navigation";
import { AppShell } from "./AppShell";
import styles from "./DeviceWorkspaceRoot.module.css";

export function DeviceWorkspaceRoot() {
  const searchParams = useSearchParams();
  const [initialNavigation] = useState(() => getInitialNavigation(searchParams));
  const { directory } = useDeviceDirectory();
  const { t } = useI18n();
  const workspace = useDeviceWorkspace(directory, initialNavigation);
  const switching = workspace.transition.phase === "switching";
  const loading = workspace.transition.phase === "loading";

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

  return (
    <div className={styles.root}>
      {!switching && (
        <AppShell
          key={workspace.workspaceEpoch}
          deviceDirectory={workspace.directory}
          initialNavigation={workspace.workspaceSnapshot.navigation}
          initialWorkspaceSnapshot={workspace.workspaceSnapshot}
          onDeviceNavigate={workspace.switchDevice}
          onWorkspaceReady={workspace.markWorkspaceReady}
          onWorkspaceSnapshot={workspace.saveSnapshot}
        />
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
