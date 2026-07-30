import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { loadDeviceDirectory } from "@/lib/device-directory";
import { getExternalRequestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const directory = await loadDeviceDirectory({
    requestOrigin: getExternalRequestOrigin(request),
  });

  return NextResponse.json(directory, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
