export const DEVICE_DIRECTORY_VERSION = 1;
export const MAX_DEVICE_COUNT = 32;
export const MAX_DEVICE_ID_LENGTH = 64;
export const MAX_DEVICE_NAME_LENGTH = 80;

const DEVICE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export interface DeviceDescriptor {
  id: string;
  name: string;
  url: string;
}

export interface DeviceDirectoryDiagnostic {
  code: string;
  message: string;
}

export interface DeviceDirectoryResponse {
  version: typeof DEVICE_DIRECTORY_VERSION;
  currentDeviceId: string;
  devices: DeviceDescriptor[];
  diagnostics: DeviceDirectoryDiagnostic[];
}

interface DeviceValidationResult {
  device?: DeviceDescriptor;
  diagnostic?: DeviceDirectoryDiagnostic;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function diagnostic(code: string, message: string): DeviceDirectoryDiagnostic {
  return { code, message };
}

function normalizeDeviceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function validateDevice(value: unknown, label: string): DeviceValidationResult {
  if (!isRecord(value)) {
    return { diagnostic: diagnostic("invalid-device", `${label} must be an object`) };
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id || id.length > MAX_DEVICE_ID_LENGTH || !DEVICE_ID_PATTERN.test(id)) {
    return {
      diagnostic: diagnostic(
        "invalid-device-id",
        `${label}.id must be a lowercase slug of 1-${MAX_DEVICE_ID_LENGTH} characters`,
      ),
    };
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > MAX_DEVICE_NAME_LENGTH || /\p{Cc}/u.test(name)) {
    return {
      diagnostic: diagnostic(
        "invalid-device-name",
        `${label}.name must contain 1-${MAX_DEVICE_NAME_LENGTH} characters`,
      ),
    };
  }

  const url = normalizeDeviceUrl(value.url);
  if (!url) {
    return {
      diagnostic: diagnostic(
        "invalid-device-url",
        `${label}.url must be a root http(s) origin without credentials, query, or fragment`,
      ),
    };
  }

  return { device: { id, name, url } };
}

function fallbackCurrentDevice(fallbackUrl: string): DeviceDescriptor {
  return {
    id: "local",
    name: "Pi Web",
    url: normalizeDeviceUrl(fallbackUrl) ?? "http://127.0.0.1:30141",
  };
}

/**
 * Validates and combines the configured directory with the current device.
 * Invalid remote entries never make the current Pi Web instance unusable.
 */
export function buildDeviceDirectory(
  input: unknown,
  currentInput: unknown,
  fallbackUrl: string,
): DeviceDirectoryResponse {
  const diagnostics: DeviceDirectoryDiagnostic[] = [];
  const currentResult = validateDevice(currentInput, "currentDevice");
  const currentDevice = currentResult.device ?? fallbackCurrentDevice(fallbackUrl);
  if (currentResult.diagnostic) diagnostics.push(currentResult.diagnostic);

  if (input === undefined || input === null) {
    return {
      version: DEVICE_DIRECTORY_VERSION,
      currentDeviceId: currentDevice.id,
      devices: [currentDevice],
      diagnostics,
    };
  }

  if (!isRecord(input)) {
    diagnostics.push(diagnostic("invalid-directory", "Device directory must be an object"));
    return {
      version: DEVICE_DIRECTORY_VERSION,
      currentDeviceId: currentDevice.id,
      devices: [currentDevice],
      diagnostics,
    };
  }

  if (input.version !== DEVICE_DIRECTORY_VERSION) {
    diagnostics.push(diagnostic(
      "unsupported-directory-version",
      `Device directory version must be ${DEVICE_DIRECTORY_VERSION}`,
    ));
    return {
      version: DEVICE_DIRECTORY_VERSION,
      currentDeviceId: currentDevice.id,
      devices: [currentDevice],
      diagnostics,
    };
  }

  if (!Array.isArray(input.devices)) {
    diagnostics.push(diagnostic("invalid-device-list", "Device directory devices must be an array"));
    return {
      version: DEVICE_DIRECTORY_VERSION,
      currentDeviceId: currentDevice.id,
      devices: [currentDevice],
      diagnostics,
    };
  }

  if (input.devices.length > MAX_DEVICE_COUNT) {
    diagnostics.push(diagnostic(
      "device-limit-exceeded",
      `Only the first ${MAX_DEVICE_COUNT} configured devices were considered`,
    ));
  }

  const devices: DeviceDescriptor[] = [];
  const ids = new Set<string>();
  const urls = new Set<string>();

  for (const [index, rawDevice] of input.devices.slice(0, MAX_DEVICE_COUNT).entries()) {
    const result = validateDevice(rawDevice, `devices[${index}]`);
    if (!result.device) {
      if (result.diagnostic) diagnostics.push(result.diagnostic);
      continue;
    }

    if (result.device.id === currentDevice.id) continue;
    if (result.device.url === currentDevice.url) {
      diagnostics.push(diagnostic(
        "duplicate-current-device-url",
        `devices[${index}] duplicates the current device URL`,
      ));
      continue;
    }
    if (ids.has(result.device.id)) {
      diagnostics.push(diagnostic("duplicate-device-id", `devices[${index}] has a duplicate id`));
      continue;
    }
    if (urls.has(result.device.url)) {
      diagnostics.push(diagnostic("duplicate-device-url", `devices[${index}] has a duplicate URL`));
      continue;
    }

    ids.add(result.device.id);
    urls.add(result.device.url);
    devices.push(result.device);
  }

  return {
    version: DEVICE_DIRECTORY_VERSION,
    currentDeviceId: currentDevice.id,
    devices: [currentDevice, ...devices],
    diagnostics,
  };
}

export function isDeviceDirectoryResponse(value: unknown): value is DeviceDirectoryResponse {
  if (!isRecord(value) || value.version !== DEVICE_DIRECTORY_VERSION) return false;
  if (
    typeof value.currentDeviceId !== "string"
    || !Array.isArray(value.devices)
    || value.devices.length < 1
    || value.devices.length > MAX_DEVICE_COUNT + 1
    || !Array.isArray(value.diagnostics)
  ) return false;

  const devices = value.devices.flatMap((device, index) => {
    const result = validateDevice(device, `devices[${index}]`);
    return result.device ? [result.device] : [];
  });
  if (devices.length !== value.devices.length) return false;
  if (!devices.some((device) => device.id === value.currentDeviceId)) return false;

  return value.diagnostics.every((item) => (
    isRecord(item) && typeof item.code === "string" && typeof item.message === "string"
  ));
}
