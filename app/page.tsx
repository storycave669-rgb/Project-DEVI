"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Mode = "radiology" | "emergency" | "ortho";
type Source = { id: number; title: string; url: string; preview?: string };
type ApiResp = {
  answer: string;
  sources: Source[];
  mode?: Mode;
  confidence?: { band: "High" | "Moderate" | "Preliminary"; pct: number };
  error?: string;
};

type HistoryItem = {
  id: string;
  q: string;
  mode: Mode | "auto" | undefined;
  answerHtml: string;
  sources: Source[];
  ts: number;
};

type FeedbackItem = {
  id: string;
  q: string;
  mode: Mode | "auto" | undefined;
  confidence?: ApiResp["confidence"];
  rating: "up" | "down";
  comment?: string;
  answerHtml: string;
  sources: Source[];
  ts: number;
};

const MAX_HISTORY = 10;
const LS_HISTORY = "devihist";
const LS_MODE = "devimode";
const LS_FEEDBACK = "devifeedback";

// Optional webhook (set this in Vercel Project Settings → Environment Variables)
const WEBHOOK = process.env.NEXT_PUBLIC_FEEDBACK_WEBHOOK_URL;

/* ---------- Follow-up chips per mode ---------- */
function defaultFollowUps(mode: Mode | "auto" | undefined): string[] {
  const s = mode ?? "auto";
  if (s === "radiology") {
    return [
      "Key signs & measurements to report?",
      "One-line impression with urgency/next step.",
      "Top differentials and how to distinguish?",
      "Report format (Indication, Technique, Findings, Impression)?",
    ];
  }
  if (s === "emergency") {
    return [
      "Immediate red flags & resus indications?",
      "ABCDE steps with examples (drugs/doses)?",
      "When to reduce/splint and call ortho?",
      "Disposition criteria & review window?",
    ];
  }
  // Ortho (or Auto as default)
  return [
    "Full classification with radiographic criteria?",
    "Nerve/artery injuries to document and follow?",
    "Non-op vs pinning—clear indications?",
    "Rehab milestones and clinic follow-up timing?",
  ];
}

/* ---------- HTML → Markdown (simple, robust) ---------- */
function htmlToMarkdown(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  const lines: string[] = [];
  const blocks = tmp.querySelectorAll("div[style*='font-weight:700']");

  blocks.forEach((titleDiv) => {
    const title = titleDiv.textContent?.trim() || "";
    if (!title) return;
    lines.push(`\n### ${title}\n`);
    const ul = titleDiv.nextElementSibling as HTMLUListElement | null;
    if (ul && ul.tagName.toLowerCase() === "ul") {
      ul.querySelectorAll("li").forEach((li) => {
        lines.push(`- ${li.textContent?.trim() || ""}`);
      });
    }
  });

  return lines.join("\n").trim();
}

/* ---------- Build full Markdown doc ---------- */
function buildMarkdownDoc(
  q: string,
  mode: Mode | "auto" | undefined,
  confidence: ApiResp["confidence"],
  bodyMd: string,
  sources: Source[]
): string {
  const header = `# Project Devi\n\n**Question:** ${q}\n\n**Mode:** ${mode ?? "auto"}${
    confidence ? `\n\n**Confidence:** ${confidence.band} (${confidence.pct}%)` : ""
  }\n`;
  const refs = sources.length
    ? `\n\n## Sources\n${sources.map((s) => `1. [${s.title}](${s.url})`).join("\n")}\n`
    : "";
  const disclaimer = `\n---\n*Educational use only. Not a medical device or a substitute for clinical judgement.*\n`;
  return `${header}\n${bodyMd}\n${refs}${disclaimer}`;
}

export default function Home() {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"auto" | Mode>("auto");
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [serverMode, setServerMode] = useState<Mode | undefined>();
  const [confidence, setConfidence] = useState<ApiResp["confidence"]>();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState<"up" | "down" | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackToast, setFeedbackToast] = useState("");
  const startedAtRef = useRef<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  /* ---------- hydrate history + mode ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_HISTORY);
      if (raw) setHistory(JSON.parse(raw));
      const m = localStorage.getItem(LS_MODE) as "auto" | Mode | null;
      if (m) setMode(m);
    } catch {}
  }, []);

  /* ---------- persist history + mode ---------- */
  useEffect(() => {
    try {
      localStorage.setItem(LS_HISTORY, JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch {}
  }, [history]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_MODE, mode);
    } catch {}
  }, [mode]);

  /* ---------- ask API ---------- */
  async function ask(text?: string, override?: "auto" | Mode) {
    const question = (text ?? q).trim();
    if (!question) return;

    setLoading(true);
    startedAtRef.current = Date.now();
    setLatencyMs(null);
    setHtml("");
    setSources([]);
    setServerMode(undefined);
    setConfidence(undefined);

    const body: any = { question };
    const chosen = override ?? mode;
    if (chosen !== "auto") body.mode = chosen; // name matches backend

    const r = await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await r.json()) as ApiResp;

    setLoading(false);
    const elapsed = startedAtRef.current ? Date.now() - startedAtRef.current : null;
    if (elapsed !== null) setLatencyMs(elapsed);

    if (!r.ok || data.error) {
      setHtml(`<div style="color:#b00">${data.error || "Something went wrong."}</div>`);
      return;
    }

    setHtml(data.answer || "");
    setSources(data.sources || []);
    setServerMode(data.mode);
    setConfidence(data.confidence);

    // Save in local history
    const item: HistoryItem = {
      id: String(Date.now()),
      q: question,
      mode: chosen,
      answerHtml: data.answer || "",
      sources: data.sources || [],
      ts: Date.now(),
    };
    setHistory((prev) => [item, ...prev].slice(0, MAX_HISTORY));

    // ---- NEW: Auto log to Make/Google Sheets (fire & forget) ----
    if (WEBHOOK) {
      try {
        const confidence_band =
          data.confidence?.band ??
          (data.sources && data.sources.length >= 6 ? "High" : data.sources && data.sources.length >= 3 ? "Moderate" : "Preliminary");
        const confidence_pct = data.confidence?.pct ?? (data.sources ? Math.min(95, data.sources.length * 12) : 0);
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ts: new Date().toISOString(),
            mode: data.mode || (chosen === "auto" ? "ortho" : chosen), // fallback
            question,
            answer_html: data.answer || "",
            sources_json: data.sources || [],
            rating: "", // empty by default; user can later thumbs up/down
            confidence_band,
            confidence_pct,
            latency_ms: elapsed ?? "",
          }),
        });
      } catch {
        // do not block UI on logging errors
      }
    }
  }

  /* ---------- keyboard: Enter / Cmd+Enter ---------- */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") ask();
    if (e.key === "Enter" && !e.shiftKey) ask();
  }

  /* ---------- Copy Markdown / Download / Print ---------- */
  async function copyMarkdown() {
    const md = buildMarkdownDoc(q, serverMode ?? mode, confidence, htmlToMarkdown(html), sources);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    } catch {}
  }

  function downloadMarkdown() {
    const md = buildMarkdownDoc(q, serverMode ?? mode, confidence, htmlToMarkdown(html), sources);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (q || "project-devi").replace(/[^a-z0-9\-]+/gi, "-").toLowerCase();
    a.href = url;
    a.download = `${safeName}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printSheet() {
    const id = "print-css";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.innerHTML = `
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          main { max-width: 800px !important; }
          .no-print { display: none !important; }
          .answer ul { margin: 6px 0 12px 20px; }
          .answer div[style*="font-weight:700"] { margin-top: 8px; }
        }
      `;
      document.head.appendChild(style);
    }
    window.print();
  }

  /* ---------- Feedback (manual thumbs up/down) ---------- */
  async function submitFeedback(rating: "up" | "down") {
    const fb: FeedbackItem = {
      id: String(Date.now()),
      q,
      mode: serverMode ?? mode,
      confidence,
      rating,
      comment: feedbackText.trim() || undefined,
      answerHtml: html,
      sources,
      ts: Date.now(),
    };

    try {
      const raw = localStorage.getItem(LS_FEEDBACK);
      const arr: FeedbackItem[] = raw ? JSON.parse(raw) : [];
      arr.unshift(fb);
      localStorage.setItem(LS_FEEDBACK, JSON.stringify(arr.slice(0, 200)));
    } catch {}

    if (WEBHOOK) {
      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fb),
        });
      } catch {}
    }

    setFeedbackText("");
    setFeedbackOpen(null);
    setFeedbackToast("Thanks for the feedback!");
    setTimeout(() => setFeedbackToast(""), 1200);
  }

  const followups = useMemo(() => defaultFollowUps(serverMode ?? mode), [serverMode, mode]);

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: "0 20px" }}>
      <header style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 34, margin: 0 }}>Project Devi</h1>
        <div style={{ color: "#667085", marginTop: 4 }}>Structured medical Q&amp;A with live sources.</div>
      </header>

      {/* Query row */}
      <div className="no-print" style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask a question (e.g., Gartland II supracondylar humerus fracture)…"
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoFocus
          style={{
            flex: 1,
            padding: "14px 16px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            outline: "none",
            fontSize: 16,
            background: "#fff",
          }}
        />
        <div style={{ display: "flex", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          {(["auto", "radiology", "emergency", "ortho"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "10px 12px",
                fontSize: 13,
                border: "none",
                background: mode === m ? "#111827" : "#ffffff",
                color: mode === m ? "#ffffff" : "#111827",
                cursor: "pointer",
              }}
              title={m === "auto" ? "Auto-detect template" : `Force ${m}`}
            >
              {m === "auto" ? "Auto" : m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <button
          onClick={() => ask()}
          disabled={loading || !q.trim()}
          style={{
            padding: "12px 18px",
            borderRadius: 10,
            background: loading || !q.trim() ? "#9ca3af" : "#111827",
            color: "#fff",
            border: "none",
            cursor: loading || !q.trim() ? "not-allowed" : "pointer",
            fontWeight: 600,
            minWidth: 88,
          }}
          title="Enter or Cmd/Ctrl + Enter"
        >
          {loading ? "Asking…" : "Ask"}
        </button>
      </div>

      {/* Follow-up suggestions */}
      <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {followups.map((f, i) => (
          <button
            key={i}
            onClick={() => ask(f, mode)}
            style={{
              border: "1px solid #e5e7eb",
              background: "#fff",
              color: "#111827",
              padding: "8px 12px",
              fontSize: 13,
              borderRadius: 999,
              cursor: "pointer",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Action bar: export + feedback */}
      <div className="no-print" style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={copyMarkdown}
            disabled={!html}
            style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: "8px 10px", cursor: html ? "pointer" : "not-allowed" }}
          >
            Copy Markdown
          </button>
          <button
            onClick={downloadMarkdown}
            disabled={!html}
            style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: "8px 10px", cursor: html ? "pointer" : "not-allowed" }}
          >
            Download .md
          </button>
          <button
            onClick={printSheet}
            disabled={!html}
            style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: "8px 10px", cursor: html ? "pointer" : "not-allowed" }}
          >
            Print / Save as PDF
          </button>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            onClick={() => setFeedbackOpen("up")}
            disabled={!html}
            title="Helpful"
            style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 999, padding: "6px 10px", cursor: html ? "pointer" : "not-allowed" }}
          >
            👍
          </button>
          <button
            onClick={() => setFeedbackOpen("down")}
            disabled={!html}
            title="Needs work"
            style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 999, padding: "6px 10px", cursor: html ? "pointer" : "not-allowed" }}
          >
            👎
          </button>
        </div>
      </div>

      {/* Answer card */}
      <section
        style={{
          marginTop: 6,
          border: "1px solid #eee",
          borderRadius: 12,
          background: "#fff",
          boxShadow: "0 3px 12px rgba(0,0,0,0.04)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #f3f4f6",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700, fontSize: 20 }}>Answer</div>
            {serverMode && (
              <span
                style={{
                  fontSize: 12,
                  padding: "3px 8px",
                  background: "#f3f4f6",
                  border: "1px solid #e5e7eb",
                  borderRadius: 999,
                }}
                title="Template used"
              >
                Mode: {serverMode}
              </span>
            )}
            {confidence && (
              <span
                style={{
                  fontSize: 12,
                  padding: "3px 8px",
                  background:
                    confidence.band === "High"
                      ? "#e8f7ed"
                      : confidence.band === "Moderate"
                      ? "#fff8e6"
                      : "#fdecec",
                  border: "1px solid #e5e7eb",
                  borderRadius: 999,
                }}
                title="Based on source quality & diversity"
              >
                Confidence: {confidence.band} ({confidence.pct}%)
              </span>
            )}
            {latencyMs !== null && (
              <span
                style={{
                  fontSize: 12,
                  padding: "3px 8px",
                  background: "#f3f4f6",
                  border: "1px solid #e5e7eb",
                  borderRadius: 999,
                }}
                title="Response time"
              >
                {Math.round(latencyMs)} ms
              </span>
            )}
          </div>
        </div>

        <div style={{ padding: 16, minHeight: 120 }}>
          {loading ? (
            <div style={{ lineHeight: 1.6, color: "#6b7280" }}>
              <div style={{ height: 14, background: "#f3f4f6", marginBottom: 10, width: "82%", borderRadius: 6 }} />
              <div style={{ height: 14, background: "#f3f4f6", marginBottom: 10, width: "64%", borderRadius: 6 }} />
              <div style={{ height: 14, background: "#f3f4f6", marginBottom: 10, width: "72%", borderRadius: 6 }} />
            </div>
          ) : (
            <div className="answer" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>

        {/* Sources with hover preview */}
        {!loading && sources.length > 0 && (
          <div style={{ padding: 16, borderTop: "1px solid #f3f4f6" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Sources</div>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {sources.map((s) => (
                <li key={s.id} style={{ margin: "6px 0" }}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    title={s.preview || s.title}
                    style={{ color: "#0a66c2" }}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {/* History */}
      {history.length > 0 && (
        <section className="no-print" style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Recent</div>
          <div style={{ display: "grid", gap: 8 }}>
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => {
                  setQ(h.q);
                  setHtml(h.answerHtml);
                  setSources(h.sources);
                  setServerMode((h.mode as Mode) ?? undefined);
                }}
                style={{
                  textAlign: "left",
                  border: "1px solid #eee",
                  background: "#fff",
                  borderRadius: 10,
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
                title={new Date(h.ts).toLocaleString()}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>{h.q}</div>
                <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
                  Mode: {h.mode ?? "auto"} · {new Date(h.ts).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Feedback dialog */}
      {feedbackOpen && (
        <div
          className="no-print"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setFeedbackOpen(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 480,
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              padding: 16,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
              {feedbackOpen === "up" ? "What was helpful?" : "What should be improved?"}
            </div>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Optional comment (e.g., missing guideline, wrong emphasis, unclear step)…"
              rows={4}
              style={{
                width: "100%",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: 10,
                outline: "none",
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setFeedbackOpen(null)}
                style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: "8px 12px" }}
              >
                Cancel
              </button>
              <button
                onClick={() => submitFeedback(feedbackOpen)}
                style={{ border: "none", background: "#111827", color: "#fff", borderRadius: 8, padding: "8px 12px" }}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tiny toasts */}
      {copied && (
        <div
          className="no-print"
          style={{
            position: "fixed",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#111",
            color: "#fff",
            borderRadius: 999,
            padding: "6px 10px",
            fontSize: 12,
          }}
        >
          Copied!
        </div>
      )}
      {feedbackToast && (
        <div
          className="no-print"
          style={{
            position: "fixed",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#111",
            color: "#fff",
            borderRadius: 999,
            padding: "6px 10px",
            fontSize: 12,
          }}
        >
          {feedbackToast}
        </div>
      )}
    </main>
  );
}
