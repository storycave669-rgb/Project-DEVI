// app/api/answer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* ------------------------- Types ------------------------- */
type TavilyItem = { url: string; title?: string; content?: string };
type TavilyResp = { results?: TavilyItem[] };

type Mode = "radiology" | "emergency" | "ortho";

/* --------------------- Environment ----------------------- */
const TAVILY_KEY = process.env.TAVILY_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";

/* ---------------------- Web Search ----------------------- */
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
        max_results: 10,
        // Nudge toward India-relevant guidance + high quality sources
        include_domains: [
          "aiims.edu",
          "icmr.gov.in",
          "nbe.edu.in",
          "mohfw.gov.in",
          "who.int",
          "pubmed.ncbi.nlm.nih.gov",
          "ncbi.nlm.nih.gov",
          "uptodate.com",
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

/* ----------------- Mode detection & titles --------------- */
function detectMode(q: string): Mode {
  const s = q.toLowerCase();

  const radioHits = [
    "xray",
    "x-ray",
    "xr ",
    "radiograph",
    "ap view",
    "lateral view",
    "ct",
    "computed tomography",
    "mri",
    "mr ",
    "ultrasound",
    "usg",
    "report",
    "impression",
    "findings",
    "sequence",
    "contrast",
    "t1",
    "t2",
    "stir",
  ].some((k) => s.includes(k));

  const edHits = [
    "ed ",
    " emergency",
    "triage",
    "abcde",
    "primary survey",
    "secondary survey",
    "hypotension",
    "shock",
    "resus",
    "resuscitation",
    "unstable",
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

/* -------------------- HTML helpers ----------------------- */
function buildHtmlFromJson(
  titles: string[],
  data: { sections?: Array<{ title?: string; bullets?: string[] }> }
) {
  // Map section title (lowercased) -> bullets
  const byTitle = new Map<string, string[]>();
  for (const sec of data.sections || []) {
    const t = (sec.title || "").trim().toLowerCase();
    if (!t) continue;
    const cleaned = (sec.bullets || [])
      .map((b) => (b || "").trim())
      .filter(
        (b) =>
          b &&
          !/^this section is not applicable/i.test(b) &&
          !/^not applicable/i.test(b) &&
          !/^no information provided/i.test(b)
      );
    if (cleaned.length) byTitle.set(t, cleaned);
  }

  const html: string[] = [];
  for (const wanted of titles) {
    const key = wanted.toLowerCase();
    const bullets = byTitle.get(key) || [];
    if (!bullets.length) continue; // hide empty sections

    // Deduplicate trailing repeated citations like "[5]. [5]"
    const items = bullets
      .map((b) => b.replace(/(\[\d+(?:,\s*\d+)*\])(\.\s*\1)+$/g, "$1"))
      .map((b) => `<li>${b}</li>`)
      .join("");

    html.push(
      `<div style="font-weight:700">${wanted}</div><ul>${items}</ul>`
    );
  }
  return html.join("");
}

function hardScrub(str: string) {
  // Remove leaked heading lines or not-applicable bullets if any sneak through
  return str
    .replace(/^(?:radiology|emergency|ortho):.*$/gim, "")
    .replace(
      /<li>[^<]*(?:not\s+applicable|no information provided)[^<]*<\/li>/gi,
      ""
    )
    .trim();
}

/* ----------------------- Handler ------------------------- */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { question?: string; mode?: Mode | "auto" };
    const question = (body?.question || "").trim();
    const inputMode = (body?.mode || "auto") as "auto" | Mode;

    if (!question || question.length < 3) {
      return NextResponse.json(
        { error: "Ask a valid question." },
        { status: 400 }
      );
    }

    const mode = inputMode === "auto" ? detectMode(question) : (inputMode as Mode);
    const titles = sectionTitles(mode);

    // 1) Live search
    const hits = await webSearch(question);
    const sources = hits.map((h, i) => ({
      id: i + 1,
      title: h.title || h.url.replace(/^https?:\/\//, ""),
      url: h.url,
      content: (h.content || "").slice(0, 1200),
    }));

    if (!sources.length) {
      const html = `<div style="font-style:italic">No reliable sources found for this query. Please rephrase or try a more specific question.</div>`;
      return NextResponse.json(
        { answer: html, sources: [], mode },
        { status: 200 }
      );
    }

    // 2) Build numbered context for Gemini
    const numberedContext = sources
      .map((s) => `[${s.id}] ${s.title}\nURL: ${s.url}\nSNIPPET: ${s.content}`)
      .join("\n\n");

    // 3) JSON-only prompt to prevent template leakage
    const jsonPrompt = `
Return ONLY JSON for the user's clinical question, no preface, no code fences.

Schema:
{
  "sections": [
    {"title":"${titles[0]}","bullets":["point [1]","point [2]"]},
    {"title":"${titles[1]}","bullets":["..."]},
    {"title":"${titles[2]}","bullets":["..."]},
    {"title":"${titles[3]}","bullets":["..."]},
    {"title":"${titles[4]}","bullets":["..."]}
  ]
}

Rules:
- 3–6 concise, high-yield bullets per section (never fewer than 3 if evidence permits).
- Use confident, guideline-style language (“is indicated”, “is appropriate”); avoid hedging (“may”, “often”) unless directly quoted by a source.
- Every bullet ends with numeric citations like [1] or [2,4] that refer ONLY to the provided SOURCES.
- Prefer guideline/systematic-review content; if evidence is thin, include pragmatic exam-relevant bullets grounded in common guidance.
- Do NOT write “not applicable”; if thin, give safe, generalizable teaching points with citations.
- Do NOT include any sections other than the five given titles.
- Output must be valid JSON. No extra text.

USER QUESTION:
${question}

SOURCES (numbered):
${numberedContext}
    `.trim();

    // 4) Call Gemini → JSON
    let htmlAnswer = "";
    if (GEMINI_KEY) {
      try {
        const genAI = new GoogleGenerativeAI(GEMINI_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const resp = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: jsonPrompt }] }],
          // Enforce JSON (supported by @google/generative-ai >=0.19)
          generationConfig: { responseMimeType: "application/json" } as any,
        });

        // Parse JSON (be defensive if model leaks text)
        let parsed: any = {};
        const rawText = await resp.response.text();
        try {
          parsed = JSON.parse(rawText);
        } catch {
          const m = rawText.match(/\{[\s\S]*\}$/);
          if (m) parsed = JSON.parse(m[0]);
        }

        htmlAnswer = buildHtmlFromJson(titles, parsed);
      } catch {
        // fall through to template
      }
    }

    // 5) Fallback template (guarantee 3 bullets/section)
    if (!htmlAnswer) {
      const safe = (i: number) => `[${Math.min(i, Math.max(1, sources.length))}]`;

      if (mode === "radiology") {
        const blocks = [
          {
            t: "Clinical Question",
            b: [
              `Summarize the clinical problem and modality/contrast to answer ${safe(1)}.`,
              `State the key diagnostic goal (rule-in/out, grading, complications) ${safe(1)}.`,
              `Mention any relevant prior imaging or comparison need ${safe(1)}.`,
            ],
          },
          {
            t: "Key Imaging Findings",
            b: [
              `Primary signs and critical measurements relevant to the diagnosis ${safe(1)}.`,
              `Complications or associated findings to actively search for ${safe(2)}.`,
              `Severity features that impact management/disposition ${safe(3)}.`,
            ],
          },
          {
            t: "Differential Diagnosis",
            b: [
              `Top 2–4 differentials with discriminators on imaging ${safe(2)}.`,
              `Briefly note when to escalate imaging (e.g., CT/MRI) ${safe(3)}.`,
              `Flag mimics/pitfalls to avoid misinterpretation ${safe(2)}.`,
            ],
          },
          {
            t: "What to Look For",
            b: [
              `Checklist for the modality (windowing/planes/measurements) ${safe(1)}.`,
              `Sites commonly missed and how to systematically review them ${safe(2)}.`,
              `Reportable incidental but management-changing findings ${safe(3)}.`,
            ],
          },
          {
            t: "Suggested Report Impression",
            b: [
              `One-line diagnosis + severity and side/site ${safe(1)}.`,
              `Complication status and immediate recommended action ${safe(2)}.`,
              `If equivocal: short recommendation for next best test ${safe(3)}.`,
            ],
          },
        ];
        htmlAnswer = blocks
          .map(
            (blk) =>
              `<div style="font-weight:700">${blk.t}</div><ul>${blk.b
                .map((x) => `<li>${x}</li>`)
                .join("")}</ul>`
          )
          .join("");
      } else if (mode === "emergency") {
        const blocks = [
          {
            t: "Triage/Red Flags",
            b: [
              `Immediate threats to airway/breathing/circulation ${safe(1)}.`,
              `Physiologic triggers for urgent intervention (e.g., hypotension, GCS) ${safe(2)}.`,
              `High-risk mechanisms or comorbidities that change pathway ${safe(3)}.`,
            ],
          },
          {
            t: "Initial Stabilization",
            b: [
              `ABCDE with analgesia and early imaging/POCUS where indicated ${safe(1)}.`,
              `IV/IO access, resuscitation targets and monitoring ${safe(2)}.`,
              `Early consult/activation criteria (ortho/trauma/neuro/etc.) ${safe(3)}.`,
            ],
          },
          {
            t: "Focused Assessment",
            b: [
              `Key exam maneuvers and neurovascular checks to document ${safe(1)}.`,
              `Decision points for imaging and labs ${safe(2)}.`,
              `Screen for associated injuries and complications ${safe(3)}.`,
            ],
          },
          {
            t: "Immediate Management",
            b: [
              `Definitive actions (reduction/splint, antibiotics/tetanus where appropriate) ${safe(1)}.`,
              `Analgesia/sedation strategy and post-procedure checks ${safe(2)}.`,
              `Escalation criteria for OR/ICU ${safe(3)}.`,
            ],
          },
          {
            t: "Disposition/Follow-up",
            b: [
              `Admit vs discharge with clear return precautions ${safe(1)}.`,
              `Follow-up timing and rehab/weight-bearing advice ${safe(2)}.`,
              `Documentation pearls (neurovascular status, consent, complications) ${safe(3)}.`,
            ],
          },
        ];
        htmlAnswer = blocks
          .map(
            (blk) =>
              `<div style="font-weight:700">${blk.t}</div><ul>${blk.b
                .map((x) => `<li>${x}</li>`)
                .join("")}</ul>`
          )
          .join("");
      } else {
        // Ortho
        const blocks = [
          {
            t: "Classification",
            b: [
              `Standard classification and key radiographic features ${safe(1)}.`,
              `Subtypes relevant for management decisions ${safe(2)}.`,
              `Stability indicators and prognostic factors ${safe(3)}.`,
            ],
          },
          {
            t: "Risk Factors",
            b: [
              `Typical mechanism/age/setting in the Indian context ${safe(1)}.`,
              `Situations that predict complications or failure of conservative care ${safe(2)}.`,
              `Red-flag comorbidities that change management ${safe(3)}.`,
            ],
          },
          {
            t: "Associated Injuries",
            b: [
              `Nerve and artery risks; how to document and re-check ${safe(1)}.`,
              `Joint injuries and common fracture companions ${safe(2)}.`,
              `When to involve other teams early ${safe(3)}.`,
            ],
          },
          {
            t: "Initial Management",
            b: [
              `ABCDE, analgesia, immobilization/splinting options ${safe(1)}.`,
              `Indications for reduction/pinning vs conservative care ${safe(2)}.`,
              `Imaging follow-up schedule and complications to monitor ${safe(3)}.`,
            ],
          },
          {
            t: "Definitive/Follow-up",
            b: [
              `Operative/non-operative pathways with criteria ${safe(1)}.`,
              `Rehab milestones and return-to-activity advice ${safe(2)}.`,
              `When to escalate if alignment/pain/neurovascular worsen ${safe(3)}.`,
            ],
          },
        ];
        htmlAnswer = blocks
          .map(
            (blk) =>
              `<div style="font-weight:700">${blk.t}</div><ul>${blk.b
                .map((x) => `<li>${x}</li>`)
                .join("")}</ul>`
          )
          .join("");
      }
    }

    // 6) Final scrub & return
    htmlAnswer = hardScrub(htmlAnswer);
    const publicSources = sources.map(({ id, title, url }) => ({ id, title, url }));

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
