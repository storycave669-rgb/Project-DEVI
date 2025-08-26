"use client";
import { useState } from "react";

export default function Page() {
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    // For now, just add to history (later we’ll connect AI)
    setHistory((prev) => [...prev, query]);
    setQuery("");
  };

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ margin: "0 0 20px 0", fontSize: 32, textAlign: "center" }}>
        Project Devi
      </h1>

      {/* Input form */}
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: 8, marginBottom: 20 }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a medical question..."
          style={{
            flex: 1,
            padding: "12px",
            fontSize: 16,
            border: "1px solid #ccc",
            borderRadius: 8,
          }}
        />
        <button
          type="submit"
          style={{
            padding: "12px 20px",
            fontSize: 16,
            background: "#000",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Ask
        </button>
      </form>

      {/* History */}
      <div>
        {history.map((q, i) => (
          <div
            key={i}
            style={{
              background: "#f0f0f0",
              margin: "8px 0",
              padding: "12px",
              borderRadius: 8,
            }}
          >
            <strong>You:</strong> {q}
          </div>
        ))}
      </div>
    </main>
  );
}
