"use client";
import { useState } from "react";

type Source = { title: string; url: string };

export default function Page() {
  const [q, setQ] = useState("Gartland type II supracondylar humerus fracture — what should I know?");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bullets, setBullets] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);

  async function ask() {
    try {
      setLoading(true);
      setErr(null);
      setBullets([]);
      setSources([]);

      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error || "Failed to get answer");
      }
      setBullets(json.bullets || []);
      setSources(json.sources || []);
    } catch (e: any) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 880, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ margin: 0, fontSize: 32 }}>Project Devi</h1>
      <p style={{ color: "#555" }}>Minimal medical query UI</p>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask a medical question..."
          style={{
            flex: 1,
            padding: "12px 14px",
            border: "1px solid #ddd",
            borderRadius: 10,
            outline: "none",
            fontSize: 16,
            background: "#fff",
          }}
        />
        <button
          onClick={ask}
          disabled={loading}
          style={{
            padding: "12px 18px",
            background: "black",
            color: "white",
            borderRadius: 10,
            border: "none",
            fontWeight: 600,
            cursor: "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>

      {err && (
        <p style={{ color: "crimson", marginTop: 16 }}>
          {err}
        </p>
      )}

      {(bullets.length > 0 || sources.length > 0) && (
        <div
          style={{
            marginTop: 24,
            padding: 18,
            border: "1px solid #e5e5e5",
            borderRadius: 12,
            background: "#fff",
          }}
        >
          {bullets.length > 0 && (
            <>
              <h2 style={{ marginTop: 0 }}>Answer</h2>
              <ul style={{ lineHeight: 1.6 }}>
                {bullets.map((b, i) => (
                  <li key={i} dangerouslySetInnerHTML={{ __html: b }} />
                ))}
              </ul>
            </>
          )}

          {sources.length > 0 && (
            <>
              <h3 style={{ marginTop: 24 }}>Sources</h3>
              <ol style={{ paddingLeft: 18 }}>
                {sources.map((s, i) => (
                  <li key={i} style={{ marginBottom: 8 }}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </main>
  );
}
