"use client";

import { useState } from "react";

type Source = { id: number; title: string; url: string; excerpt?: string };

export default function Page() {
  const [q, setQ] = useState("Gartland type II supracondylar humerus fracture — what should I know?");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bullets, setBullets] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);

  async function ask() {
    setLoading(true);
    setErr(null);
    setBullets([]);
    setSources([]);
    try {
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Request failed");
      setBullets(data.bullets || []);
      setSources(data.sources || []);
    } catch (e: any) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 820, margin: "40px auto", padding: 16 }}>
      <h1 style={{ margin: 0, fontSize: 32 }}>Project Devi</h1>
      <p style={{ color: "#666" }}>Minimal medical query UI</p>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask a medical question…"
          style={{
            flex: 1,
            padding: "14px 16px",
            fontSize: 16,
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "#fff",
            outline: "none"
          }}
        />
        <button
          onClick={ask}
          disabled={loading || q.trim().length === 0}
          style={{
            padding: "14px 18px",
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            cursor: "pointer",
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>

      {err && (
        <div style={{ marginTop: 16, color: "#b00020" }}>
          <b>Error:</b> {err}
        </div>
      )}

      {bullets.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 8 }}>Answer</h3>
          <ul style={{ lineHeight: 1.6 }}>
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      )}

      {sources.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 8 }}>Sources</h3>
          <ol style={{ lineHeight: 1.6 }}>
            {sources.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
