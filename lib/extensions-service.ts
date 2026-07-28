import {
  CONFIG_DIR_NAME,
  DefaultPackageManager,
  SettingsManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, renameSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { ExtensionInfo, ExtensionsResponse } from "@/lib/api-types";
import { isDisabledForSession } from "@/lib/session-extension-config";

/** Auto-discovered extension directories pi scans. */
function extensionScanDirs(cwd: string, agentDir: string): Array<{ dir: string; scope: "global" | "project" }> {
  return [
    { dir: join(agentDir, "extensions"), scope: "global" as const },
    { dir: join(cwd, CONFIG_DIR_NAME, "extensions"), scope: "project" as const },
  ];
}

function toDisplayScope(scope: string): "global" | "project" {
  return scope === "project" ? "project" : "global";
}

function extensionName(filePath: string): string {
  const file = basename(filePath);
  if (file === "index.ts" || file === "index.js") {
    const dir = basename(dirname(filePath));
    return dir || file;
  }
  const ext = extname(file);
  return ext ? file.slice(0, -ext.length) : file;
}

/** True if targetPath lives inside one of the auto-discovered extension dirs. */
export function isWithinExtensionDir(targetPath: string, cwd: string, agentDir: string): boolean {
  const resolved = resolve(targetPath);
  for (const { dir } of extensionScanDirs(cwd, agentDir)) {
    const resolvedDir = resolve(dir);
    if (resolved === resolvedDir) return true;
    const withSep = resolvedDir + "/";
    if (resolved.startsWith(withSep)) return true;
    const withSepWin = resolvedDir + "\\";
    if (resolved.startsWith(withSepWin)) return true;
  }
  return false;
}

/**
 * List every extension pi would load (file-level + package-level) plus any
 * file-level extension previously disabled via rename (.ts.disabled).
 */
export async function listExtensions(cwd: string, sessionId?: string): Promise<ExtensionsResponse> {
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });

  const extensions: ExtensionInfo[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  try {
    const resolved = await packageManager.resolve(async () => "skip");
    for (const r of resolved.extensions) {
      const scope = toDisplayScope(r.metadata.scope);
      const origin = r.metadata.origin === "package" ? "package" : "file";
      const canToggle = origin === "file" && /\.(ts|js)$/.test(r.path);
      extensions.push({
        path: r.path,
        name: extensionName(r.path),
        scope,
        origin,
        source: r.metadata.source,
        enabled: r.enabled,
        canToggle,
        sessionDisabled: sessionId ? isDisabledForSession(sessionId, r.path) : false,
      });
    }
  } catch (error) {
    errors.push({
      path: "<package-manager>",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Pick up extensions we disabled by renaming .ts -> .ts.disabled. These are
  // invisible to packageManager.resolve (pi only matches *.ts / */index.ts).
  const seen = new Set(extensions.map((e) => resolve(e.path)));
  for (const { dir, scope } of extensionScanDirs(cwd, agentDir)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!/\.(ts|js)\.disabled$/.test(entry)) continue;
      const disabledPath = join(dir, entry);
      if (seen.has(resolve(disabledPath))) continue;
      const enabledPath = disabledPath.replace(/\.disabled$/, "");
      extensions.push({
        path: enabledPath,
        name: extensionName(enabledPath),
        scope,
        origin: "file",
        source: "local",
        enabled: false,
        disabledPath,
        canToggle: true,
        sessionDisabled: false,
      });
    }
  }

  extensions.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    if (a.scope !== b.scope) return a.scope === "global" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { extensions, errors };
}

/**
 * Toggle a single-file extension by renaming `foo.ts` <-> `foo.ts.disabled`.
 * pi's auto-discovery only matches .ts files (and directory index.ts files),
 * so the .disabled suffix removes it from the load set without deleting it.
 */
export function toggleExtension(targetPath: string, enable: boolean, cwd: string): void {
  const agentDir = getAgentDir();
  if (!isWithinExtensionDir(targetPath, cwd, agentDir)) {
    throw new Error("Extension path is outside the allowed extension directories");
  }
  if (!/\.(ts|js)$/.test(targetPath)) {
    throw new Error("Only single .ts/.js extension files can be toggled");
  }
  const disabledPath = targetPath + ".disabled";
  if (enable) {
    if (!existsSync(disabledPath)) {
      throw new Error("Disabled extension not found: " + disabledPath);
    }
    if (existsSync(targetPath)) {
      throw new Error("An enabled extension already exists at: " + targetPath);
    }
    renameSync(disabledPath, targetPath);
  } else {
    if (!existsSync(targetPath)) {
      throw new Error("Extension not found: " + targetPath);
    }
    if (existsSync(disabledPath)) {
      throw new Error("A disabled file already exists at: " + disabledPath);
    }
    renameSync(targetPath, disabledPath);
  }
}
