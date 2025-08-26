"use client";

import { useState, useRef, FormEvent } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function Page() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Hi! Ask a medical question to get a structured answer with citations." },
  ]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const prompt = q.trim();
    if (!prompt || loading) return;

    // push user message
    setMessages((m) => [...m, { role: "user", content: prompt }]);
    setQ("");
    setLoading(true);

    try {
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: prompt }),
      });

      if (!res.ok) {
        // Demo fallback until API exists
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              "⚠️ API not connected yet. (Demo) Here’s how results will look:\n\n" +
              "• Summary: Key points in 4–6 bullets\n" +
              "• If Ortho/Trauma: Classification, risks, assoc. injuries, management\n" +
              "• If Radiology: Findings, differentials, sample report\n" +
              "• If Emergency: Triage, immediate actions, disposition\n" +
              "• Sources: PubMed, Radiopaedia, guidelines (numbered, clickable)",
          },
        ]);
      } else {
        const data = await res.json();
        // Accept either {text} or {answer: {text}} shapes
        const text = data?.text ?? data?.answer?.text ?? JSON.stringify(data, null, 2);
        setMessages((m) => [...m, { role: "assistant", content: text }]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "❌ Network error. We’ll fix after wiring the API." },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.brandDot} />
        <div>
          <div style={styles.title}>Project Devi</div>
          <div style={styles.subtitle}>Minimal medical query UI</div>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.messages}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                ...styles.bubble,
                ...(m.role === "user" ? styles.userBubble : styles.assistantBubble),
              }}
            >
              {m.content.split("\n").map((line, idx) => (
                <p key={idx} style={{ margin: "6px 0" }}>
                  {line}
                </p>
              ))}
            </div>
          ))}
          {loading && <div style={{ ...styles.bubble, ...styles.assistantBubble }}>Thinking…</div>}
        </div>
      </main>

      <form onSubmit={onSubmit} style={styles.inputBar}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask a question… e.g., 'Gartland type 2 supracondylar humerus fracture — what should I know?'"
          style={styles.input}
        />
        <button type="submit" disabled={loading || !q.trim()} style={styles.button}>
          Ask
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, any> = {
  page: { minHeight: "100vh", background: "#fafafa", color: "#111", display: "flex", flexDirection: "column" },
  header: { display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid #eee" },
  brandDot: { width: 10, height: 10, borderRadius: 999, background: "#111" },
  title: { fontSize: 18, fontWeight: 600 },
  subtitle: { fontSize: 12, color: "#666" },
  main: { flex: 1, display: "flex", justifyContent: "center" },
  messages: { width: "100%", maxWidth: 820, padding: "20px 16px", display: "flex", flexDirection: "column", gap: 10 },
  bubble: { borderRadius: 14, padding: "10px 14px", lineHeight: 1.5, fontSize: 15 },
  userBubble: { alignSelf: "flex-end", background: "#111", color: "white" },
  assistantBubble: { alignSelf: "flex-start", background: "white", border: "1px solid #eee" },
  inputBar: {
    position: "sticky",
    bottom: 0,
    display: "flex",
    gap: 8,
    padding: 12,
    borderTop: "1px solid #eee",
    background: "rgba(250,250,250,0.9)",
    backdropFilter: "saturate(180%) blur(8px)",
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    border: "1px solid #e5e5e5",
    padding: "0 12px",
    outline: "none",
    fontSize: 15,
    background: "white",
  },
  button: {
    height: 44,
    padding: "0 16px",
    borderRadius: 10,
    border: "1px solid #111",
    background: "#111",
    color: "white",
    fontWeight: 600,
  },
};
