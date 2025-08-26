// app/api/answer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ---------- Types ----------
type TavilyItem = { url: string; title?: string; content?: string };
type TavilyResp = { results?: TavilyItem[] };

type Bullet = { text: string; cites: number[] };
type Section = { title: string; bullets: Bullet[] };
type LlmJson = { summary?: string; sections: Section[] };

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
      max_results: 8,
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

// ---------- HTML helpers ----------
function li(s: string) {
  return `<li>${s}</li>`;
}
function ul(items: string[]) {
  return `<ul>${items.map(li).join("")}</ul>`;
}
function sectionBlock(title: string, items: string[]) {
  if (!items.length) return "";
  return `<div style="margin:14px 0">
  <div style="font-weight:700">${title}</div>
  ${ul(items)}
</div>`;
}

// ---------- Mode detection ----------
type Mode = "radiology" | "emergency" | "ortho";

function detectMode(q: string): Mode {
  const s = q.toLowerCase();
  const radio = [
    "xray","x-ray","radiograph","ap view","lateral view","ct","computed tomography",
    "mri","ultrasound","usg","report","impression","findings","radiology","sequence"
  ].some(k => s.includes(k));
  const ed = [
    "er "," ed ","emergency","abcde","triage","resuscitation","resus","shock",
    "unstable","primary survey","secondary survey"
  ].some(k => s.includes(k));
  if (radio && !ed) return "radiology";
  if (ed) return "emergency";
  return "ortho";
}

function titlesFor(mode: Mode): string[] {
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

// ---------- Confidence scoring ----------
function sourceScore(url: string) {
  const u = url.toLowerCase();
  if (/\b(ncbi\.nlm\.nih\.gov|nih\.gov|who\.int|nice\.org|escardio|rcem|acep|uptodate)\b/.test(u)) return 3;
  if (/\b(pubmed|pmc|radiopaedia|radswiki|radiology|nature|bmj|nejm|thelancet|emcrit|emdocs)\b/.test(u)) return 2;
  return 1;
}
function confidenceLabel(urls: string[]) {
  const total = urls.length;
  const score = urls.reduce((s, u) => s + sourceScore(u), 0);
  const pct = Math.min(100, Math.round((score / Math.max(1, total * 3)) * 100));
  const band = pct >= 70 ? "High" : pct >= 45 ? "Moderate" : "Preliminary";
  return { band, pct };
}

// ---------- JSON extraction ----------
function extractJson(text: string): LlmJson | null {
  // remove code fences if present
  let t = text.replace(/```+json/gi, "```").replace(/```+/g, "").trim();
  // try direct parse
  try { return JSON.parse(t) as LlmJson; } catch {}
  // fallback: grab the first {...} block
  const m = t.match(/\{[\s\S]*\}$/);
  if (m) {
    try { return JSON.parse(m[0]) as LlmJson; } catch {}
  }
  return null;
}

// ---------- Main handler ----------
export async function POST(req: NextRequest) {
  try {
    const { question } = (await req.json()) as { question: string };
    if (!question || question.trim().length < 3) {
      return NextResponse.json({ error: "Ask a valid question." }, { status: 400 });
    }

    const mode = detectMode(question);
    const titles = titlesFor(mode);

    // 1) live search
    const hits = dedupeByUrl(await webSearch(question)).slice(0, 6);
    const sources = hits.map((h, i) => ({
      id: i + 1,
      title: h.title || h.url.replace(/^https?:\/\//, ""),
      url: h.url,
      content: (h.content || "").slice(0, 1200),
    }));
    if (!sources.length) {
      const empty = sectionBlock("No Sources", [
        "No reliable sources found. Try rephrasing the question or adding specifics.",
      ]);
      return NextResponse.json({ answer: empty, sources: [], mode, confidence: { band: "Preliminary", pct: 10 } });
    }

    // Numbered context for grounded generation
    const numbered = sources
      .map(s => `[${s.id}] ${s.title}\nURL: ${s.url}\nSNIPPET: ${s.content}`)
      .join("\n\n");

    const styleHint =
      mode === "radiology"
        ? "RADIOL0GY teaching style. Concise, exam-ready, specific imaging language."
        : mode === "emergency"
        ? "EMERGENCY medicine style. Actionable, ABCDE-first, disposition-oriented."
        : "ORTHOPAEDICS/TRAUMA style. Classification + stepwise management.";

    // 2) Force JSON with exact sections and 3–6 bullets each
    const prompt = `
You are a clinical summarizer for Indian medical students/junior residents.
Use ONLY the SOURCES below (numbered). Do NOT invent facts.

RETURN STRICT JSON (no markdown, no commentary) matching this TypeScript type:
{
  "summary": string,         // 1–2 lines: top takeaways
  "sections": [
    { "title": string, "bullets": [ { "text": string, "cites": number[] } ] }
  ]
}

RULES:
- Titles must be EXACTLY these, in order:
  ${titles.map(t => `- ${t}`).join("\n  ")}
- 3–6 bullets per section.
- Each bullet must end with bracketed numeric citations drawn ONLY from the SOURCES list (e.g., "[1]" or "[2,5]").
- Be specific and confident; avoid hedging. Prefer guideline/review facts.
- No HTML, no markdown, no code fences, no extra fields.

STYLE: ${styleHint}

USER QUESTION:
${question}

SOURCES (numbered):
${numbered}
`.trim();

    let htmlAnswer = "";
    let conf = { band: "Preliminary", pct: 25 };

    if (GEMINI_KEY) {
      try {
        const genAI = new GoogleGenerativeAI(GEMINI_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        // Use simple string form to keep TS happy
        const resp = await model.generateContent(prompt);
        const raw = (await resp.response.text()).trim();
        const data = extractJson(raw);

        if (data && Array.isArray(data.sections)) {
          // Build HTML deterministically from JSON
          const blocks = data.sections.map(sec => {
            // enforce allowed titles and non-empty bullets
            if (!titles.includes(sec.title)) return "";
            const items = (sec.bullets || [])
              .slice(0, 8)
              .map(b => {
                const cites = (b.cites || []).map(n => String(n)).join(", ");
                const txt = (b.text || "").replace(/\s*\d+(?:,\s*\d+)*$/,""); // avoid double cite
                return `${txt} [${cites}]`;
              })
              .filter(Boolean);
            return sectionBlock(sec.title, items);
          });

          const summaryBlock = data.summary
            ? `<div style="padding:10px 12px;border:1px solid #e6e6e6;border-radius:10px;background:#f8fafc;margin-top:6px;margin-bottom:12px;">
                 <div style="font-weight:700;margin-bottom:6px;">Top takeaways</div>
                 ${ul([data.summary])}
               </div>`
            : "";

          htmlAnswer = summaryBlock + blocks.join("");

          // confidence from domains/volume
          conf = confidenceLabel(sources.map(s => s.url));
        }
      } catch {
        // fall through to template below
      }
    }

    // 3) Template fallback (guarantee the 5 sections exist)
    if (!htmlAnswer) {
      const placeholder = (msg: string, cite: number) => `${msg} [${cite}]`;
      const safe = (i: number) => Math.min(Math.max(i, 1), sources.length);

      const blocks: string[] = [];
      if (mode === "radiology") {
        blocks.push(
          sectionBlock("Clinical Question", [placeholder("Define what the study must answer", safe(1))]),
          sectionBlock("Key Imaging Findings", [
            placeholder("Primary signs and measurements", safe(1)),
            placeholder("Ancillary findings that change management", safe(2)),
            placeholder("Report-worthy complications", safe(3)),
          ]),
          sectionBlock("Differential Diagnosis", [
            placeholder("Top 2–4 with discriminators", safe(2)),
            placeholder("Mimics to exclude", safe(3)),
          ]),
          sectionBlock("What to Look For", [
            placeholder("Checklist/pitfalls for this modality", safe(4)),
          ]),
          sectionBlock("Suggested Report Impression", [
            placeholder("One-line impression + next step/urgency", safe(1)),
          ])
        );
      } else if (mode === "emergency") {
        blocks.push(
          sectionBlock("Triage/Red Flags", [
            placeholder("Immediate threats to life/limb", safe(1)),
            placeholder("Indicators for resus bay", safe(2)),
          ]),
          sectionBlock("Initial Stabilization", [
            placeholder("ABCDE priorities", safe(1)),
            placeholder("Analgesia + immediate procedural needs", safe(2)),
          ]),
          sectionBlock("Focused Assessment", [
            placeholder("Key exam tests and monitoring", safe(3)),
          ]),
          sectionBlock("Immediate Management", [
            placeholder("Drugs/fluids/interventions with indications", safe(3)),
          ]),
          sectionBlock("Disposition/Follow-up", [
            placeholder("Admit vs discharge + review window", safe(2)),
          ])
        );
      } else {
        blocks.push(
          sectionBlock("Classification", [
            placeholder("Named system with criteria", safe(1)),
          ]),
          sectionBlock("Risk Factors", [
            placeholder("Mechanism/age pattern", safe(2)),
          ]),
          sectionBlock("Associated Injuries", [
            placeholder("Nerve/artery injuries to check", safe(3)),
          ]),
          sectionBlock("Initial Management", [
            placeholder("Analgesia, immobilization, consults", safe(1)),
          ]),
          sectionBlock("Definitive/Follow-up", [
            placeholder("When to reduce/pin; rehab & review", safe(2)),
          ])
        );
      }
      htmlAnswer = blocks.join("");
    }

    const publicSources = sources.map(({ id, title, url }) => ({ id, title, url }));
    return NextResponse.json({ answer: htmlAnswer, sources: publicSources, mode, confidence: conf }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Server error." }, { status: 500 });
  }
}
