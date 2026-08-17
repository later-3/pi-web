import { NextResponse } from "next/server";
import { getPiSourcePublicInfo } from "@/lib/pi-source-runtime";

/**
 * Lightweight readiness probe.
 *
 * Returns non-sensitive status suitable for load-balancer and SSH-relay
 * health checks.  No session data, no user content, no provider keys.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "pi-web",
      piSource: getPiSourcePublicInfo(),
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
