// app/api/answer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* ------------------------------------------------------------------ */
/* Types & ENV                                                        */
/* ------------------------------------------------------------------ */
type TavilyItem = { url: string; title?: string; content?: string };
type TavilyResp = { results?: TavilyItem[] };

const TAVILY_KEY = process.env.TAVILY_API_KEY!;
const GEMINI_KEY = process.env.GEMINI_API_KEY!;

// Optional: Make.com / n8n webhook that stores feedback rows
// (We fire-and-forget a POST with question, mode, answer, sources)
const FEEDBACK_WEBHOOK_URL = process.env.FEEDBACK_WEBHOOK_URL || "";

/* ------------------------------------------------------------------ */
/* Mode detection & section titles                                    */
/* ------------------------------------------------------------------ */
type Mode = "radiology" | "emergency" | "ortho";

function detectMode(q: string): Mode {
  const s = q.toLowerCase();
  const radioHits = [
    "xray",
    "x-ray",
    "xr",
    "radiograph",
    "ap view",
    "lateral view",
    "ct",
    "computed tomography",
    "mri",
    "ultrasound",
    "usg",
    "impression",
    "findings",
    "contrast",
    "sequence",
    "t1",
    "t2",
    "stir",
    "cta",
    "ctpa",
  ].some((k) => s.includes(k));

  const edHits = [
    "ed ",
    " emergency",
    "triage",
    "resus",
    "resuscitation",
    "abcde",
    "primary survey",
    "secondary survey",
    "hypotension",
    "unstable",
    "shock",
    "er approach",
    "initial stabilization",
    "polytrauma",
  ].some((k) => s.includes(k));

  if (radioHits && !edHits) return "radiology";
  if (edHits) return "emergency";
  return "ortho";
}

function sectionTitles(mode: Mode): string[] {
  if (mode === "radiology") {
    return [
      "Clinical Question",
      "Key Imaging Findings",
      "Differential Diagnosis",
      "What to Look For",
      "Suggested Report Impression",
    ];
  }
  if (mode === "emergency") {
    return [
      "Triage/Red Flags",
      "Initial Stabilization",
      "Focused Assessment",
      "Immediate Management",
      "Disposition/Follow-up",
    ];
  }
  // Ortho default
  return [
    "Classification",
    "Risk Factors",
    "Associated Injuries",
    "Initial Management",
    "Definitive/Follow-up",
  ];
}

/* ------------------------------------------------------------------ */
/* Search (Tavily)                                                    */
/* ------------------------------------------------------------------ */
async function webSearch(q: string): Promise<TavilyItem[]> {
  if (!TAVILY_KEY) return [];

  // Bias for India-relevant / guideline sources
  const include_domains = [
    "aiims.edu",
    "icmr.gov.in",
    "nbe.edu.in",
    "who.int",
    "uptodate.com",
    "pmc.ncbi.nlm.nih.gov",
    "pubmed.ncbi.nlm.nih.gov",
  ];

  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_KEY,
      query: q,
      search_depth: "advanced",
      include_answer: false,
      max_results: 10,
      include_domains,
    }),
  });

  if (!r.ok) return [];
  const data: TavilyResp = await r.json();
  return data.results ?? [];
}

/* ------------------------------------------------------------------ */
/* HTML helpers                                                       */
/* ------------------------------------------------------------------ */
function ul(items: string[]) {
  return `<ul style="margin:6px 0 0; padding-left: 20px">${items
    .map((i) => `<li>${i}</li>`)
    .join("")}</ul>`;
}
function sec(title: string, items: string[]) {
  if (!items.length) return "";
  return `<div style="margin-bottom:14px"><div style="font-weight:700">${title}</div>${ul(
    items
  )}</div>`;
}

// Deduplicate adjacent identical citation clusters like “[3]. [3]” or “[1, 2] [1, 2]”
function dedupeCitations(html: string) {
  return html
    .replace(/(\[\d+(?:\s*,\s*\d+)*\])(?:\s*\.\s*)?\s*\1/g, "$1")
    .replace(/\s{2,}/g, " ");
}

// Strip ``` or ```html fences if the model returns them
function stripFences(s: string) {
  return s
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Main handler                                                       */
/* ------------------------------------------------------------------ */
export async function POST(req: NextRequest) {
  try {
    const { question, mode: forcedMode } = (await req.json()) as {
      question: string;
      mode?: Mode;
    };

    if (!question || question.trim().length < 3) {
      return NextResponse.json(
        { error: "Ask a valid question." },
        { status: 400 }
      );
    }

    const mode = forcedMode ?? detectMode(question);
    const titles = sectionTitles(mode);

    /* 1) Live search */
    const hits = await webSearch(question);
    const sources = hits.slice(0, 8).map((h, i) => ({
      id: i + 1,
      title: h.title || h.url.replace(/^https?:\/\//, ""),
      url: h.url,
      content: (h.content || "").slice(0, 1400),
    }));

    // If no sources, return a graceful message (still log to webhook)
    if (sources.length === 0) {
      const html = `<div>No reliable sources found for this query. Please rephrase or try a more specific question.</div>`;
      void postFeedback({ mode, question, answer_html: html, sources });
      return NextResponse.json(
        { answer: html, sources: [], mode },
        { status: 200 }
      );
    }

    /* 2) Build numbered context for Gemini */
    const numberedContext = sources
      .map(
        (s) =>
          `[${s.id}] ${s.title}\nURL: ${s.url}\nSNIPPET: ${s.content.replace(
            /\s+/g,
            " "
          )}`
      )
      .join("\n\n");

    const sectionList = titles.map((t, i) => `${i + 1}) ${t}`).join("\n");

    const modeHint =
      mode === "radiology"
        ? "Radiology summary for Indian MBBS interns / JRs. Keep it exam-ready and reporting oriented."
        : mode === "emergency"
        ? "Emergency Medicine summary for Indian MBBS interns / JRs. Focus on triage, stabilization, and immediate actions."
        : "Orthopaedics/Trauma summary for Indian MBBS interns / JRs. Focus on classification and stepwise management.";

    const systemPrompt = `
You are a clinical summarizer. Use ONLY the provided SOURCES. If a fact is absent, omit it. Never invent.

Audience: ${modeHint}

STYLE:
- Use confident, guideline-style language (avoid hedging like “may”, “often”, unless the sources explicitly hedge).
- Keep bullets concise and practical, suitable for viva and ward-round notes in India.
- Every bullet MUST end with inline numeric citations like [1] or [2, 5] that refer only to the numbered SOURCES.
- Do NOT mention modes you’re not answering; only produce the sections for the selected mode.

TASK: For the user's question, write bullets under these exact sections:
${sectionList}

OUTPUT RULES (strict):
- Output VALID HTML only. For each section render:
  <div style="font-weight:700">Section Title</div>
  <ul><li>bullet [n]</li>...</ul>
- 3–6 bullets per section when evidence allows. Omit a section entirely if the sources do not support at least 1–2 solid bullets.
- No preamble, no conclusion, no “Sources” list. The server will add links.

SOURCES:
${numberedContext}
`.trim();

    /* 3) Call Gemini */
    let htmlAnswer = "";
    if (GEMINI_KEY) {
      try {
        const genAI = new GoogleGenerativeAI(GEMINI_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent([
          { role: "user", parts: [{ text: `Question: ${question}\n\n${systemPrompt}` }] },
        ]);
        const raw = (result.response.text() || "").trim();
        const maybeHtml = stripFences(raw);
        const looksHtml = /<ul|<div/i.test(maybeHtml);
        htmlAnswer = looksHtml ? maybeHtml : "";
      } catch {
        // swallow and fallback below
      }
    }

    /* 4) Fallback template (if LLM failed) */
    if (!htmlAnswer) {
      const safe = (i: number) => `[${i}]`;
      if (mode === "radiology") {
        htmlAnswer =
          sec("Clinical Question", [`Define the clinical ask and modality ${safe(1)}.`]) +
          sec("Key Imaging Findings", [`Primary signs and measurements ${safe(1)}.`]) +
          sec("Differential Diagnosis", [`Top 2–4 with discriminators ${safe(2)}.`]) +
          sec("What to Look For", [`Checklist & pitfalls by modality ${safe(3)}.`]) +
          sec("Suggested Report Impression", [`One-liner impression with urgency/next step ${safe(1)}.`]);
      } else if (mode === "emergency") {
        htmlAnswer =
          sec("Triage/Red Flags", [`Immediate threats to airway/breathing/circulation ${safe(1)}.`]) +
          sec("Initial Stabilization", [`ABCDE, analgesia, immobilize as indicated ${safe(1)}.`]) +
          sec("Focused Assessment", [`Key exam points, POCUS targets ${safe(2)}.`]) +
          sec("Immediate Management", [`Fluids/blood, meds, procedures as indicated ${safe(3)}.`]) +
          sec("Disposition/Follow-up", [`Admit vs discharge with time-bound review ${safe(2)}.`]);
      } else {
        htmlAnswer =
          sec("Classification", [`Accepted types and radiographic features ${safe(1)}.`]) +
          sec("Risk Factors", [`Mechanism, age, common contexts in India ${safe(2)}.`]) +
          sec("Associated Injuries", [`Nerve/artery risks; documentation ${safe(3)}.`]) +
          sec("Initial Management", [`ABCDE, analgesia, immobilization, ortho consult ${safe(1)}.`]) +
          sec("Definitive/Follow-up", [`Indications for reduction/pinning; rehab ${safe(2)}.`]);
      }
    }

    // Clean up duplicated “[n]. [n]” etc.
    htmlAnswer = dedupeCitations(htmlAnswer);

    /* 5) Return and (optionally) log to webhook */
    const publicSources = sources.map(({ id, title, url }) => ({ id, title, url }));
    const payload = {
      ts: new Date().toISOString(),
      mode,
      question,
      answer_html: htmlAnswer,
      sources: publicSources,
    };

    // fire-and-forget (do not block user)
    void postFeedback(payload);

    return NextResponse.json(
      { answer: htmlAnswer, sources: publicSources, mode },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}

/* ------------------------------------------------------------------ */
/* Telemetry webhook (optional)                                       */
/* ------------------------------------------------------------------ */
async function postFeedback(params: {
  ts?: string;
  mode: Mode;
  question: string;
  answer_html: string;
  sources: { id: number; title: string; url: string }[];
}) {
  if (!FEEDBACK_WEBHOOK_URL) return;
  try {
    await fetch(FEEDBACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ts: params.ts || new Date().toISOString(),
        mode: params.mode,
        question: params.question,
        answer_html: params.answer_html,
        sources_json: params.sources,
        rating: "", // reserved
        confidence_band: "", // reserved
        confidence_pct: "", // reserved
      }),
    });
  } catch {
    // don't throw – telemetry is best-effort
  }
}
