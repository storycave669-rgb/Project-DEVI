// app/page.tsx
"use client";

import React, { useMemo, useState } from "react";

type Mode = "auto" | "radiology" | "emergency" | "ortho";

type Source = { id?: number; title: string; url: string };
type AnswerPayload = {
  html: string;              // rendered HTML answer
  sources: Source[];         // array of sources
  modeUsed?: Mode;           // which mode the backend used
  confidence_band?: "low" | "medium" | "high";
  confidence_pct?: number | null;
  latency_ms?: number;
};

const WEBHOOK_URL =
  process.env.NEXT_PUBLIC_FEEDBACK_WEBHOOK ||
  "https://hook.eu2.make.com/REPLACE_WITH_YOUR_WEBHOOK_ID";

export default function HomePage() {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [loading, setLoading] = useState(false);

  const [answer, setAnswer] = useState<AnswerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRate = useMemo(() => !!answer && question.trim().length > 0, [answer, question]);

  async function ask() {
    if (!question.trim()) return;

    setLoading(true);
    setError(null);
    setAnswer(null);

    try {
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, mode }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Request failed (${res.status})`);
      }

      const data = (await res.json()) as {
        html: string;
        sources: Source[];
        modeUsed?: Mode;
        confidence_band?: "low" | "medium" | "high";
        confidence_pct?: number | null;
        latency_ms?: number;
      };

      setAnswer({
        html: data.html,
        sources: data.sources || [],
        modeUsed: data.modeUsed || mode,
        confidence_band: data.confidence_band,
        confidence_pct: data.confidence_pct ?? null,
        latency_ms: data.latency_ms,
      });
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function sendRating(rating: "up" | "down") {
    try {
      if (!WEBHOOK_URL || WEBHOOK_URL.includes("REPLACE_WITH_YOUR_WEBHOOK_ID")) {
        alert("Add your Make.com webhook URL in NEXT_PUBLIC_FEEDBACK_WEBHOOK first.");
        return;
      }
      if (!canRate) return;

      // Minimal payload. You can add more fields anytime.
      const payload = {
        ts: new Date().toISOString(),
        mode,
        question,
        rating, // "up" | "down"
      };

      const r = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) throw new Error(`Webhook returned ${r.status}`);
      alert("Thanks! Rating saved.");
    } catch (e: any) {
      alert(`Couldn't save rating: ${e?.message || "unknown error"}`);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold mb-4">Project Devi</h1>
      <p className="text-sm text-gray-500 mb-6">Minimal medical Q&A with live sources.</p>

      {/* Query row */}
      <div className="flex gap-2 items-center mb-3 flex-wrap">
        <input
          className="flex-1 rounded border px-3 py-2"
          placeholder="Type your question…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask();
          }}
        />

        {/* Mode selector */}
        <div className="flex rounded border overflow-hidden">
          {(["auto", "radiology", "emergency", "ortho"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-2 text-sm ${
                mode === m ? "bg-black text-white" : "bg-white hover:bg-gray-50"
              } border-r last:border-r-0`}
              type="button"
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        <button
          onClick={ask}
          disabled={loading}
          className="rounded bg-black text-white px-4 py-2 disabled:opacity-60"
          type="button"
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="my-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Answer card */}
      {answer && (
        <div className="mt-6 rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-semibold">Answer</h2>
            {answer.modeUsed && (
              <span className="text-xs rounded bg-gray-100 px-2 py-1">
                Mode: {answer.modeUsed}
              </span>
            )}
          </div>

          <article
            className="prose max-w-none"
            dangerouslySetInnerHTML={{ __html: answer.html }}
          />

          {/* Sources */}
          {answer.sources?.length > 0 && (
            <div className="mt-6">
              <h3 className="font-semibold mb-2">Sources</h3>
              <ul className="list-disc pl-5 space-y-1">
                {answer.sources.map((s, i) => (
                  <li key={`${s.url}-${i}`}>
                    <a
                      className="text-blue-600 hover:underline break-all"
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Rating row */}
          <div className="mt-6 flex items-center gap-2">
            <span className="text-sm text-gray-600">Was this useful?</span>
            <button
              type="button"
              onClick={() => sendRating("up")}
              disabled={!canRate}
              className="rounded border px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Good
            </button>
            <button
              type="button"
              onClick={() => sendRating("down")}
              disabled={!canRate}
              className="rounded border px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Bad
            </button>

            {/* Optional tiny diagnostics */}
            <div className="ml-auto text-xs text-gray-500">
              {typeof answer.latency_ms === "number" && (
                <span>Latency: {Math.round(answer.latency_ms)} ms</span>
              )}
              {answer.confidence_band && (
                <span className="ml-3">
                  Confidence: {answer.confidence_band}
                  {typeof answer.confidence_pct === "number"
                    ? ` (${Math.round(answer.confidence_pct)}%)`
                    : ""}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
