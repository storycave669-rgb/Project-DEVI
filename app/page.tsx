"use client";

import React, { useEffect, useMemo, useState } from "react";

type Mode = "radiology" | "emergency" | "ortho";
type Source = { id: number; title: string; url: string };
type ApiResp = { answer: string; sources: Source[]; mode?: Mode; error?: string };

type HistoryItem = {
  id: string;
  q: string;
  mode: Mode | "auto" | undefined;
  answerHtml: string;
  sources: Source[];
  ts: number;
};

const MAX_HISTORY = 10;

function defaultFollowUps(mode: Mode | "auto" | undefined, q: string): string[] {
  const s = (mode ?? "auto");
  if (s === "radiology") {
    return [
      "What are the classic signs and measurements to report?",
      "Give a one-line impression including urgency/next step.",
      "Top differentials and how to distinguish them?",
      "Report template (Indication, Technique, Findings, Impression)?",
    ];
  }
  if (s === "emergency") {
    return [
      "Immediate red flags and resus indications?",
      "Stepwise ABCDE with drug/dose examples?",
      "When to reduce/splint and when to call ortho?",
      "Disposition criteria and review window?",
    ];
  }
  // ortho default
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
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // load history
  useEffect(() => {
    try {
      const raw = localStorage.getItem("devihist");
      if (raw) setHistory(JSON.parse(raw));
    } catch {}
  }, []);

  // save history
  useEffect(() => {
    try {
      localStorage.setItem("devihist", JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch {}
  }, [history]);

  async function ask(text?: string, override?: "auto" | Mode) {
    const question = (text ?? q).trim();
    if (!question) return;

    setLoading(true);
    setHtml("");
    setSources([]);
    setServerMode(undefined);

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

    if (!r.ok || data.error) {
      setHtml(`<div style="color:#b00">${data.error || "Something went wrong."}</div>`);
      return;
    }
    setHtml(data.answer || "");
    setSources(data.sources || []);
    setServerMode(data.mode);

    // push to history (front)
    const item: HistoryItem = {
      id: String(Date.now()),
      q: question,
      mode: chosen,
      answerHtml: data.answer || "",
      sources: data.sources || [],
      ts: Date.now(),
    };
    setHistory(prev => [item, ...prev].slice(0, MAX_HISTORY));
  }

  function copyAnswer() {
    const plain = html.replace(/<[^>]+>/g, "").trim();
    navigator.clipboard.writeText(plain);
  }

  const followups = useMemo(() => defaultFollowUps(serverMode ?? mode, q), [serverMode, mode, q]);

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: "0 20px" }}>
      <header style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 34, margin: 0 }}>Project Devi</h1>
        <div style={{ color: "#667085", marginTop: 4 }}>Structured medical answers with live sources.</div>
      </header>

      {/* Query row */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask a question (e.g., Gartland II supracondylar fracture)…"
          onKeyDown={(e) => e.key === "Enter" && ask()}
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
          disabled={loading}
          style={{
            padding: "12px 18px",
            borderRadius: 10,
            background: "#111827",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
            minWidth: 88,
          }}
        >
          {loading ? "Asking…" : "Ask"}
        </button>
      </div>

      {/* Suggestions */}
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
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
              >
                Mode: {serverMode}
              </span>
            )}
          </div>
          <button
            onClick={copyAnswer}
            style={{
              fontSize: 12,
              border: "1px solid #e5e7eb",
              background: "#fff",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            Copy
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

        {/* Sources */}
        {!loading && sources.length > 0 && (
          <div style={{ padding: 16, borderTop: "1px solid #f3f4f6" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Sources</div>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {sources.map((s) => (
                <li key={s.id} style={{ margin: "6px 0" }}>
                  <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "#0a66c2" }}>
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
