"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProviderRequestDetail,
  ProviderRequestsResponse,
  ProviderRequestSummary,
} from "@/lib/api-types";

function shortenPath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtSize(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)} KB`;
  return `${n} B`;
}

const ROLE_COLORS: Record<string, string> = {
  system: "var(--text-dim)",
  user: "var(--accent)",
  assistant: "#16a34a",
  tool: "#d97706",
  developer: "#7c3aed",
};

function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? "var(--text-muted)";
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

function contentSummary(content: unknown): string {
  if (typeof content === "string") return truncate(content, 80);
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        const type = typeof p.type === "string" ? p.type : "";
        if (
          (type === "text" || type === "input_text" || type === "output_text") &&
          typeof p.text === "string"
        ) {
          return truncate(p.text, 80);
        }
      }
    }
    const types = content.map((p) =>
      p && typeof p === "object" && "type" in p
        ? String((p as { type: unknown }).type)
        : "?",
    );
    return `[${types.join(", ")}]`;
  }
  return "";
}

/** Parse a possibly-stringified JSON value (OpenAI tool args are strings). */
function parseMaybeJson(v: unknown): unknown {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

function JsonBlock({ value, maxHeight = 320 }: { value: unknown; maxHeight?: number }) {
  const text = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);
  return (
    <pre
      style={{
        margin: 0,
        padding: 10,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        overflow: "auto",
        maxHeight,
        fontSize: 11,
        lineHeight: 1.5,
        fontFamily: "var(--font-mono)",
        color: "var(--text-muted)",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
    >
      {text}
    </pre>
  );
}

function Collapsible({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "7px 10px",
          background: "var(--bg-panel)",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ color: "var(--text-dim)", width: 12, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {summary}
        </span>
      </button>
      {open && <div style={{ padding: 10 }}>{children}</div>}
    </div>
  );
}

function TextPart({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 600;
  const shown = expanded || !long ? text : text.slice(0, 600);
  return (
    <div style={{ minWidth: 0 }}>
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontSize: 12,
          lineHeight: 1.55,
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
          maxHeight: expanded ? "none" : long ? 180 : "none",
          overflow: expanded ? "visible" : long ? "hidden" : "visible",
        }}
      >
        {shown}
        {long && !expanded && "…"}
      </pre>
      {long && (
        <button
          onClick={() => setExpanded((e) => !e)}
          style={{
            marginTop: 4,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--accent)",
            fontSize: 11,
            padding: 0,
          }}
        >
          {expanded ? "collapse" : `expand (${text.length.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  );
}

function MessagePart({ part }: { part: unknown }) {
  const p = (part ?? {}) as Record<string, unknown>;
  const type = typeof p.type === "string" ? p.type : "unknown";
  const norm = type === "input_text" || type === "output_text" ? "text" : type;
  if (norm === "text" && typeof p.text === "string") {
    return <TextPart text={p.text} />;
  }
  if (norm === "image_url" || norm === "image" || norm === "input_image") {
    const url = (p.image_url as { url?: string } | undefined)?.url ?? (p as { url?: string }).url;
    return (
      <div style={{ fontSize: 12, color: "var(--text-dim)", fontStyle: "italic" }}>
        [image{url ? `: ${truncate(url, 60)}` : ""}]
      </div>
    );
  }
  if (norm === "tool_use" || norm === "function_call") {
    const name = (p as { name?: string }).name ?? "(unknown)";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 12, color: "#d97706", fontFamily: "var(--font-mono)" }}>
          tool_use: {name}
        </div>
        <JsonBlock value={parseMaybeJson(p.input ?? p.arguments)} maxHeight={240} />
      </div>
    );
  }
  if (norm === "tool_result" || norm === "function_call_output") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 12, color: "#d97706", fontFamily: "var(--font-mono)" }}>
          tool_result
        </div>
        <JsonBlock value={parseMaybeJson(p.content ?? p.output)} maxHeight={240} />
      </div>
    );
  }
  return <JsonBlock value={part} maxHeight={240} />;
}

function MessageView({ message }: { message: unknown }) {
  const m = (message ?? {}) as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "unknown";
  const content = m.content;
  const toolCalls = Array.isArray(m.tool_calls) ? m.tool_calls : null;

  const summary = contentSummary(content);

  return (
    <Collapsible
      defaultOpen={false}
      summary={
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              color: roleColor(role),
              fontWeight: 700,
              textTransform: "uppercase",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              flexShrink: 0,
            }}
          >
            {role}
          </span>
          {toolCalls && toolCalls.length > 0 && (
            <span style={{ fontSize: 10, color: "#d97706", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
              {toolCalls.length} tool_call{toolCalls.length === 1 ? "" : "s"}
            </span>
          )}
          <span style={{ color: "var(--text-dim)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
            {summary}
          </span>
        </span>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        {typeof content === "string" ? (
          <TextPart text={content} />
        ) : Array.isArray(content) ? (
          content.map((part, i) => <MessagePart key={i} part={part} />)
        ) : content != null ? (
          <JsonBlock value={content} />
        ) : null}
        {toolCalls?.map((tc, i) => {
          const t = (tc ?? {}) as Record<string, unknown>;
          const fn = (t.function ?? {}) as Record<string, unknown>;
          const name = typeof fn.name === "string" ? fn.name : "(unknown)";
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 12, color: "#d97706", fontFamily: "var(--font-mono)" }}>
                tool_call: {name}
              </div>
              <JsonBlock value={parseMaybeJson(fn.arguments)} maxHeight={240} />
            </div>
          );
        })}
      </div>
    </Collapsible>
  );
}

function ToolView({ tool }: { tool: unknown }) {
  const t = (tool ?? {}) as Record<string, unknown>;
  const fn = (t.function ?? t) as Record<string, unknown>;
  const name = typeof fn.name === "string" ? fn.name : "(unknown)";
  const desc = typeof fn.description === "string" ? fn.description : undefined;
  const params = fn.parameters ?? fn.input_schema;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-mono)" }}>{name}</span>
        {typeof t.type === "string" && (
          <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{t.type}</span>
        )}
      </div>
      {desc && <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{desc}</div>}
      {params != null && (
        <Collapsible summary="parameters">
          <JsonBlock value={params} maxHeight={300} />
        </Collapsible>
      )}
    </div>
  );
}

function Detail({ detail }: { detail: ProviderRequestDetail }) {
  const payload = (detail.payload ?? {}) as Record<string, unknown>;
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  const s = detail.summary;
  const roles = Object.entries(s.roles).sort((a, b) => b[1] - a[1]);

  const summaryRows: Array<[string, React.ReactNode]> = [
    ["model", s.model ?? "—"],
    ["messages", `${s.messageCount}`],
    ["tools", `${s.toolCount}`],
    ["stream", s.stream === undefined ? "—" : String(s.stream)],
    ["max tokens", s.maxTokens === undefined ? "—" : String(s.maxTokens)],
    ["reasoning effort", s.reasoningEffort ?? "—"],
  ];
  if (s.thinking != null) {
    summaryRows.push(["thinking", <JsonBlock key="t" value={s.thinking} maxHeight={120} />]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Summary</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(110px, 150px) minmax(0, 1fr)",
            gap: "7px 14px",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {summaryRows.map(([label, value]) => (
            <div key={String(label)} style={{ display: "contents" }}>
              <div style={{ color: "var(--text-dim)" }}>{label}</div>
              <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{value}</div>
            </div>
          ))}
          {roles.length > 0 && (
            <>
              <div style={{ color: "var(--text-dim)" }}>role breakdown</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {roles.map(([role, count]) => (
                  <span
                    key={role}
                    style={{
                      fontSize: 11,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "var(--bg-panel)",
                      color: roleColor(role),
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {role}: {count}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
          Messages ({messages.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {messages.map((m, i) => (
            <MessageView key={i} message={m} />
          ))}
          {messages.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>No messages in payload.</div>
          )}
        </div>
      </div>

      {tools.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
            Tools ({tools.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tools.map((t, i) => (
              <ToolView key={i} tool={t} />
            ))}
          </div>
        </div>
      )}

      <Collapsible summary="Raw JSON">
        <JsonBlock value={detail.payload} maxHeight={600} />
      </Collapsible>
    </div>
  );
}

// ── Icons ──

function IconListCollapse() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function IconListExpand() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <polyline points="14 8 18 12 14 16" />
    </svg>
  );
}

function IconFullscreen() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function IconWindow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

const headerBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  padding: 0,
  background: "none",
  border: "1px solid transparent",
  borderRadius: 5,
  color: "var(--text-muted)",
  cursor: "pointer",
  transition: "background 0.12s, color 0.12s, border-color 0.12s",
};

export function ProviderRequests({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const [list, setList] = useState<ProviderRequestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProviderRequestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/provider-requests?cwd=${encodeURIComponent(cwd)}`);
      const d = (await res.json()) as ProviderRequestsResponse & { error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      setList(d.requests ?? []);
      setSelectedFile((cur) => cur ?? (d.requests[0]?.file ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedFile) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    fetch(`/api/provider-requests?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(selectedFile)}`)
      .then(async (res) => {
        const d = (await res.json()) as ProviderRequestDetail & { error?: string };
        if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
        return d as ProviderRequestDetail;
      })
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setDetailError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, selectedFile]);

  const overlayStyle: React.CSSProperties = fullscreen
    ? {
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }
    : {
        position: "fixed",
        inset: 24,
        zIndex: 1100,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 12px 40px rgba(0,0,0,0.28)",
      };

  return (
    <>
      {/* Backdrop (window mode only) */}
      {!fullscreen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1099, background: "rgba(0,0,0,0.45)" }}
          onClick={onClose}
        />
      )}

      <div style={overlayStyle}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>
            Provider Requests
          </span>
          <code
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {shortenPath(cwd)}
          </code>

          <div style={{ flex: 1 }} />

          <button
            onClick={() => setListCollapsed((c) => !c)}
            title={listCollapsed ? "Show request list" : "Hide request list"}
            aria-label={listCollapsed ? "Show list" : "Hide list"}
            style={headerBtnStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            {listCollapsed ? <IconListExpand /> : <IconListCollapse />}
          </button>

          <button
            onClick={() => setFullscreen((f) => !f)}
            title={fullscreen ? "Window mode" : "Fullscreen"}
            aria-label={fullscreen ? "Window mode" : "Fullscreen"}
            style={headerBtnStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            {fullscreen ? <IconWindow /> : <IconFullscreen />}
          </button>

          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            style={{
              ...headerBtnStyle,
              fontSize: 18,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Left: request list */}
          {!listCollapsed && (
            <div
              style={{
                width: 260,
                flexShrink: 0,
                borderRight: "1px solid var(--border)",
                overflowY: "auto",
                background: "var(--bg-panel)",
              }}
            >
              {loading ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>
              ) : error ? (
                <div style={{ padding: 12, fontSize: 11, color: "#ef4444" }}>{error}</div>
              ) : list.length === 0 ? (
                <div style={{ padding: 12, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.7 }}>
                  No recorded provider requests yet.
                  <div style={{ marginTop: 6 }}>
                    Enable the{" "}
                    <code style={{ fontFamily: "var(--font-mono)" }}>provider-request-review</code>{" "}
                    extension and send a message.
                  </div>
                </div>
              ) : (
                list.map((r) => {
                  const isSelected = selectedFile === r.file;
                  return (
                    <button
                      key={r.file}
                      onClick={() => setSelectedFile(r.file)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        background: isSelected ? "var(--bg-selected)" : "none",
                        border: "none",
                        borderBottom: "1px solid var(--border)",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = isSelected ? "var(--bg-selected)" : "none";
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          color: isSelected ? "var(--text)" : "var(--text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.file}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                        {r.model && (
                          <span style={{ fontSize: 10, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                            {r.model}
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{r.messageCount} msg</span>
                        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{r.toolCount} tools</span>
                        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{fmtSize(r.size)}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 3 }}>
                        {fmtTime(r.mtime)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* Right: detail */}
          <div style={{ flex: 1, overflowY: "auto", minWidth: 0, padding: 16 }}>
            {detailLoading ? (
              <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>Loading payload…</div>
            ) : detailError ? (
              <div style={{ padding: 12, fontSize: 11, color: "#ef4444" }}>{detailError}</div>
            ) : detail ? (
              <Detail detail={detail} />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                {list.length > 0 ? "Select a request." : ""}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
