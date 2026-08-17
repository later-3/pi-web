import { createAgentEventStream } from "@/lib/agent-event-stream";
import { isChatManagedSessionPath, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, getUnpersistedRpcSession, startRpcSession } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (req.signal.aborted) return new Response(null, { status: 204 });

  // A newly created runtime has no JSONL file until its first command. Only a
  // live id already registered by /api/agent/new may bypass the file check.
  let sessionPromise;
  const unpersisted = getUnpersistedRpcSession(id);
  if (unpersisted) {
    sessionPromise = Promise.resolve(unpersisted);
  } else {
    // Persisted sessions must pass the ownership check before a registered
    // runtime can be reused; Chat-managed transcripts are always read-only.
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    if (isChatManagedSessionPath(filePath)) {
      return new Response("Chat-managed pi sessions are read-only evidence", { status: 403 });
    }
    if (req.signal.aborted) return new Response(null, { status: 204 });

    const session = getRpcSession(id);
    if (session?.isAlive()) {
    sessionPromise = Promise.resolve(session);
    } else {
      sessionPromise = startRpcSession(id, filePath, undefined).then((result) => result.session);
    }
  }

  const stream = createAgentEventStream(req, id, sessionPromise);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
