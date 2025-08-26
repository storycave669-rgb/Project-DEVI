"use client";

import { useState } from "react";

type Source = { id: number; title: string; url: string };
type ApiResponse = {
  answer: string;              // Markdown with [1], [2] style citations
  sources: Source[];
  error?: string;
};

export default function Page() {
  const [q, setQ] = useState("Gartland type II supracondylar humerus fracture — what should I know?");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [answerHtml, setAnswerHtml] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);

  async function ask() {
    setLoading(true);
    setErr(null);
    setAnswerHtml(null);
    setSources([]);

    try {
      const r = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data: ApiResponse = await r.json();

      if (!r.ok || data.error) {
        throw new Error(data.error || `Request failed (${r.status})`);
      }

      setAnswerHtml(data.answer);   // already HTML (not raw markdown)
      setSources(data.sources || []);
    } catch (e: any) {
      setErr(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 880, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ margin: 0, fontSize: 36, letterSpacing: -0.5 }}>Project Devi</h1>
      <p style={{ marginTop: 8, color: "#666" }}>Minimal medical Q&amp;A with live sources.</p>

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask a medical question…"
          style={{
            flex: 1,
            padding: "14px 16px",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            outline: "none",
            fontSize: 16,
          }}
          onKeyDown={(e) => e.key === "Enter" && ask()}
        />
        <button
          onClick={ask}
          disabled={loading}
          style={{
            padding: "12px 18px",
            borderRadius: 12,
            border: "1px solid #111827",
            background: "#111827",
            color: "white",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>

      {err && (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 12, color: "#991b1b" }}>
          {err}
        </div>
      )}

      {answerHtml && (
        <section style={{ marginTop: 22, padding: 18, border: "1px solid #e5e7eb", borderRadius: 16, background: "white" }}>
          <h2 style={{ marginTop: 0 }}>Answer</h2>

          {/* Render preformatted HTML from API (already safe/cleaned there) */}
          <div
            style={{ lineHeight: 1.6, fontSize: 16 }}
            dangerouslySetInnerHTML={{ __html: answerHtml }}
          />

          {sources?.length > 0 && (
            <>
              <h3 style={{ marginTop: 22 }}>Sources</h3>
              <ol style={{ paddingLeft: 18, marginTop: 8 }}>
                {sources.map((s) => (
                  <li key={s.id} style={{ marginBottom: 8 }}>
                    <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "#0ea5e9", textDecoration: "underline" }}>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}
    </main>
  );
}
