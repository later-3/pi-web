import { readFile, stat } from "node:fs/promises";
import {
  buildDeviceDirectory,
  type DeviceDirectoryDiagnostic,
  type DeviceDirectoryResponse,
} from "./device-directory-core";

export const MAX_DEVICE_DIRECTORY_BYTES = 64 * 1024;

interface CachedDirectoryFile {
  path: string;
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  value: unknown;
}

interface LoadDeviceDirectoryOptions {
  requestOrigin: string;
  env?: NodeJS.ProcessEnv;
}

declare global {
  var __piDeviceDirectoryFileCache: CachedDirectoryFile | undefined;
}

function fileDiagnostic(code: string, message: string): DeviceDirectoryDiagnostic {
  return { code, message };
}

async function loadDirectoryFile(filePath: string): Promise<{
  value?: unknown;
  diagnostics: DeviceDirectoryDiagnostic[];
}> {
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      return {
        diagnostics: [fileDiagnostic("device-file-not-regular", "Configured device directory is not a regular file")],
      };
    }
    if (metadata.size > MAX_DEVICE_DIRECTORY_BYTES) {
      return {
        diagnostics: [fileDiagnostic("device-file-too-large", "Configured device directory exceeds 64 KiB")],
      };
    }

    const cached = globalThis.__piDeviceDirectoryFileCache;
    if (
      cached
      && cached.path === filePath
      && cached.mtimeMs === metadata.mtimeMs
      && cached.ctimeMs === metadata.ctimeMs
      && cached.size === metadata.size
    ) {
      return { value: cached.value, diagnostics: [] };
    }

    const source = await readFile(filePath, "utf8");
    const value: unknown = JSON.parse(source);
    globalThis.__piDeviceDirectoryFileCache = {
      path: filePath,
      mtimeMs: metadata.mtimeMs,
      ctimeMs: metadata.ctimeMs,
      size: metadata.size,
      value,
    };
    return { value, diagnostics: [] };
  } catch (error) {
    const code = isNodeError(error) && error.code === "ENOENT"
      ? "device-file-missing"
      : "device-file-invalid";
    return {
      diagnostics: [fileDiagnostic(code, "Configured device directory could not be loaded")],
    };
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/** Loads the non-sensitive device directory without exposing its filesystem path. */
export async function loadDeviceDirectory({
  requestOrigin,
  env = process.env,
}: LoadDeviceDirectoryOptions): Promise<DeviceDirectoryResponse> {
  const filePath = env.PI_WEB_DEVICES_FILE?.trim();
  const file = filePath
    ? await loadDirectoryFile(filePath)
    : { value: undefined, diagnostics: [] };

  const directory = buildDeviceDirectory(
    file.value,
    {
      id: env.PI_WEB_DEVICE_ID?.trim() || "local",
      name: env.PI_WEB_DEVICE_NAME?.trim() || "Pi Web",
      url: env.PI_WEB_PUBLIC_URL?.trim() || requestOrigin,
    },
    requestOrigin,
  );

  return {
    ...directory,
    diagnostics: [...file.diagnostics, ...directory.diagnostics],
  };
}
