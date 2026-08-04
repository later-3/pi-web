"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconChevronDown,
  IconCpu,
  IconDotsVertical,
  IconFileText,
  IconFolder,
  IconHistory,
  IconLayersLinked,
  IconMoon,
  IconPlug,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconSun,
  IconX,
} from "@tabler/icons-react";
import { getFileName } from "@/lib/file-paths";
import type { DeviceDescriptor, DeviceDirectoryResponse } from "@/lib/device-directory-core";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { MobileDeviceSwitcher } from "./MobileDeviceSwitcher";

interface Props {
  selectedSession: SessionInfo | null;
  cwd: string | null;
  deviceDirectory: DeviceDirectoryResponse | null;
  onDeviceNavigate: (device: DeviceDescriptor) => void | Promise<void>;
  isDark: boolean;
  onNewSession: (cwd: string) => void;
  onOpenWorkspace: () => void;
  onRefresh: () => void;
  onOpenFiles: () => void;
  onViewHistory: () => void;
  onToggleTheme: () => void;
  onShowUtilities: () => void;
  onRunSelfCheck: () => void;
  settingsAvailable: boolean;
  onOpenModels: () => void;
  onOpenSkills: () => void;
  onOpenPlugins: () => void;
  onOpenExtensions: () => void;
}

function sessionLabel(session: SessionInfo): string {
  const label = session.name?.trim() || session.firstMessage?.trim() || "Untitled session";
  return label.length > 28 ? `${label.slice(0, 27)}…` : label;
}

export function MobileWorkspaceHeader({
  selectedSession,
  cwd,
  deviceDirectory,
  onDeviceNavigate,
  isDark,
  onNewSession,
  onOpenWorkspace,
  onRefresh,
  onOpenFiles,
  onViewHistory,
  onToggleTheme,
  onShowUtilities,
  onRunSelfCheck,
  settingsAvailable,
  onOpenModels,
  onOpenSkills,
  onOpenPlugins,
  onOpenExtensions,
}: Props) {
  const { t } = useI18n();
  const shellRef = useRef<HTMLElement>(null);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/agent/running/events");
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type?: string; runningSessionIds?: string[] };
        if (data.type === "running") setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      } catch {
        // EventSource reconnects automatically; retain the last known state.
      }
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [selectedSession?.id]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const updateHeight = () => {
      document.documentElement.style.setProperty(
        "--mobile-header-height",
        `${shell.getBoundingClientRect().height}px`,
      );
    };
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateHeight);
    observer?.observe(shell);
    window.addEventListener("resize", updateHeight);
    updateHeight();

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateHeight);
      document.documentElement.style.removeProperty("--mobile-header-height");
    };
  }, []);

  const activeCwd = selectedSession?.cwd ?? cwd;
  const projectName = getFileName(activeCwd ?? "") || "Choose project";

  const handleRefresh = () => {
    setRefreshing(true);
    onRefresh();
    window.setTimeout(() => setRefreshing(false), 320);
  };

  return (
    <section ref={shellRef} className="mobile-session-shell" aria-label={t("mobile.workspaceNavigation")}>
      <header className="mobile-session-header">
        <button
          type="button"
          className="mobile-project-switcher"
          onClick={onOpenWorkspace}
          aria-label={t("mobile.openWorkspace", { project: projectName })}
        >
          <span className="mobile-project-mark" aria-hidden="true">π</span>
          <span className="mobile-project-name">{projectName}</span>
          <IconChevronDown size={18} stroke={1.8} aria-hidden="true" />
        </button>

        <div className="mobile-header-actions">
          <MobileDeviceSwitcher
            directory={deviceDirectory}
            runningCount={runningSessionIds.size}
            onNavigate={onDeviceNavigate}
          />
          <button
            type="button"
            className="mobile-icon-button"
            onClick={() => activeCwd && onNewSession(activeCwd)}
            disabled={!activeCwd}
            aria-label={t("mobile.newSession")}
          >
            <IconPlus size={23} stroke={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mobile-icon-button"
            onClick={() => setMenuOpen(true)}
            aria-label={t("mobile.openMenu")}
            aria-expanded={menuOpen}
          >
            <IconDotsVertical size={22} stroke={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>

      {menuOpen && (
        <>
          <button
            type="button"
            className="mobile-action-backdrop"
            onClick={() => setMenuOpen(false)}
            aria-label={t("mobile.closeMenu")}
          />
          <div className="mobile-action-sheet" role="dialog" aria-modal="true" aria-label={t("mobile.menu")}>
            <div className="mobile-action-sheet-header">
              <div>
                <strong>{projectName}</strong>
                <span>{selectedSession ? sessionLabel(selectedSession) : t("mobile.newSessionLabel")}</span>
              </div>
              <div className="mobile-action-sheet-header-actions">
                <button
                  type="button"
                  className={`mobile-icon-button${refreshing ? " is-refreshing" : ""}`}
                  onClick={handleRefresh}
                  aria-label={t("mobile.refreshWorkspace")}
                >
                  <IconRefresh size={22} stroke={1.8} aria-hidden="true" />
                </button>
                <button type="button" className="mobile-icon-button" onClick={() => setMenuOpen(false)} aria-label={t("mobile.closeMenu")}>
                  <IconX size={22} stroke={1.8} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="mobile-action-grid">
              <button type="button" onClick={() => { setMenuOpen(false); onOpenWorkspace(); }}>
                <IconFolder size={21} stroke={1.7} aria-hidden="true" />
                <span>{t("mobile.projectsSessions")}</span>
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); onOpenFiles(); }}>
                <IconFileText size={21} stroke={1.7} aria-hidden="true" />
                <span>{t("mobile.browseFiles")}</span>
              </button>
              <button type="button" disabled={!selectedSession} onClick={() => { setMenuOpen(false); onViewHistory(); }}>
                <IconHistory size={21} stroke={1.7} aria-hidden="true" />
                <span>{t("history.full")}</span>
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); onToggleTheme(); }}>
                {isDark ? <IconSun size={21} stroke={1.7} aria-hidden="true" /> : <IconMoon size={21} stroke={1.7} aria-hidden="true" />}
                <span>{isDark ? t("mobile.lightTheme") : t("mobile.darkTheme")}</span>
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); onShowUtilities(); }}>
                <IconAdjustmentsHorizontal size={21} stroke={1.7} aria-hidden="true" />
                <span>{t("mobile.sessionControls")}</span>
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); onOpenModels(); }}>
                <IconCpu size={21} stroke={1.7} aria-hidden="true" />
                <span>{t("common.models")}</span>
              </button>
              <button type="button" disabled={!settingsAvailable} onClick={() => { setMenuOpen(false); onOpenSkills(); }}>
                <IconLayersLinked size={21} stroke={1.7} aria-hidden="true" />
                <span>{t("common.skills")}</span>
              </button>
              <button type="button" disabled={!settingsAvailable} onClick={() => { setMenuOpen(false); onOpenPlugins(); }}>
                <IconPlug size={21} stroke={1.7} aria-hidden="true" />
                <span>{t("common.plugins")}</span>
              </button>
              <button type="button" disabled={!settingsAvailable} onClick={() => { setMenuOpen(false); onOpenExtensions(); }}>
                <IconAdjustmentsHorizontal size={21} stroke={1.7} aria-hidden="true" />
                <span>{t("mobile.extensions")}</span>
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); onRunSelfCheck(); }}>
                <IconSettings size={21} stroke={1.7} aria-hidden="true" />
                <span>{t("mobile.selfCheck")}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
