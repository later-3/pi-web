"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconChevronDown,
  IconDotsVertical,
  IconFileText,
  IconFolder,
  IconHistory,
  IconMoon,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconSun,
  IconX,
} from "@tabler/icons-react";
import { getFileName } from "@/lib/file-paths";
import type { DeviceDescriptor, DeviceDirectoryResponse } from "@/lib/device-directory-core";
import type { SessionInfo } from "@/lib/types";
import { MobileDeviceSwitcher } from "./MobileDeviceSwitcher";

interface Props {
  selectedSession: SessionInfo | null;
  cwd: string | null;
  rightPanelOpen: boolean;
  deviceDirectory: DeviceDirectoryResponse | null;
  onDeviceNavigate: (device: DeviceDescriptor) => void | Promise<void>;
  isDark: boolean;
  onNewSession: (cwd: string) => void;
  onOpenWorkspace: () => void;
  onRefresh: () => void;
  onToggleFiles: () => void;
  onViewHistory: () => void;
  onToggleTheme: () => void;
  onShowUtilities: () => void;
  onRunSelfCheck: () => void;
}

function sessionLabel(session: SessionInfo): string {
  const label = session.name?.trim() || session.firstMessage?.trim() || "Untitled session";
  return label.length > 28 ? `${label.slice(0, 27)}…` : label;
}

export function MobileWorkspaceHeader({
  selectedSession,
  cwd,
  rightPanelOpen,
  deviceDirectory,
  onDeviceNavigate,
  isDark,
  onNewSession,
  onOpenWorkspace,
  onRefresh,
  onToggleFiles,
  onViewHistory,
  onToggleTheme,
  onShowUtilities,
  onRunSelfCheck,
}: Props) {
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
    <section ref={shellRef} className="mobile-session-shell" aria-label="Mobile workspace navigation">
      <header className="mobile-session-header">
        <button
          type="button"
          className="mobile-project-switcher"
          onClick={onOpenWorkspace}
          aria-label={`Open project and session browser. Current project: ${projectName}`}
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
            aria-label="Create new session in current project"
          >
            <IconPlus size={23} stroke={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mobile-icon-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open mobile menu"
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
            aria-label="Close mobile menu"
          />
          <div className="mobile-action-sheet" role="dialog" aria-modal="true" aria-label="Pi Web mobile menu">
            <div className="mobile-action-sheet-header">
              <div>
                <strong>{projectName}</strong>
                <span>{selectedSession ? sessionLabel(selectedSession) : "New session"}</span>
              </div>
              <div className="mobile-action-sheet-header-actions">
                <button
                  type="button"
                  className={`mobile-icon-button${refreshing ? " is-refreshing" : ""}`}
                  onClick={handleRefresh}
                  aria-label="Refresh sessions and files"
                >
                  <IconRefresh size={22} stroke={1.8} aria-hidden="true" />
                </button>
                <button type="button" className="mobile-icon-button" onClick={() => setMenuOpen(false)} aria-label="Close menu">
                  <IconX size={22} stroke={1.8} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="mobile-action-grid">
              <button type="button" onClick={() => { setMenuOpen(false); onOpenWorkspace(); }}>
                <IconFolder size={21} stroke={1.7} aria-hidden="true" />
                <span>Projects & sessions</span>
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); onToggleFiles(); }}>
                <IconFileText size={21} stroke={1.7} aria-hidden="true" />
                <span>{rightPanelOpen ? "Close files" : "Open files"}</span>
              </button>
              <button type="button" disabled={!selectedSession} onClick={() => { setMenuOpen(false); onViewHistory(); }}>
                <IconHistory size={21} stroke={1.7} aria-hidden="true" />
                <span>Full history</span>
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); onToggleTheme(); }}>
                {isDark ? <IconSun size={21} stroke={1.7} aria-hidden="true" /> : <IconMoon size={21} stroke={1.7} aria-hidden="true" />}
                <span>{isDark ? "Light theme" : "Dark theme"}</span>
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); onShowUtilities(); }}>
                <IconAdjustmentsHorizontal size={21} stroke={1.7} aria-hidden="true" />
                <span>Session controls</span>
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); onRunSelfCheck(); }}>
                <IconSettings size={21} stroke={1.7} aria-hidden="true" />
                <span>Mobile self-check</span>
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
