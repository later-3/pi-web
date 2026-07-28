import { NextResponse } from "next/server";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";

export const dynamic = "force-dynamic";

function isSafeFileName(file: string): boolean {
  return (
    file.endsWith(".json") &&
    !file.includes("/") &&
    !file.includes("\\") &&
    !file.includes("..")
  );
}

function summarizePayload(payload: unknown) {
  const p = (payload ?? {}) as Record<string, unknown>;
  const messages = Array.isArray(p.messages) ? p.messages : [];
  const roles: Record<string, number> = {};
  for (const m of messages) {
    const role = typeof m === "object" && m !== null && "role" in m
      ? String((m as { role: unknown }).role)
      : "unknown";
    roles[role] = (roles[role] ?? 0) + 1;
  }
  return {
    model: typeof p.model === "string" ? p.model : undefined,
    messageCount: messages.length,
    toolCount: Array.isArray(p.tools) ? p.tools.length : 0,
    maxTokens: p.max_completion_tokens ?? p.max_tokens,
    reasoningEffort: typeof p.reasoning_effort === "string" ? p.reasoning_effort : undefined,
    thinking: p.thinking,
    stream: typeof p.stream === "boolean" ? p.stream : undefined,
    roles,
  };
}

// GET /api/provider-requests?cwd=<path>            -> list
// GET /api/provider-requests?cwd=<path>&file=<f>   -> single payload + summary
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const dir = join(cwd, CONFIG_DIR_NAME, "provider-requests");
  const file = searchParams.get("file");

  if (file) {
    if (!isSafeFileName(file)) {
      return NextResponse.json({ error: "invalid file name" }, { status: 400 });
    }
    const path = join(dir, file);
    if (!existsSync(path)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    try {
      const payload = JSON.parse(readFileSync(path, "utf8"));
      return NextResponse.json({
        file,
        path,
        payload,
        summary: summarizePayload(payload),
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
  }

  // List mode
  if (!existsSync(dir)) {
    return NextResponse.json({ requests: [], dir });
  }
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((e) => e.endsWith(".json"));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }

  const requests = entries
    .map((f) => {
      const path = join(dir, f);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        return null;
      }
      let model: string | undefined;
      let messageCount = 0;
      let toolCount = 0;
      try {
        const payload = JSON.parse(readFileSync(path, "utf8"));
        const summary = summarizePayload(payload);
        model = summary.model;
        messageCount = summary.messageCount;
        toolCount = summary.toolCount;
      } catch {
        // unreadable file - still list with zeroed counts
      }
      return {
        file: f,
        path,
        mtime: stat.mtimeMs,
        size: stat.size,
        model,
        messageCount,
        toolCount,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.mtime - a.mtime);

  return NextResponse.json({ requests, dir });
}
