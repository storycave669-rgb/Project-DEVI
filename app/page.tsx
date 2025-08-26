"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type TavilySource = {
  id: number;
  title: string;
  url: string;
  excerpt?: string;
};

type ApiResponse = {
  answer: string;
  sources: TavilySource[];
  raw?: any;
  error?: string;
};

function linkifyCitations(text: string, maxN: number) {
  // Replace [1], [2] ... with anchors to #src-1 etc.
  return text.replace(/\[(\d+)\]/g, (_, nStr) => {
    const n = Number(nStr);
    if (!Number.isFinite(n) || n < 1 || (maxN && n > maxN)) return `[${nStr}]`;
    return `<a href="#src-${n}" style="text-decoration:none;"><sup>[${n}]</sup></a>`;
  });
}

export default function Page() {
  const [q, setQ] = useState("Gartland type II supracondylar humerus fracture — what should I know?");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string>("");
  const [sources, setSources] = useState<TavilySource[]>([]);

  async function ask() {
    setLoading(true);
    setErr(null);
    setAnswer("");
    setSources([]);

    try {
      const r = await fetch("/api/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data: ApiResponse = await r.json();
      if (!r.ok || data.error) {
        throw new Error(data.error || `HTTP ${r.status}`);
      }

      // Linkify in-text [n] citations to the sources list
      const linked = linkifyCitations(data.answer || "", (data.sources || []).length);
      setAnswer(linked);
      setSources(data.sources || []);
    } catch (e: any) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 820, margin: "40px auto", padding: "0 16px" }}>
      {/* Header */}
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, letterSpacing: -0.2 }}>Project Devi</h1>
        <p style={{ margin: "6px 0 0 0", color: "#666" }}>
          Minimal medical Q&A with live sources.
        </p>
      </header>

      {/* Query bar */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          padding: 12,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask a medical question…"
          style={{
            flex: 1,
            fontSize: 16,
            border: "none",
            outline: "none",
            padding: "6px 4px",
            background: "transparent",
          }}
        />
        <button
          onClick={ask}
          disabled={loading || !q.trim()}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: "1px solid #0ea5e9",
            background: loading ? "#bae6fd" : "#0ea5e9",
            color: "#fff",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>

      {/* Error */}
      {err && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 10,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
          }}
        >
          {err}
        </div>
      )}

      {/* Answer */}
      {answer && (
        <section
          style={{
            marginTop: 24,
            padding: "18px 20px",
            borderRadius: 12,
            background: "#fff",
            border: "1px solid #e5e7eb",
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 20 }}>Answer</h2>

          {/* Render Markdown cleanly; allow our linkified [n] with HTML */}
          <div style={{ lineHeight: 1.6, fontSize: 16 }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                strong: ({ children }) => (
                  <strong style={{ fontWeight: 700 }}>{children}</strong>
                ),
                li: ({ children }) => <li style={{ margin: "6px 0" }}>{children}</li>,
                p: ({ children }) => <p style={{ margin: "10px 0" }}>{children}</p>,
                h3: ({ children }) => (
                  <h3 style={{ fontSize: 18, margin: "16px 0 8px 0" }}>{children}</h3>
                ),
              }}
            >
              {/* We allow a tiny snippet of HTML for the linked citations */}
              {answer}
            </ReactMarkdown>
          </div>
        </section>
      )}

      {/* Sources */}
      {sources.length > 0 && (
        <section
          style={{
            marginTop: 16,
            padding: "18px 20px",
            borderRadius: 12,
            background: "#fff",
            border: "1px solid #e5e7eb",
          }}
        >
          <h3 style={{ marginTop: 0, fontSize: 18 }}>Sources</h3>
          <ol style={{ paddingLeft: 18, margin: 0 }}>
            {sources.map((s) => (
              <li key={s.id} id={`src-${s.id}`} style={{ margin: "8px 0" }}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#0ea5e9", textDecoration: "underline" }}
                  title={s.url}
                >
                  {s.title}
                </a>
                {s.excerpt ? (
                  <div style={{ color: "#6b7280", fontSize: 14, marginTop: 4 }}>
                    {s.excerpt}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
