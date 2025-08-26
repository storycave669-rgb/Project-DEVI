// app/api/answer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

// ---------- Types ----------
type TavilyItem = { url: string; title?: string; content?: string };
type TavilyResp = { results?: TavilyItem[] };

type Mode = "radiology" | "emergency" | "ortho";

// ---------- Env ----------
const TAVILY_KEY = process.env.TAVILY_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";

// ---------- Search ----------
async function webSearch(q: string): Promise<TavilyItem[]> {
  if (!TAVILY_KEY) return [];
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_KEY,
      query: q,
      search_depth: "advanced",
      include_answer: false,
      max_results: 10,
      include_domains: [
        "pubmed.ncbi.nlm.nih.gov",
        "radiopaedia.org",
        "orthobullets.com",
        "ncbi.nlm.nih.gov",
        "aiims.edu",
        "icmr.gov.in",
        "nbe.edu.in",
        "who.int",
        "uptodate.com"
      ],
    }),
  });
  if (!r.ok) return [];
  const data: TavilyResp = await r.json();
  return data.results ?? [];
}

function dedupeByUrl(items: TavilyItem[]) {
  const seen = new Set<string>();
  const out: TavilyItem[] = [];
  for (const it of items) {
    const key = (it.url || "").replace(/[#?].*$/, "");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

// ---------- Mode detection ----------
function detectMode(q: string): Mode {
  const s = q.toLowerCase();
  const radio = [
    "xray","x-ray","radiograph","ap view","lateral view",
    "ct","computed tomography","mri","ultrasound","usg",
    "report","impression","findings","radiology","sequence","t1","t2","stir"
  ].some(k => s.includes(k));
  const ed = [
    " emergency"," er "," ed ","triage","abcde","resus","resuscitation",
    "shock","unstable","primary survey","secondary survey","trauma bay"
  ].some(k => s.includes(k));
  if (radio && !ed) return "radiology";
  if (ed) return "emergency";
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
  return [
    "Classification",
    "Risk Factors",
    "Associated Injuries",
    "Initial Management",
    "Definitive/Follow-up",
  ];
}

// ---------- HTML helpers ----------
function cleanCitations(text: string): string {
  // [5]. [5] -> [5]
  return text.replace(/(\d+(?:,\s*\d+)*)(\.\s*\1)+/g, "$1");
}
function stripFences(s: string) {
  return s.replace(/```+(\w+)?/g, "").trim();
}
function pruneHtml(html: string) {
  let out = stripFences(html);
  // remove "not specified" bullets
  out = out.replace(/<li>[^<]*not\s+specified[^<]*<\/li>/gi, "");
  // collapse duplicate cites in bullets
  out = cleanCitations(out);
  // drop empty lists
  out = out.replace(/<ul>\s*<\/ul>/gi, "");
  // drop section titles with no list after them
  out = out.replace(
    /<div[^>]*font-weight:700[^>]*>[^<]*<\/div>\s*(?=<div|$)/gi,
    ""
  );
  return out.trim();
}

function li(s: string) {
  return `<li>${cleanCitations(s)}</li>`;
}
function ul(items: string[]) {
  return `<ul>${items.map(li).join("")}</ul>`;
}
function sectionBlock(title: string, items: string[]) {
  if (!items.length) return "";
  return `<div style="font-weight:700">${title}</div>${ul(items)}`;
}

// ---------- Handler ----------
export async function POST(req: NextRequest) {
  try {
    const { question } = (await req.json()) as { question?: string };
    if (!question || question.trim().length < 3) {
      return NextResponse.json({ error: "Ask a valid question." }, { status: 400 });
    }

    const mode = detectMode(question);
    const titles = sectionTitles(mode);

    // 1) Search + sources
    const hits = dedupeByUrl(await webSearch(question)).slice(0, 8);
    const sources = hits.map((h, i) => ({
      id: i + 1,
      title: h.title || h.url.replace(/^https?:\/\//, ""),
      url: h.url,
      content: (h.content || "").slice(0, 1100),
    }));

    if (!sources.length) {
      const html =
        `<div style="font-weight:700">No reliable sources found</div>` +
        ul([
          "Rephrase the question with specifics (age, modality, mechanism).",
          "Try including a key term (e.g., 'Gartland', 'CT PE', 'ABCDE').",
        ]);
      return NextResponse.json({ answer: html, sources: [], mode }, { status: 200 });
    }

    // 2) Numbered context for citations
    const numberedContext = sources
      .map(s => `[${s.id}] ${s.title}\nURL: ${s.url}\nSNIPPET: ${s.content}`)
      .join("\n\n");

    // 3) Prompt (JR/consultant style; strict format; assertive tone)
    const prompt = `
You are a clinical summarizer for Indian junior residents and consultants.
Use ONLY the SOURCES (numbered) below. Do NOT invent facts.

OUTPUT STRICTLY as VALID HTML sections. EXACTLY these 5 section titles (based on mode):
- Radiology: Clinical Question, Key Imaging Findings, Differential Diagnosis, What to Look For, Suggested Report Impression
- Emergency: Triage/Red Flags, Initial Stabilization, Focused Assessment, Immediate Management, Disposition/Follow-up
- Ortho: Classification, Risk Factors, Associated Injuries, Initial Management, Definitive/Follow-up

RULES:
- 3–6 bullets per section. If sources are thin, include safe, exam-relevant bullets grounded in common guidance.
- Use confident, guideline-style language. Avoid hedging words: “may”, “often”, “possibly”. Prefer “is indicated”, “is appropriate”.
- Each bullet ENDS with numeric citations in brackets like [1] or [2,4] that refer ONLY to the source numbers below.
- NO extra sections (no “Top takeaways”, no intro, no conclusion).
- HTML pattern per section:
  <div style="font-weight:700">Section Title</div>
  <ul><li>bullet [n]</li>...</ul>

PREFER SOURCES:
- PubMed/NCBI, WHO/ATLS, AIIMS/ICMR/NBE (.gov.in), Radiopaedia, Orthobullets, UpToDate.

USER QUESTION:
${question}

SOURCES (numbered):
${numberedContext}
`.trim();

    // 4) Call Gemini
    let htmlAnswer = "";
    if (GEMINI_KEY) {
      try {
        const genAI = new GoogleGenerativeAI(GEMINI_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const resp = await model.generateContent(prompt);
        const raw = await resp.response.text();
        const cleaned = pruneHtml(raw);
        const looksHtml = /<div[^>]*font-weight:700[^>]*>/.test(cleaned) && /<ul>/.test(cleaned);
        if (looksHtml) htmlAnswer = cleaned;
      } catch {
        // fall through to fallback
      }
    }

    // 5) Fallback (guarantee ≥3 bullets/section)
    if (!htmlAnswer) {
      const safe = (i: number) => `[${Math.min(Math.max(i, 1), sources.length)}]`;
      const pad3 = (arr: string[], fallback: string[]) =>
        (arr.length >= 3 ? arr : [...arr, ...fallback].slice(0, 3));

      if (mode === "radiology") {
        htmlAnswer =
          sectionBlock("Clinical Question", pad3([
            `Define what the study must answer ${safe(1)}`,
          ], [`Clinical indication and phase of care ${safe(2)}`, `Relevance to management decision ${safe(3)}`])) +
          sectionBlock("Key Imaging Findings", pad3([
            `Primary signs and essential measurements ${safe(1)}`,
            `Ancillary findings that change management ${safe(2)}`
          ], [`Complications to report (e.g., malalignment, NV compromise) ${safe(3)}`])) +
          sectionBlock("Differential Diagnosis", pad3([
            `Top 2–4 entities with discriminators ${safe(2)}`
          ], [`Common mimics to exclude ${safe(3)}`, `When advanced imaging is indicated ${safe(4)}`])) +
          sectionBlock("What to Look For", pad3([
            `Checklist/pitfalls for this modality ${safe(4)}`
          ], [`Views/sequences critical for diagnosis ${safe(2)}`, `Compare with prior imaging if available ${safe(1)}`])) +
          sectionBlock("Suggested Report Impression", pad3([
            `Concise impression with urgency/next step ${safe(1)}`
          ], [`Correlation with clinic/labs when needed ${safe(2)}`, `Clear recommendation if management changes ${safe(3)}`]));
      } else if (mode === "emergency") {
        htmlAnswer =
          sectionBlock("Triage/Red Flags", pad3([
            `Immediate life/limb threats; activate resus if present ${safe(1)}`
          ], [`Indications for urgent specialist call ${safe(2)}`, `Early antibiotics/antitetanus where appropriate ${safe(3)}`])) +
          sectionBlock("Initial Stabilization", pad3([
            `ABCDE priorities with analgesia ${safe(1)}`
          ], [`Immobilize/splint as indicated ${safe(2)}`, `Hemodynamic targets and monitoring ${safe(3)}`])) +
          sectionBlock("Focused Assessment", pad3([
            `Neurovascular exam and key decision points ${safe(2)}`
          ], [`Mechanism of injury and risk stratification ${safe(3)}`, `Indications for imaging/labs ${safe(4)}`])) +
          sectionBlock("Immediate Management", pad3([
            `Reduction/traction/sedation criteria ${safe(2)}`
          ], [`Antibiotics/tetanus/anticoagulation where indicated ${safe(3)}`, `Analgesia and compartment checks ${safe(4)}`])) +
          sectionBlock("Disposition/Follow-up", pad3([
            `Admit vs discharge criteria with review window ${safe(2)}`
          ], [`Explicit return precautions ${safe(3)}`, `Documentation essentials ${safe(4)}`]));
      } else {
        // Ortho default
        htmlAnswer =
          sectionBlock("Classification", pad3([
            `Named system with defining criteria ${safe(1)}`
          ], [`Radiographic features to state ${safe(2)}`, `Instability indicators ${safe(3)}`])) +
          sectionBlock("Risk Factors", pad3([
            `Mechanism/age pattern relevant in India ${safe(2)}`
          ], [`Injury energy and contamination level ${safe(3)}`, `Comorbidities impacting healing ${safe(4)}`])) +
          sectionBlock("Associated Injuries", pad3([
            `Nerve injuries to document and follow ${safe(2)}`
          ], [`Arterial injury risk; pulses/capillary refill ${safe(3)}`, `Compartment syndrome red flags ${safe(4)}`])) +
          sectionBlock("Initial Management", pad3([
            `Analgesia, immobilization, and consults ${safe(1)}`
          ], [`When to reduce urgently ${safe(2)}`, `Imaging views needed before/after reduction ${safe(3)}`])) +
          sectionBlock("Definitive/Follow-up", pad3([
            `Indications for fixation vs non-op ${safe(2)}`
          ], [`Rehab milestones and clinic review ${safe(3)}`, `Document neurovascular status post-treatment ${safe(4)}`]));
      }
    }

    const publicSources = sources.map(({ id, title, url }) => ({ id, title, url }));
    return NextResponse.json({ answer: htmlAnswer, sources: publicSources, mode }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error." }, { status: 500 });
  }
}
