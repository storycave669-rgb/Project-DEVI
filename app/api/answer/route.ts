// /app/api/answer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* ───────────────────────────── Env ───────────────────────────── */
const TAVILY_KEY = process.env.TAVILY_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const FEEDBACK_WEBHOOK_URL = process.env.FEEDBACK_WEBHOOK_URL || "";

/* ─────────────────────────── Types ───────────────────────────── */
type TavilyItem = { url: string; title?: string; content?: string };
type TavilyResp = { results?: TavilyItem[] };

type Mode = "radiology" | "emergency" | "ortho";

/* ───────────────────── Tavily Web Search ────────────────────── */
async function webSearch(q: string): Promise<TavilyItem[]> {
  if (!TAVILY_KEY) return [];
  try {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query: q,
        search_depth: "advanced",
        include_answer: false,
        max_results: 10, // ↑ from 6 → 10
        include_domains: [
          "aiims.edu",
          "icmr.gov.in",
          "nbe.edu.in",
          "who.int",
          "uptodate.com",
          "ncbi.nlm.nih.gov",
          "radiopaedia.org",
          "rcem.ac.uk",
          "acep.org",
        ],
      }),
    });
    if (!r.ok) return [];
    const data: TavilyResp = await r.json();
    return data.results ?? [];
  } catch {
    return [];
  }
}

/* ───────────────────── HTML helpers ─────────────────────────── */
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

/* ───────────── Mode detection & section titles ───────────────── */
function detectMode(q: string): Mode {
  const s = q.toLowerCase();

  const radioHits = [
    "xray",
    "x-ray",
    "xr ",
    "radiograph",
    "ap view",
    "lateral view",
    "ct ",
    "computed tomography",
    "mri",
    "mr imaging",
    "ultrasound",
    "usg",
    "report",
    "impression",
    "ddx",
    "differential",
    "findings",
    "radiology",
    "sequence",
    "contrast",
    "t1",
    "t2",
    "stir",
  ].some((k) => s.includes(k));

  const edHits = [
    " ed ",
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
  ].some((k) => s.includes(k));

  if (radioHits && !edHits) return "radiology";
  if (edHits) return "emergency";
  return "ortho";
}

function sectionTitlesFor(mode: Mode): string[] {
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

/* ──────────────────── Dedup trailing [n] ────────────────────── */
// Collapse duplicates like “… [5]. [5]” or “… [2, 4]. [2, 4]”
function dedupeCitations(html: string) {
  return html.replace(
    /(\[\d+(?:\s*,\s*\d+)*\])(?:\s*\.\s*)?(?:\s*\1)+/g,
    "$1"
  );
}

/* ──────────────── Fire-and-forget logging ───────────────────── */
async function logFeedbackRow(params: {
  mode: string;
  question: string;
  answer_html: string;
  sources: Array<{ id: number; title: string; url: string }>;
  rating?: string | number | null;
  confidence_band?: "low" | "medium" | "high" | "";
  confidence_pct?: number | null;
}) {
  if (!FEEDBACK_WEBHOOK_URL) return;
  const payload = {
    ts: new Date().toISOString(),
    mode: params.mode,
    question: params.question,
    answer_html: params.answer_html,
    sources_json: JSON.stringify(
      (params.sources || []).map((s) => ({ title: s.title, url: s.url }))
    ),
    rating: params.rating ?? "",
    confidence_band: params.confidence_band ?? "",
    confidence_pct: params.confidence_pct ?? "",
  };
  try {
    await fetch(FEEDBACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // @ts-ignore
      cache: "no-store",
    });
  } catch {
    /* ignore */
  }
}

/* ────────────────────────── Handler ─────────────────────────── */
export async function POST(req: NextRequest) {
  try {
    const { question, mode: userMode } = (await req.json()) as {
      question: string;
      mode?: Mode | "auto";
    };

    if (!question || question.trim().length < 3) {
      return NextResponse.json(
        { error: "Ask a valid question." },
        { status: 400 }
      );
    }

    const mode: Mode =
      userMode && userMode !== "auto" ? (userMode as Mode) : detectMode(question);
    const titles = sectionTitlesFor(mode);

    /* 1) Live search */
    const hits = await webSearch(question);
    const sources = hits.map((h, i) => ({
      id: i + 1,
      title: h.title || h.url.replace(/^https?:\/\//, ""),
      url: h.url,
      content: (h.content || "").slice(0, 1400),
    }));

    if (sources.length === 0) {
      const html = `<div style="padding:12px;border:1px solid #eee;border-radius:8px">No reliable sources found for this query. Please rephrase or try a more specific question.</div>`;
      return NextResponse.json({ answer: html, sources: [], mode }, { status: 200 });
    }

    /* 2) Build context for Gemini */
    const numberedContext = sources
      .map((s) => `[${s.id}] ${s.title}\nURL: ${s.url}\nSNIPPET: ${s.content}`)
      .join("\n\n");

    const audienceHint =
      mode === "radiology"
        ? "RADIology style notes for Indian medical students / junior residents; emphasize imaging findings, discriminators, and a crisp impression."
        : mode === "emergency"
        ? "EMERGENCY MEDICINE style notes for Indian medical students / junior residents; emphasize triage, stabilization, immediate management, and disposition."
        : "ORTHO/TRAUMA style notes for Indian medical students / junior residents; emphasize classification and stepwise management.";

    const sectionList = titles.map((t) => `- ${t}`).join("\n");

    const systemPrompt = `
You write concise, high-yield clinical notes using ONLY the SOURCES provided. If a fact is absent, omit it. Never invent.

Audience: ${audienceHint}

Output: VALID HTML only. For each applicable section below, render:
<div style="font-weight:700">Section Title</div>
<ul><li>short, assertive bullet with inline numeric citations like [1] or [2, 5]</li>…</ul>

Sections to cover (in order):
${sectionList}

Strict rules:
- DO NOT show the words "Radiology:", "Emergency:", or any meta/template label.
- If a section is not applicable, OMIT it entirely (no placeholders).
- 3–6 bullets per shown section; use confident guideline tone, avoid hedging ("may", "often") unless a guideline explicitly hedges.
- Use only the source numbers from SOURCES. No other references.
- Never wrap output in code fences.

SOURCES:
${numberedContext}
`.trim();

    /* 3) Call Gemini */
    let htmlAnswer = "";
    if (GEMINI_KEY) {
      try {
        const genAI = new GoogleGenerativeAI(GEMINI_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        // Use simple string form to avoid TS arg shenanigans.
        const result = await model.generateContent(
          `Question: ${question}\n\n${systemPrompt}`
        );
        let text = result.response.text().trim();

        // Strip accidental ```html fences if model added them
        text = text.replace(/^```html\s*/i, "").replace(/```$/i, "").trim();

        // If looks like HTML (div/ul), accept; else fallback-build
        const looksHtml = /<div[^>]*>.*<\/div>/is.test(text) || /<ul>/.test(text);
        htmlAnswer = looksHtml ? text : "";

        if (htmlAnswer) {
          htmlAnswer = dedupeCitations(htmlAnswer);
        }
      } catch {
        // swallow and fallback
      }
    }

    /* 4) Template fallback (keeps UX stable if model fails) */
    if (!htmlAnswer) {
      const safe = (i: number) => `[${i}]`;
      if (mode === "radiology") {
        htmlAnswer =
          sec("Clinical Question", [`What the study must answer ${safe(1)}.`]) +
          sec("Key Imaging Findings", [
            `Primary signs and key measurements ${safe(1)}.`,
            `Complications or associated findings ${safe(2)}.`,
            `Pitfalls / mimics to exclude ${safe(3)}.`,
          ]) +
          sec("Differential Diagnosis", [
            `Top 2–4 with discriminators ${safe(2)}.`,
          ]) +
          sec("What to Look For", [
            `Checklist by modality/view; include lines/angles if relevant ${safe(3)}.`,
          ]) +
          sec("Suggested Report Impression", [
            `One-line impression with urgency/next step ${safe(1)}.`,
          ]);
      } else if (mode === "emergency") {
        htmlAnswer =
          sec("Triage/Red Flags", [
            `Immediate threats to airway/breathing/circulation ${safe(1)}.`,
            `Red flags mandating senior/ortho involvement ${safe(2)}.`,
            `Analgesia and safeguarding considerations ${safe(3)}.`,
          ]) +
          sec("Initial Stabilization", [
            `ABCDE with analgesia and immobilization as needed ${safe(1)}.`,
            `Fluids, blood products, antibiotics/tetanus when appropriate ${safe(3)}.`,
            `Point-of-care imaging or labs if time-critical ${safe(2)}.`,
          ]) +
          sec("Focused Assessment", [
            `Neurovascular exam and mechanism-specific checks ${safe(2)}.`,
            `Identify indications for urgent reduction/procedure ${safe(3)}.`,
          ]) +
          sec("Immediate Management", [
            `Clear criteria for non-op vs reduction vs OR ${safe(1)}.`,
            `Time-bound reassessment and escalation ${safe(2)}.`,
          ]) +
          sec("Disposition/Follow-up", [
            `Admit vs discharge with explicit safety-net and review ${safe(2)}.`,
          ]);
      } else {
        htmlAnswer =
          sec("Classification", [
            `Key type(s) & radiographic features ${safe(1)}.`,
            `Named angles/lines that define the type ${safe(4)}.`,
            `Common exam phrasings for vivas ${safe(6)}.`,
          ]) +
          sec("Risk Factors", [
            `Mechanism / age / typical context ${safe(2)}.`,
            `High-risk features predicting complications ${safe(5)}.`,
          ]) +
          sec("Associated Injuries", [
            `Nerve/artery risks & how to document ${safe(3)}.`,
            `Joint injury / other fracture patterns ${safe(2)}.`,
          ]) +
          sec("Initial Management", [
            `ABCDE, analgesia, immobilization, ortho consult ${safe(1)}.`,
            `When imaging & which views ${safe(4)}.`,
            `Clear criteria for reduction vs splint vs OR ${safe(2)}.`,
          ]) +
          sec("Definitive/Follow-up", [
            `Indications for pinning / fixation ${safe(2)}.`,
            `Rehab milestones and clinic follow-up ${safe(5)}.`,
          ]);
      }
    }

    const publicSources = sources.map(({ id, title, url }) => ({ id, title, url }));

    // 5) Non-blocking logging to Make/Zapier → Google Sheets
    logFeedbackRow({
      mode,
      question,
      answer_html: htmlAnswer,
      sources: publicSources,
    });

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
