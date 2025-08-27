"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Mode = "radiology" | "emergency" | "ortho";
type Source = { id: number; title: string; url: string; preview?: string };
type ApiResp = {
  answer: string;
  sources: Source[];
  mode?: Mode;
  confidence?: { band: "High" | "Moderate" | "Preliminary"; pct: number };
  error?: string;
};

type HistoryItem = {
  id: string;
  q: string;
  mode: Mode | "auto" | undefined;
  answerHtml: string;
  sources: Source[];
  ts: number;
};

const MAX_HISTORY = 10;
const LS_HISTORY = "devihist";
const LS_MODE = "devimode";

/* ---------- Follow-up chips per mode ---------- */
function defaultFollowUps(mode: Mode | "auto" | undefined): string[] {
  const s = mode ?? "auto";
  if (s === "radiology") {
    return [
      "Key signs & measurements to report?",
      "One-line impression with urgency/next step.",
      "Top differentials and how to distinguish?",
      "Report format (Indication, Technique, Findings, Impression)?",
    ];
  }
  if (s === "emergency") {
    return [
      "Immediate red flags & resus indications?",
      "ABCDE steps with examples (drugs/doses)?",
      "When to reduce/splint and call ortho?",
      "Disposition criteria & review window?",
    ];
  }
  // Ortho (or Auto as default)
  return [
    "Full classification with radiographic criteria?",
    "Nerve/artery injuries to document and follow?",
    "Non-op vs pinning—clear indications?",
    "Rehab milestones and clinic follow-up timing?",
  ];
}

export default function Home() {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"auto" | Mode>("auto");
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [serverMode, setServerMode] = useState<Mode | undefined>();
  const [confidence, setConfidence] = useState<ApiResp["confidence"]>();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copied, setCopied] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  /* ---------- hydrate history + mode ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_HISTORY);
      if (raw) setHistory(JSON.parse(raw));
      const m = localStorage.getItem(LS_MODE) as "auto" | Mode | null;
      if (m) setMode(m);
    } catch {}
  }, []);

  /* ---------- persist history + mode ---------- */
  useEffect(() => {
    try {
      localStorage.setItem(LS_HISTORY, JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch {}
  }, [history]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_MODE, mode);
    } catch {}
  }, [mode]);

  /* ---------- ask API ---------- */
  async function ask(text?: string, override?: "auto" | Mode) {
    const question = (text ?? q).trim();
    if (!question) return;

    setLoading(true);
    startedAtRef.current = Date.now();
    setLatencyMs(null);
    setHtml("");
    setSources([]);
    setServerMode(undefined);
    setConfidence(undefined);

    const body: any = { question };
    const chosen = override ?? mode;
    if (chosen !== "auto") body.modeOverride = chosen;

    const r = await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await r.json()) as ApiResp;

    setLoading(false);
    if (startedAtRef.current) setLatencyMs(Date.now() - startedAtRef.current);

    if (!r.ok || data.error) {
      setHtml(`<div style="color:#b00">${data.error || "Something went wrong."}</div>`);
      return;
    }
    setHtml(data.answer || "");
    setSources(data.sources || []);
    setServerMode(data.mode);
    setConfidence(data.confidence);

    const item: HistoryItem = {
      id: String(Date.now()),
      q: question,
      mode: chosen,
      answerHtml: data.answer || "",
      sources: data.sources || [],
      ts: Date.now(),
    };
    setHistory((prev) => [item, ...prev].slice(0, MAX_HISTORY));
  }

  /* ---------- keyboard: Cmd/Ctrl+Enter ---------- */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      ask();
    }
    if (e.key === "Enter" && !e.shiftKey) {
      ask();
    }
  }

  /* ---------- copy ---------- */
  async function copyAnswer() {
    const plain = html.replace(/<[^>]+>/g, "").trim();
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    } catch {}
  }

  const followups = useMemo(() => defaultFollowUps(serverMode ?? mode), [serverMode, mode]);

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: "0 20px" }}>
      <header style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 34, margin: 0 }}>Project Devi</h1>
        <div style={{ color: "#667085", marginTop: 4 }}>Structured medical Q&amp;A with live sources.</div>
      </header>

      {/* Query row */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask a question (e.g., Gartland II supracondylar humerus fracture)…"
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoFocus
          style={{
            flex: 1,
            padding: "14px 16px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            outline: "none",
            fontSize: 16,
            background: "#fff",
          }}
        />
        <div style={{ display: "flex", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          {(["auto", "radiology", "emergency", "ortho"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "10px 12px",
                fontSize: 13,
                border: "none",
                background: mode === m ? "#111827" : "#ffffff",
                color: mode === m ? "#ffffff" : "#111827",
                cursor: "pointer",
              }}
              title={m === "auto" ? "Auto-detect template" : `Force ${m}`}
            >
              {m === "auto" ? "Auto" : m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <button
          onClick={() => ask()}
          disabled={loading || !q.trim()}
          style={{
            padding: "12px 18px",
            borderRadius: 10,
            background: loading || !q.trim() ? "#9ca3af" : "#111827",
            color: "#fff",
            border: "none",
            cursor: loading || !q.trim() ? "not-allowed" : "pointer",
            fontWeight: 600,
            minWidth: 88,
          }}
          title="Cmd/Ctrl + Enter"
        >
          {loading ? "Asking…" : "Ask"}
        </button>
      </div>

      {/* Follow-up suggestions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {followups.map((f, i) => (
          <button
            key={i}
            onClick={() => ask(f, mode)}
            style={{
              border: "1px solid #e5e7eb",
              background: "#fff",
              color: "#111827",
              padding: "8px 12px",
              fontSize: 13,
              borderRadius: 999,
              cursor: "pointer",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Answer card */}
      <section
        style={{
          marginTop: 6,
          border: "1px solid #eee",
          borderRadius: 12,
          background: "#fff",
          boxShadow: "0 3px 12px rgba(0,0,0,0.04)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #f3f4f6",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700, fontSize: 20 }}>Answer</div>
            {serverMode && (
              <span
                style={{
                  fontSize: 12,
                  padding: "3px 8px",
                  background: "#f3f4f6",
                  border: "1px solid #e5e7eb",
                  borderRadius: 999,
                }}
                title="Template used"
              >
                Mode: {serverMode}
              </span>
            )}
            {confidence && (
              <span
                style={{
                  fontSize: 12,
                  padding: "3px 8px",
                  background:
                    confidence.band === "High"
                      ? "#e8f7ed"
                      : confidence.band === "Moderate"
                      ? "#fff8e6"
                      : "#fdecec",
                  border: "1px solid #e5e7eb",
                  borderRadius: 999,
                }}
                title="Based on source quality & diversity"
              >
                Confidence: {confidence.band} ({confidence.pct}%)
              </span>
            )}
            {latencyMs !== null && (
              <span
                style={{
                  fontSize: 12,
                  padding: "3px 8px",
                  background: "#f3f4f6",
                  border: "1px solid #e5e7eb",
                  borderRadius: 999,
                }}
                title="Response time"
              >
                {Math.round(latencyMs)} ms
              </span>
            )}
          </div>
          <button
            onClick={copyAnswer}
            style={{
              fontSize: 12,
              border: "1px solid #e5e7eb",
              background: copied ? "#e8f7ed" : "#fff",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
            }}
            title="Copy plain text"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        <div style={{ padding: 16, minHeight: 120 }}>
          {loading ? (
            <div style={{ lineHeight: 1.6, color: "#6b7280" }}>
              <div style={{ height: 14, background: "#f3f4f6", marginBottom: 10, width: "82%", borderRadius: 6 }} />
              <div style={{ height: 14, background: "#f3f4f6", marginBottom: 10, width: "64%", borderRadius: 6 }} />
              <div style={{ height: 14, background: "#f3f4f6", marginBottom: 10, width: "72%", borderRadius: 6 }} />
            </div>
          ) : (
            <div className="answer" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>

        {/* Sources with hover preview */}
        {!loading && sources.length > 0 && (
          <div style={{ padding: 16, borderTop: "1px solid #f3f4f6" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Sources</div>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {sources.map((s) => (
                <li key={s.id} style={{ margin: "6px 0" }}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    title={s.preview || s.title}
                    style={{ color: "#0a66c2" }}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {/* History */}
      {history.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Recent</div>
          <div style={{ display: "grid", gap: 8 }}>
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => {
                  setQ(h.q);
                  setHtml(h.answerHtml);
                  setSources(h.sources);
                  setServerMode((h.mode as Mode) ?? undefined);
                }}
                style={{
                  textAlign: "left",
                  border: "1px solid #eee",
                  background: "#fff",
                  borderRadius: 10,
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
                title={new Date(h.ts).toLocaleString()}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>{h.q}</div>
                <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
                  Mode: {h.mode ?? "auto"} · {new Date(h.ts).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
