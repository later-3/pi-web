import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { loadDeviceDirectory } from "@/lib/device-directory";
import { DEVICE_SELECTION_HEADER } from "@/lib/device-selection";
import { getExternalRequestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const loadedDirectory = await loadDeviceDirectory({
    requestOrigin: getExternalRequestOrigin(request),
  });
  const selectedDeviceId = request.headers.get(DEVICE_SELECTION_HEADER);
  const directory = loadedDirectory.selectionMode === "gateway"
    && selectedDeviceId
    && loadedDirectory.devices.some((device) => device.id === selectedDeviceId)
    ? { ...loadedDirectory, currentDeviceId: selectedDeviceId }
    : loadedDirectory;

  return NextResponse.json(directory, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
