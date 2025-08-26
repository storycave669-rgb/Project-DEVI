"use client";

import { useState } from "react";

type Source = { title: string; url: string; snippet?: string };

function renderInlineMarkdown(s: string) {
  // **bold**
  const withBold = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // [text](url)
  const withLinks = withBold.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
  );
  return withLinks;
}

export default function Page() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [bullets, setBullets] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function ask() {
    setLoading(true);
    setErr(null);
    setBullets([]);
    setSources([]);

    try {
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Request failed: ${res.status}`);
      }

      const data = (await res.json()) as {
        bullets: string[];
        sources?: Source[];
      };

      setBullets(data.bullets || []);
      setSources(data.sources || []);
    } catch (e: any) {
      setErr(e?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 820,
        margin: "40px auto",
        background: "#fff",
        padding: 24,
        border: "1px solid #e5e5e5",
        borderRadius: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 24 }}>Project Devi</h1>
      <p style={{ marginTop: 8, color: "#666" }}>
        Minimal medical Q&amp;A. Auto-formats Ortho / Radiology / Emergency
        questions into concise bullets with sources.
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask anything… e.g., Gartland type II supracondylar humerus fracture — what should I know?"
          style={{
            flex: 1,
            padding: "12px 14px",
            border: "1px solid #ddd",
            borderRadius: 10,
            outline: "none",
            fontSize: 15,
            background: "#fbfbfb",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask();
          }}
        />
        <button
          onClick={ask}
          disabled={loading || !q.trim()}
          style={{
            padding: "12px 18px",
            borderRadius: 10,
            border: "1px solid #1a73e8",
            background: loading ? "#8ab4f8" : "#1a73e8",
            color: "white",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>

      {err && (
        <p style={{ color: "crimson", marginTop: 18 }}>
          Error: {err}
        </p>
      )}

      {bullets.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 20, marginBottom: 12 }}>Answer</h2>
          <ul style={{ lineHeight: 1.6 }}>
            {bullets.map((b, i) => (
              <li
                key={i}
                dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(b) }}
              />
            ))}
          </ul>
        </section>
      )}

      {sources.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h3 style={{ fontSize: 18, marginBottom: 10 }}>Sources</h3>
          <ol style={{ lineHeight: 1.6, paddingLeft: 18 }}>
            {sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
