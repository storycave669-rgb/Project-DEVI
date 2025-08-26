"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Section = { title: string; bullets: string[] };
type MockResult = { sections: Section[]; sources: { title: string; url: string }[] };

const mockSynthesize = (q: string): MockResult => ({
  sections: [
    { title: "Classification", bullets: ["(demo) Tailored to your query: " + q, "Use of standard grading where applicable."] },
    { title: "Key Findings", bullets: ["(demo) Core clinical & imaging points.", "Red flags highlighted clearly."] },
    { title: "Initial Management", bullets: ["(demo) ED/clinic first steps.", "When to escalate / consult."] },
    { title: "Associated Injuries / DDx", bullets: ["(demo) Common pitfalls and look-alikes.", "What to specifically rule out."] },
    { title: "Follow-up & Pearls", bullets: ["(demo) When to re-image, timelines.", "Teaching points for juniors."] },
  ],
  sources: [
    { title: "(demo) StatPearls overview", url: "https://www.ncbi.nlm.nih.gov/books/" },
    { title: "(demo) Radiopaedia topic", url: "https://radiopaedia.org/" },
    { title: "(demo) PubMed review", url: "https://pubmed.ncbi.nlm.nih.gov/" },
  ],
});

export default function Page() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: MockResult }[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep page content visible above the sticky composer
  const bottomPad = 90; // height of composer + gap

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    // mock latency
    setTimeout(() => {
      const a = mockSynthesize(q);
      setHistory((prev) => [{ q, a }, ...prev]);
      setQuery("");
      setLoading(false);
      inputRef.current?.focus();
    }, 450);
  };

  // keyboard “enter” to submit, shift+enter to newline-like behavior (we just ignore newline for input)
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      handleSubmit();
    }
  };

  // scroll to top of answers after submit so user sees result
  useEffect(() => {
    if (history.length && listRef.current) {
      listRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [history.length]);

  // subtle glass look for composer (not a copy of anyone)
  const composerStyle = useMemo<React.CSSProperties>(
    () => ({
      position: "fixed",
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 50,
      backdropFilter: "saturate(120%) blur(10px)",
      WebkitBackdropFilter: "saturate(120%) blur(10px)",
      background: "rgba(255,255,255,0.75)",
      borderTop: "1px solid rgba(0,0,0,0.06)",
    }),
    []
  );

  return (
    <main style={{ maxWidth: 880, margin: "40px auto", padding: "0 16px", paddingBottom: bottomPad }}>
      {/* Header */}
      <header style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 0.2 }}>Project Devi</div>
        <div style={{ color: "#6e6e6e", fontSize: 14, marginTop: 6 }}>
          Minimal structured medical answers (demo UI)
        </div>
      </header>

      {/* Results/history */}
      <div ref={listRef} style={{ display: "grid", gap: 16 }}>
        {history.map(({ q, a }, idx) => (
          <article key={idx} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 14, padding: 16 }}>
            <div style={{ marginBottom: 10, color: "#3b3b3b", fontSize: 15 }}>
              <span style={{ fontWeight: 600 }}>You:</span> {q}
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {a.sections.map((sec, i) => (
                <section
                  key={i}
                  style={{ background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 12, padding: 12 }}
                >
                  <div style={{ fontWeight: 650, marginBottom: 6 }}>{sec.title}</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {sec.bullets.map((b, j) => (
                      <li key={j} style={{ lineHeight: 1.55 }}>{b}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <footer style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Sources</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {a.sources.map((s, k) => (
                  <li key={k}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#0b63ce", textDecoration: "none" }}
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </footer>
          </article>
        ))}

        {history.length === 0 && (
          <div
            style={{
              color: "#777",
              textAlign: "center",
              padding: "48px 0",
              border: "1px dashed #e6e6e6",
              borderRadius: 14,
              background: "#fff",
            }}
          >
            Try: “Gartland type 2 supracondylar humerus fracture — what should I know?”
          </div>
        )}
      </div>

      {/* Sticky composer */}
      <div style={composerStyle}>
        <form
          onSubmit={handleSubmit}
          style={{
            maxWidth: 880,
            margin: "12px auto",
            padding: "8px 12px",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask a medical question…"
            style={{
              flex: 1,
              height: 44,
              padding: "0 14px",
              fontSize: 16,
              border: "1px solid #d7d7d7",
              borderRadius: 12,
              outline: "none",
              background: "#ffffff",
            }}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            aria-label="Ask"
            title="Ask"
            style={{
              height: 44,
              minWidth: 86,
              padding: "0 14px",
              fontSize: 15,
              fontWeight: 600,
              borderRadius: 12,
              border: "1px solid #111",
              background: loading || !query.trim() ? "#bbb" : "#111",
              color: "#fff",
              cursor: loading || !query.trim() ? "not-allowed" : "pointer",
              transition: "transform 0.06s ease",
            }}
          >
            {loading ? "Thinking…" : "Ask"}
          </button>
        </form>
      </div>
    </main>
  );
}
