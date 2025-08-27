// app/api/answer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* ====================== Types ====================== */
type Mode = "radiology" | "emergency" | "ortho";
type TavilyItem = { url: string; title?: string; content?: string };
type TavilyResp = { results?: TavilyItem[] };

/* ====================== Env ====================== */
const TAVILY_KEY = process.env.TAVILY_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const FEEDBACK_WEBHOOK_URL = process.env.FEEDBACK_WEBHOOK_URL || "";

/* ====================== Utilities ====================== */
function detectMode(q: string): Mode {
  const s = q.toLowerCase();

  const radioHits = [
    "xray","x-ray","xr","radiograph","ap view","lateral view",
    "ct","computed tomography","mri","mr imaging","ultrasound","usg",
    "report","impression","findings","sequence","t1","t2","stir"
  ].some(k => s.includes(k));

  const edHits = [
    "ed "," emergency","triage","resus","resuscitation","abcde",
    "primary survey","secondary survey","hypotension","shock",
    "er approach","initial stabilization"
  ].some(k => s.includes(k));

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

function ul(items: string[]) {
  return `<ul style="margin:6px 0 0; padding-left: 20px">${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
}
function sec(title: string, items: string[]) {
  if (!items.length) return "";
  return `<div style="margin-bottom:14px"><div style="font-weight:700">${title}</div>${ul(items)}</div>`;
}

// Deduplicate ugly “[3]. [3]”, “[1, 2]. [1, 2]”, etc.
function dedupeCitations(html: string) {
  return html.replace(/(\[\d+(?:\s*,\s*\d+)*\])(?:\s*\.\s*)?\s*\1/gg, "$1");
}

// Strip ```html fences if model returns them
function stripCodeFences(s: string) {
  return s.replace(/^```(?:html)?\s*/i, "").replace(/```$/i, "").trim();
}

/* ====================== Tavily Search ====================== */
async function webSearch(query: string): Promise<TavilyItem[]> {
  if (!TAVILY_KEY) return [];
  try {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query,
        search_depth: "advanced",
        include_answer: false,
        max_results: 10,
        // Light India/context bias without excluding global guidelines
        include_domains: [
          "aiims.edu",
          "icmr.gov.in",
          "nbe.edu.in",
          "who.int",
          "uptodate.com",
          "ncbi.nlm.nih.gov",
          "pubmed.ncbi.nlm.nih.gov",
          "radiopaedia.org",
          "rcem.ac.uk",
          "acep.org"
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

/* ====================== Main ====================== */
export async function POST(req: NextRequest) {
  try {
    const { question } = (await req.json()) as { question?: string };
    if (!question || question.trim().length < 3) {
      return NextResponse.json({ error: "Ask a valid question." }, { status: 400 });
    }

    const mode = detectMode(question);
    const titles = sectionTitles(mode);

    // 1) Search
    const hits = await webSearch(question);
    const sources = hits.map((h, i) => ({
      id: i + 1,
      title: h.title || h.url.replace(/^https?:\/\//, ""),
      url: h.url,
      content: (h.content || "").slice(0, 1400),
    }));

    if (!sources.length) {
      const msg = `<div style="margin-bottom:14px"><div style="font-weight:700">No Sources</div>${ul([
        "No reliable sources found for this query. Try rephrasing or asking a narrower question.",
      ])}</div>`;
      // best-effort webhook log
      if (FEEDBACK_WEBHOOK_URL) {
        fetch(FEEDBACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ts: new Date().toISOString(),
            mode,
            question,
            answer_html: msg,
            sources_json: "[]",
            rating: null,
            confidence_band: "low",
            confidence_pct: 0,
          }),
        }).catch(() => {});
      }
      return NextResponse.json({ answer: msg, sources: [], mode }, { status: 200 });
    }

    // 2) Build numbered context for the model
    const numberedContext = sources
      .map(s => `[${s.id}] ${s.title}\nURL: ${s.url}\nSNIPPET: ${s.content}`)
      .join("\n\n");

    const sectionList = titles.map((t, i) => `${i + 1}) ${t}`).join("\n");

    const audience =
      mode === "radiology"
        ? "Radiology viva style for Indian JR/consultant use"
        : mode === "emergency"
        ? "Emergency medicine guideline style for Indian JR/consultant use"
        : "Orthopaedics viva/ward-round style for Indian JR/consultant use";

    const prompt = `
You are a clinical summarizer. Use ONLY the SOURCES block. If a fact is absent, omit it.

Audience: ${audience}.
Tone: confident, guideline-like (avoid “may/might/often” unless guidelines say so).

TASK: Produce concise, exam-ready bullets under these exact sections:
${sectionList}

Rules:
- 3–6 bullets per section (never fewer than 3 if information exists).
- Each bullet ends with inline numeric citations like [1] or [2, 5] mapped ONLY to the provided source numbers.
- Prioritize guideline/consensus and high-quality reviews.
- Output VALID HTML only. For each section use exactly:
  <div style="font-weight:700">Section Title</div>
  <ul><li>bullet [n]</li>...</ul>
- Do NOT include any extra headings, preambles, conclusions, or a “Sources” list.
- Do NOT include sections for other modes.

SOURCES:
${numberedContext}
`.trim();

    // 3) Call Gemini
    let html = "";
    if (GEMINI_KEY) {
      try {
        const genAI = new GoogleGenerativeAI(GEMINI_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        let text = result.response.text();
        text = stripCodeFences(text);

        const looksHtml = /<div[^>]*>.*<\/div>/is.test(text) || /<ul>/.test(text);
        if (looksHtml) html = text;
      } catch {
        // swallow; we’ll fall back
      }
    }

    // 4) Fallback templating if LLM failed
    if (!html) {
      const safe = (i: number) => `[${Math.min(i, sources.length)}]`;
      if (mode === "radiology") {
        html =
          sec("Clinical Question", [
            `What the study needs to answer ${safe(1)}.`,
            `Clinical context that narrows differentials ${safe(2)}.`,
            `Urgency/next study implications ${safe(3)}.`,
          ]) +
          sec("Key Imaging Findings", [
            `Primary signs and key measurements ${safe(1)}.`,
            `Ancillary findings that shift probability ${safe(2)}.`,
            `Complications to mention explicitly ${safe(3)}.`,
          ]) +
          sec("Differential Diagnosis", [
            `Top 2–4 entities with discriminators ${safe(2)}.`,
            `Mention classic signs and traps ${safe(3)}.`,
            `State which is most consistent given data ${safe(1)}.`,
          ]) +
          sec("What to Look For", [
            `Checklist of must-see structures ${safe(3)}.`,
            `Technique pitfalls and fixes ${safe(2)}.`,
            `Key measurements/angles to include ${safe(1)}.`,
          ]) +
          sec("Suggested Report Impression", [
            `One-liner diagnosis with certainty qualifier ${safe(1)}.`,
            `Immediate actionable next step (if any) ${safe(2)}.`,
            `Red flags to escalate now ${safe(3)}.`,
          ]);
      } else if (mode === "emergency") {
        html =
          sec("Triage/Red Flags", [
            `Threats to airway/breathing/circulation requiring immediate action ${safe(1)}.`,
            `Physiologic triggers (SBP, GCS, RR, SpO2) for red room ${safe(2)}.`,
            `Time-critical differentials not to miss ${safe(3)}.`,
          ]) +
          sec("Initial Stabilization", [
            `ABCDE with analgesia/antibiotics/tetanus where indicated ${safe(1)}.`,
            `Early resuscitation targets and fluids/blood ${safe(2)}.`,
            `Spine/limb immobilization and hemorrhage control ${safe(3)}.`,
          ]) +
          sec("Focused Assessment", [
            `Key exam points (neurovascular, compartments, special tests) ${safe(2)}.`,
            `Bedside imaging/labs that change management now ${safe(1)}.`,
            `Risk scores or rules if applicable ${safe(3)}.`,
          ]) +
          sec("Immediate Management", [
            `Definitive temporizing steps (reduction, splint, meds) ${safe(1)}.`,
            `Consult triggers and time windows ${safe(2)}.`,
            `Contraindications/avoid common errors ${safe(3)}.`,
          ]) +
          sec("Disposition/Follow-up", [
            `Admit vs discharge criteria ${safe(2)}.`,
            `Follow-up timing and return precautions ${safe(3)}.`,
            `Patient education pearls ${safe(1)}.`,
          ]);
      } else {
        html =
          sec("Classification", [
            `Standard classification and defining features ${safe(1)}.`,
            `Radiographic criteria that separate types ${safe(2)}.`,
            `Implications for treatment pathway ${safe(3)}.`,
          ]) +
          sec("Risk Factors", [
            `Mechanism and age patterns ${safe(1)}.`,
            `Comorbids/contexts that change management ${safe(2)}.`,
            `Injury patterns that co-travel ${safe(3)}.`,
          ]) +
          sec("Associated Injuries", [
            `Nerve/artery at risk and how to document ${safe(1)}.`,
            `Joint/soft tissue injuries to consider ${safe(2)}.`,
            `Compartment or skin risks ${safe(3)}.`,
          ]) +
          sec("Initial Management", [
            `ABCDE, analgesia, immobilization, ortho consult ${safe(1)}.`,
            `Imaging/labs immediately needed ${safe(2)}.`,
            `Indications for reduction in ED ${safe(3)}.`,
          ]) +
          sec("Definitive/Follow-up", [
            `Clear indications for operative vs non-operative ${safe(1)}.`,
            `Rehab and clinic follow-up timing ${safe(2)}.`,
            `Complication surveillance (malunion, NV compromise) ${safe(3)}.`,
          ]);
      }
    }

    // 5) Final polish + response
    html = dedupeCitations(html);
    const publicSources = sources.map(({ id, title, url }) => ({ id, title, url }));

    // 6) Fire-and-forget feedback webhook (non-blocking)
    if (FEEDBACK_WEBHOOK_URL) {
      try {
        fetch(FEEDBACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ts: new Date().toISOString(),
            mode,
            question,
            answer_html: html,
            sources_json: JSON.stringify(publicSources),
            rating: null,                 // you can fill later from UI
            confidence_band: "medium",    // simple default
            confidence_pct: 70,
          }),
        }).catch(() => {});
      } catch {}
    }

    return NextResponse.json({ answer: html, sources: publicSources, mode }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error." }, { status: 500 });
  }
}
