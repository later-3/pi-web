import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { listExtensions, toggleExtension } from "@/lib/extensions-service";
import { setSessionExtensionDisabled } from "@/lib/session-extension-config";

export const dynamic = "force-dynamic";

type SessionAction = "session_enable" | "session_disable";

function isSessionAction(a: unknown): a is SessionAction {
  return a === "session_enable" || a === "session_disable";
}

// GET /api/extensions?cwd=<path>[&sessionId=<id>]
// Lists every extension pi would load plus per-session disabled flags (when
// sessionId is provided).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  const sessionId = searchParams.get("sessionId") ?? undefined;

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(await listExtensions(cwd, sessionId));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/extensions  body: { action, path, cwd, sessionId? }
//   action: "enable" | "disable"             -> global toggle (rename .ts <-> .ts.disabled)
//   action: "session_enable" | "session_disable" -> per-session override (requires sessionId)
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: string;
      path?: string;
      cwd?: string;
      sessionId?: string;
    };
    if (!body.cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!body.action) return NextResponse.json({ error: "action required" }, { status: 400 });
    if (!body.path) return NextResponse.json({ error: "path required" }, { status: 400 });

    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(body.cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (isSessionAction(body.action)) {
      if (!body.sessionId) {
        return NextResponse.json(
          { error: "sessionId required for per-session toggle" },
          { status: 400 },
        );
      }
      setSessionExtensionDisabled(body.sessionId, body.path, body.action === "session_disable");
    } else if (body.action === "enable" || body.action === "disable") {
      toggleExtension(body.path, body.action === "enable", body.cwd);
    } else {
      return NextResponse.json({ error: `Unsupported action: ${body.action}` }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      ...(await listExtensions(body.cwd, body.sessionId)),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
