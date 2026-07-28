import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Per-session extension configuration for Pi Web.
 *
 * Stored in ~/.pi/agent/pi-web-config.json, keyed by session id. Each session
 * records the set of extension paths it has disabled (on top of the global
 * on/off state managed by renaming .ts <-> .ts.disabled).
 *
 * The config is read at AgentSession creation time (and on every reload) via
 * the resource loader's extensionsOverride hook, so toggling a path here +
 * reloading the session takes effect immediately for that session only.
 *
 * Kept on globalThis so it survives Next.js hot-reload.
 */

interface SessionExtensionEntry {
  disabled: string[];
}

interface PiWebConfigFile {
  sessionExtensions: Record<string, SessionExtensionEntry>;
}

declare global {
  var __piWebSessionExtConfig: PiWebConfigFile | undefined;
}

const EMPTY: PiWebConfigFile = { sessionExtensions: {} };

function configPath(): string {
  return join(getAgentDir(), "pi-web-config.json");
}

function loadConfig(): PiWebConfigFile {
  if (globalThis.__piWebSessionExtConfig) return globalThis.__piWebSessionExtConfig;
  let config: PiWebConfigFile = { sessionExtensions: {} };
  try {
    const path = configPath();
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && "sessionExtensions" in parsed) {
        config = parsed as PiWebConfigFile;
      }
    }
  } catch {
    // Corrupt or unreadable - start fresh.
  }
  globalThis.__piWebSessionExtConfig = config;
  return config;
}

function saveConfig(config: PiWebConfigFile): void {
  globalThis.__piWebSessionExtConfig = config;
  try {
    mkdirSync(getAgentDir(), { recursive: true });
    writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
  } catch {
    // Best-effort persistence; in-memory copy still serves the current process.
  }
}

/** Return the set of extension paths disabled for the given session. */
export function getDisabledExtensionsForSession(sessionId: string): Set<string> {
  const config = loadConfig();
  const entry = config.sessionExtensions[sessionId];
  return new Set(entry?.disabled ?? []);
}

/** Is `path` disabled for this session? */
export function isDisabledForSession(sessionId: string, path: string): boolean {
  return getDisabledExtensionsForSession(sessionId).has(path);
}

/** Replace the full disabled-path list for a session. */
export function setDisabledExtensionsForSession(sessionId: string, disabled: string[]): void {
  const config = loadConfig();
  if (disabled.length === 0) {
    delete config.sessionExtensions[sessionId];
  } else {
    config.sessionExtensions[sessionId] = { disabled };
  }
  saveConfig(config);
}

/** Toggle a single path for a session; returns the new disabled state. */
export function toggleSessionExtension(sessionId: string, path: string): boolean {
  const disabled = getDisabledExtensionsForSession(sessionId);
  let nowDisabled: boolean;
  if (disabled.has(path)) {
    disabled.delete(path);
    nowDisabled = false;
  } else {
    disabled.add(path);
    nowDisabled = true;
  }
  setDisabledExtensionsForSession(sessionId, [...disabled]);
  return nowDisabled;
}

/** Explicitly enable or disable a single path for a session. */
export function setSessionExtensionDisabled(sessionId: string, path: string, disabled: boolean): void {
  const set = getDisabledExtensionsForSession(sessionId);
  if (disabled) set.add(path);
  else set.delete(path);
  setDisabledExtensionsForSession(sessionId, [...set]);
}

/** Remove a session's config entry entirely (e.g. when the session is deleted). */
export function clearSessionExtensionConfig(sessionId: string): void {
  const config = loadConfig();
  if (config.sessionExtensions[sessionId]) {
    delete config.sessionExtensions[sessionId];
    saveConfig(config);
  }
}

export const _TEST_ONLY = { EMPTY, loadConfig, saveConfig, configPath };
