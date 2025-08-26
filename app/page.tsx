"use client";
import { useState } from "react";

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
  const [history, setHistory] = useState<{ q: string; a: MockResult }[]>([]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const a = mockSynthesize(q);
    setHistory((prev) => [{ q, a }, ...prev]);
    setQuery("");
  };

  return (
    <main style={{ maxWidth: 820, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ margin: "0 0 20px 0", fontSize: 32, textAlign: "center" }}>Project Devi</h1>

      {/* Input */}
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a medical question…"
          style={{
            flex: 1,
            padding: "12px",
            fontSize: 16,
            border: "1px solid #d7d7d7",
            borderRadius: 10,
            background: "#fff",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "12px 18px",
            fontSize: 16,
            background: "#111",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            cursor: "pointer",
          }}
        >
          Ask
        </button>
      </form>

      {/* History */}
      <div style={{ display: "grid", gap: 16 }}>
        {history.map(({ q, a }, idx) => (
          <div key={idx} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
            <div style={{ marginBottom: 8, color: "#666", fontSize: 14 }}>
              <strong>You:</strong> {q}
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {a.sections.map((sec, i) => (
                <div key={i} style={{ background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{sec.title}</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {sec.bullets.map((b, j) => (
                      <li key={j} style={{ lineHeight: 1.5 }}>{b}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Sources */}
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Sources</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {a.sources.map((s, k) => (
                  <li key={k}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "#0b63ce", textDecoration: "none" }}>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}

        {history.length === 0 && (
          <div style={{ color: "#777", textAlign: "center", padding: "40px 0" }}>
            Try: “Gartland type 2 supracondylar humerus fracture — what should I know?”
          </div>
        )}
      </div>
    </main>
  );
}
