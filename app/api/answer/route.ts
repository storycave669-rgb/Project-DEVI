// app/api/answer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ---------- Types ----------
type TavilyItem = { url: string; title?: string; content?: string };
type TavilyResp = { results?: TavilyItem[] };

type Mode = "radiology" | "emergency" | "ortho";

type PublicSource = { id: number; title: string; url: string };

// ---------- ENV ----------
const TAVILY_KEY = process.env.TAVILY_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
// Optional: Make.com (or any) webhook that adds a row to Google Sheets
const FEEDBACK_WEBHOOK_URL = process.env.FEEDBACK_WEBHOOK_URL || "";

// ---------- Utilities ----------
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

// Deduplicate ugly “[3]. [3]”, “[1, 2]. [1, 2]”, “[5] [5]”, etc.
function dedupeCitations(html: string) {
  // collapse repeated identical citation blocks (optionally separated by ". " or spaces)
  // e.g. "[1, 2]. [1, 2]" -> "[1, 2]"
  return html.replace(/((\[\d+(?:\s*,\s*\d+)*\])(?:\s*\.\s*)?\s*)\1+/g, "$2");
}

// Strip ```html fences if the model returns them
function stripFences(s: string) {
  return s.replace(/```html?\s*([\s\S]*?)\s*```/i, "$1").trim();
}

// Guarantee a minimum bullet count by padding with placeholders (still cited)
function ensureMinBullets(items: string[], min = 3, cite = "[1]") {
  const out = items.slice();
  while (out.length < min) out.push(`— ${cite}`);
  return out;
}

// ---------- Mode detection & section titles ----------
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
    "report",
    "impression",
    "findings",
    "sequence",
    "contrast",
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
    "unstable",
    "shock",
    "hypotension",
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
  // ortho default
  return [
    "Classification",
    "Risk Factors",
    "Associated Injuries",
    "Initial Management",
    "Definitive/Follow-up",
  ];
}

// ---------- Tavily search ----------
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
        max_results: 10, // ↑ more results, we’ll pick best below
        include_domains: ["aiims.edu", "icmr.gov.in", "nbe.edu.in", "who.int", "uptodate.com"],
      }),
    });
    if (!r.ok) return [];
    const data: TavilyResp = await r.json();
    return data.results ?? [];
  } catch {
    return [];
  }
}

// ---------- Minimal source ranking (prefer .gov/.edu/guidelines) ----------
function rankSources(items: TavilyItem[]): TavilyItem[] {
  const score = (u: string) => {
    const url = u.toLowerCase();
    let s = 0;
    if (/\b(nlm\.nih|ncbi\.nlm|who\.int|nice\.org|guidelines?|gov|\.edu)\b/.test(url)) s += 4;
    if (/\b(aiims\.edu|icmr\.gov\.in|nbe\.edu\.in)\b/.test(url)) s += 3;
    if (/\bpubmed|nejm|thelancet|bmj|jama\b/.test(url)) s += 2;
    if (/\b(statpearls|radiopaedia|uptodate)\b/.test(url)) s += 1;
    return s;
  };
  return [...items].sort((a, b) => score(b.url) - score(a.url));
}

// ---------- Gemini prompt ----------
function buildPrompt(mode: Mode, titles: string[], numberedContext: string, question: string) {
  const modeHint =
    mode === "radiology"
      ? "RADIOLOGY style for Indian medical JRs: concise imaging findings, key differentials, and an exam-ready impression."
      : mode === "emergency"
      ? "EMERGENCY MEDICINE style for Indian JRs: triage priorities, stabilization, immediate management, and disposition."
      : "ORTHO/TRAUMA style for Indian JRs: classification and stepwise management with clear indications.";

  const sectionList = titles.map((t, i) => `${i + 1}) ${t}`).join("\n");

  return `
You are a clinical summarizer. Use ONLY the provided SOURCES. If a fact is absent, omit it. Never invent.

Audience & tone:
- ${modeHint}
- Use confident, guideline-style language. Avoid hedging (“may”, “often”) unless the source explicitly hedges.

Task:
For the user's question, produce concise, high-yield bullets under these sections:
${sectionList}

Hard rules:
- Every bullet ends with inline numeric citations like [1] or [2, 5], matching the source numbers.
- Cite ONLY numbers from SOURCES. No new sources.
- Keep bullets short and practical (1–2 lines).
- Return VALID HTML only. For each section render exactly:
  <div style="font-weight:700">Section Title</div>
  <ul><li>bullet [n]</li>...</ul>
- No preamble, no conclusion, no extra headings, no “Sources” list (server will add links).

SOURCES:
${numberedContext}

USER QUESTION:
${question}
`.trim();
}

// ---------- Optional webhook ----------
async function postFeedback(payload: Record<string, any>) {
  const url = payload.webhookUrl || FEEDBACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // best-effort only
  }
}

// ---------- Main handler ----------
export async function POST(req: NextRequest) {
  try {
    const { question, mode: modeIn, webhookUrl } = (await req.json()) as {
      question: string;
      mode?: Mode | "auto";
      webhookUrl?: string;
    };

    if (!question || question.trim().length < 3) {
      return NextResponse.json({ error: "Ask a valid question." }, { status: 400 });
    }

    const mode: Mode = modeIn && modeIn !== "auto" ? (modeIn as Mode) : detectMode(question);
    const titles = sectionTitles(mode);

    // 1) Live search
    const hits = rankSources(await webSearch(question)).slice(0, 8);
    const sources = hits.map((h, i) => ({
      id: i + 1,
      title: h.title || h.url.replace(/^https?:\/\//, ""),
      url: h.url,
      content: (h.content || "").slice(0, 1200),
    }));

    if (sources.length === 0) {
      const html = `<div>No reliable sources found. Try a more specific question.</div>`;
      return NextResponse.json({ answer: html, sources: [], mode }, { status: 200 });
    }

    // 2) Build numbered context for Gemini
    const numberedContext = sources
      .map((s) => `[${s.id}] ${s.title}\nURL: ${s.url}\nSNIPPET: ${s.content}`)
      .join("\n\n");

    const prompt = buildPrompt(mode, titles, numberedContext, question);

    // 3) Call Gemini
    let htmlAnswer = "";
    if (GEMINI_KEY) {
      try {
        const genAI = new GoogleGenerativeAI(GEMINI_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        let text = result.response.text().trim();
        text = stripFences(text);
        const looksHtml = /<div[^>]*>.*<\/div>/is.test(text) || /<ul>/.test(text);
        if (looksHtml) htmlAnswer = text;
      } catch {
        // fall through to template
      }
    }

    // 4) Template fallback OR normalize
    if (!htmlAnswer) {
      // conservative, still show useful skeleton
      const cite = (n = 1) => `[${Math.min(n, sources.length)}]`;
      if (mode === "radiology") {
        htmlAnswer =
          sec("Clinical Question", ensureMinBullets([`Summarize what the study should answer ${cite()}.`])) +
          sec(
            "Key Imaging Findings",
            ensureMinBullets(
              [
                `Primary signs and measurements when pathology is present ${cite()}.`,
                `Ancillary signs that support the diagnosis ${cite(2)}.`,
              ],
              3,
              cite()
            )
          ) +
          sec("Differential Diagnosis", ensureMinBullets([`Top differentials with discriminators ${cite(2)}.`])) +
          sec("What to Look For", ensureMinBullets([`Checklist and pitfalls by modality ${cite(3)}.`])) +
          sec(
            "Suggested Report Impression",
            ensureMinBullets([`Concise impression with urgency/next step ${cite()}.`])
          );
      } else if (mode === "emergency") {
        htmlAnswer =
          sec("Triage/Red Flags", ensureMinBullets([`Immediate threats to ABCDE ${cite()}.`])) +
          sec(
            "Initial Stabilization",
            ensureMinBullets([`Airway, oxygenation/ventilation, circulation access, analgesia ${cite()}.`])
          ) +
          sec(
            "Focused Assessment",
            ensureMinBullets([`Neurovascular status and key exam points ${cite(2)}.`])
          ) +
          sec(
            "Immediate Management",
            ensureMinBullets([`Indications for reduction/procedures; antibiotics/tetanus if needed ${cite(3)}.`])
          ) +
          sec(
            "Disposition/Follow-up",
            ensureMinBullets([`Admit vs discharge and time-bound review ${cite(2)}.`])
          );
      } else {
        htmlAnswer =
          sec(
            "Classification",
            ensureMinBullets([`Recognized subtypes with radiographic features ${cite()}.`])
          ) +
          sec("Risk Factors", ensureMinBullets([`Mechanism/age patterns ${cite(2)}.`])) +
          sec(
            "Associated Injuries",
            ensureMinBullets([`Nerve/artery concerns; what to document ${cite(3)}.`])
          ) +
          sec(
            "Initial Management",
            ensureMinBullets([`ABCDE, analgesia, immobilization, ortho consult ${cite()}.`])
          ) +
          sec(
            "Definitive/Follow-up",
            ensureMinBullets([`Clear indications for reduction/pinning; rehab outline ${cite(2)}.`])
          );
      }
    }

    // Cleanups: dedupe citations & strip any leftover fences
    htmlAnswer = dedupeCitations(stripFences(htmlAnswer));

    // 5) Return & fire-and-forget feedback webhook
    const publicSources: PublicSource[] = sources.map(({ id, title, url }) => ({ id, title, url }));

    postFeedback({
      ts: new Date().toISOString(),
      mode,
      question,
      answer_html: htmlAnswer,
      sources_json: JSON.stringify(publicSources),
      rating: "", // (optional UI later)
      confidence_band: "", // (optional heuristic later)
      confidence_pct: "", // (optional heuristic later)
      webhookUrl, // allow per-request override too
    }).catch(() => {});

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
