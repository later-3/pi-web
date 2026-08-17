import { NextResponse } from "next/server";
import { isChatManagedSessionPath, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, getUnpersistedRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { getWebAuthSubject } from "@/lib/web-auth";

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let commandType: string | undefined;
  let promptAccepted = false;

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };
    commandType = typeof body.type === "string" ? body.type : undefined;
    const notificationAccount = body.type === "prompt" ? getWebAuthSubject(req) : null;

    // A new SessionManager does not create its JSONL file until the first
    // command is persisted. The runtime id is nevertheless registered by the
    // server and is the only safe authority during that pre-persistence gap.
    const unpersisted = getUnpersistedRpcSession(id);
    if (unpersisted) {
      if (notificationAccount) unpersisted.setNotificationAudience(notificationAccount);
      const result = await unpersisted.send(body);
      promptAccepted = body.type === "prompt";
      return NextResponse.json({ success: true, data: result });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({
        error: "Session not found",
        ...(body.type === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 404 });
    }
    if (isChatManagedSessionPath(filePath)) {
      return NextResponse.json(
        { error: "Chat-managed pi sessions are read-only evidence" },
        { status: 403 },
      );
    }

    // Persisted sessions still require the server-side ownership check above.
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      if (notificationAccount) existing.setNotificationAudience(notificationAccount);
      const result = await existing.send(body);
      promptAccepted = body.type === "prompt";
      return NextResponse.json({ success: true, data: result });
    }

    const { session } = await startRpcSession(id, filePath, undefined);
    if (notificationAccount) session.setNotificationAudience(notificationAccount);
    const result = await session.send(body);
    promptAccepted = body.type === "prompt";

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(commandType === "prompt" && !promptAccepted
        ? { code: "prompt_rejected", accepted: false }
        : {}),
    }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
