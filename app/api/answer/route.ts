// app/api/answer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ---------- Types ----------
type TavilyItem = { url: string; title?: string; content?: string };
type TavilyResp = { results?: TavilyItem[] };

// ---------- Env ----------
const TAVILY_KEY = process.env.TAVILY_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";

// ---------- Tavily search ----------
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
      max_results: 6,
    }),
  });
  if (!r.ok) return [];
  const data: TavilyResp = await r.json();
  return data.results ?? [];
}

// ---------- Minimal HTML helpers ----------
function ul(items: string[]) {
  return `<ul style="margin:6px 0 0; padding-left:22px">${items
    .map((i) => `<li>${i}</li>`)
    .join("")}</ul>`;
}

function sec(title: string, items: string[]) {
  if (!items.length) return "";
  return `<div style="margin-bottom:16px"><div style="font-weight:700">${title}</div>${ul(
    items
  )}</div>`;
}

// ---------- Mode detection ----------
type Mode = "radiology" | "emergency" | "ortho";

function detectMode(q: string): Mode {
  const s = q.toLowerCase();

  const radioHits = [
    "xray",
    "x-ray",
    "radiograph",
    "ct",
    "computed tomography",
    "mri",
    "ultrasound",
    "usg",
    "report",
    "impression",
    "differential",
    "findings",
    "sequence",
    "stir",
    "t1",
    "t2",
  ].some((k) => s.includes(k));

  const edHits = [
    "ed ",
    " emergency",
    "triage",
    "resus",
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
  if (mode === "radiology")
    return [
      "Clinical Question",
      "Key Imaging Findings",
      "Differential Diagnosis",
      "What to Look For",
      "Suggested Report Impression",
    ];

  if (mode === "emergency")
    return [
      "Triage/Red Flags",
      "Initial Stabilization",
      "Focused Assessment",
      "Immediate Management",
      "Disposition/Follow-up",
    ];

  // Ortho default
  return [
    "Classification",
    "Risk Factors",
    "Associated Injuries",
    "Initial Management",
    "Definitive/Follow-up",
  ];
}

// ---------- POST handler ----------
export async function POST(req: NextRequest) {
  try {
    const { question } = (await req.json()) as { question?: string };
    if (!question || question.trim().length < 3) {
      return NextResponse.json(
        { error: "Ask a valid question." },
        { status: 400 }
      );
    }

    const mode = detectMode(question);
    const titles = sectionTitlesFor(mode);

    // 1) Live search
    const hits = await webSearch(question);
    const sources = hits.map((h, i) => ({
      id: i + 1,
      title: h.title || h.url.replace(/^https?:\/\//, ""),
      url: h.url,
      content: (h.content || "").slice(0, 1200),
    }));

    if (sources.length === 0) {
      const html =
        `<div style="font-weight:700">No reliable sources found</div>` +
        ul([
          "Try rephrasing your question.",
          "Include clinical context (age, mechanism, modality, etc.).",
        ]);
      return NextResponse.json(
        { answer: html, sources: [], mode },
        { status: 200 }
      );
    }

    // 2) Numbered context for citations
    const numberedContext = sources
      .map(
        (s) =>
          `[${s.id}] ${s.title}\nURL: ${s.url}\nSNIPPET: ${s.content}`
      )
      .join("\n\n");

    const modeHint =
      mode === "radiology"
        ? "RADIology style for Indian medical students/junior residents. Focus on imaging findings, differentials, and an exam-ready impression."
        : mode === "emergency"
        ? "EMERGENCY MEDICINE style for Indian medical students/junior residents. Focus on triage, stabilization, immediate management, and disposition."
        : "ORTHO/TRAUMA style for Indian medical students/junior residents. Focus on classification and stepwise management.";

    const sectionList = titles.map((t, i) => `${i + 1}) ${t}`).join("\n");

    const systemPrompt = `
You are a clinical summarizer. Use ONLY the provided sources. If a fact is absent, omit it. Never invent.

Audience: ${modeHint}

TASK: For the user's question, produce concise, high-yield bullets under these sections:
${sectionList}

STRICT RULES:
- Each bullet must end with inline numeric citations like [1] or [2, 5], matching the source numbers below.
- Cite ONLY numbers from the provided SOURCES.
- Keep bullets short and practical. Avoid fluff.
- If a section has no facts supported by the sources, OMIT that section entirely.
- Output VALID HTML only. For each section, render exactly:
  <div style="font-weight:700">Section Title</div>
  <ul><li>bullet [n]</li>...</ul>

SOURCES (numbered):
${numberedContext}
`.trim();

    // 3) Call Gemini (safe signature, no role/parts types)
    let htmlAnswer = "";
    if (GEMINI_KEY) {
      try {
        const genAI = new GoogleGenerativeAI(GEMINI_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const result = await model.generateContent(
          `Question: ${question}\n\n${systemPrompt}`
        );

        // raw text and strip ``` fences if present
        let raw = result.response.text().trim();
        raw = raw
          .replace(/^```(?:html)?\s*/i, "")
          .replace(/```$/i, "")
          .trim();

        // drop "Not specified ..." bullets the model might add
        raw = raw.replace(
          /<li>[^<]*not specified[^<]*<\/li>/gi,
          ""
        );

        // remove empty <ul></ul> blocks and sections that became empty
        raw = raw
          .replace(/<ul>\s*<\/ul>/gi, "")
          .replace(
            /<div[^>]*font-weight:700[^>]*>[^<]*<\/div>\s*(?:<ul>\s*<\/ul>)?/gi,
            (m) => {
              // if a section title is followed by nothing, drop the whole block
              return /<\/div>\s*$/.test(m) ? "" : m;
            }
          );

        const looksHtml =
          /<div[^>]*font-weight:700[^>]*>/.test(raw) || /<ul>/.test(raw);

        if (looksHtml) {
          htmlAnswer = raw;
        } else {
          // Fallback: light parser to build sections from plain text
          const blocks = raw
            .split(/\n{2,}/)
            .map((b) => b.trim())
            .filter(Boolean);

          const mkBullets = (body: string) =>
            body
              .split(/\n|\r/)
              .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
              .filter(Boolean);

          type S = { title: string; items: string[] };
          const acc: S[] = titles.map((t) => ({ title: t, items: [] }));

          blocks.forEach((b) => {
            for (const sec of acc) {
              const re = new RegExp(
                `^\\s*(?:<b>)?${sec.title}[:：]?(?:</b>)?\\s*`,
                "i"
              );
              if (re.test(b)) {
                const body = b.replace(re, "").trim();
                const items = mkBullets(body).filter(
                  (x) => !/not specified/i.test(x)
                );
                sec.items.push(...items);
                return;
              }
            }
          });

          const any = acc.some((s) => s.items.length);
          htmlAnswer = any
            ? acc.map((s) => sec(s.title, s.items)).join("")
            : sec(titles[0], raw.split(/\n+/).slice(0, 8));
        }
      } catch {
        // swallow and use template fallback
      }
    }

    // 4) Template fallback (never empty)
    if (!htmlAnswer) {
      const safe = (i: number) => `[${i}]`;
      if (mode === "radiology") {
        htmlAnswer =
          sec("Clinical Question", [
            `What the study needs to answer ${safe(1)}.`,
          ]) +
          sec("Key Imaging Findings", [
            `Primary signs, relevant measurements ${safe(1)}.`,
          ]) +
          sec("Differential Diagnosis", [
            `Top 2–4 with discriminators ${safe(2)}.`,
          ]) +
          sec("What to Look For", [
            `Checklists/pitfalls on modality ${safe(3)}.`,
          ]) +
          sec("Suggested Report Impression", [
            `One-liner impression with urgency/next step ${safe(1)}.`,
          ]);
      } else if (mode === "emergency") {
        htmlAnswer =
          sec("Triage/Red Flags", [
            `Airway/breathing/circulation threats ${safe(1)}.`,
          ]) +
          sec("Initial Stabilization", [
            `ABCDE, analgesia, splint/immobilize as needed ${safe(1)}.`,
          ]) +
          sec("Focused Assessment", [
            `Neurovascular, mechanism, critical exam points ${safe(2)}.`,
          ]) +
          sec("Immediate Management", [
            `Analgesia, reduction indications, antibiotics/tetanus when appropriate ${safe(3)}.`,
          ]) +
          sec("Disposition/Follow-up", [
            `Admit vs discharge with time-bound review ${safe(2)}.`,
          ]);
      } else {
        htmlAnswer =
          sec("Classification", [
            `Key type(s) & radiographic features ${safe(1)}.`,
          ]) +
          sec("Risk Factors", [
            `Mechanism, age, typical context in India ${safe(2)}.`,
          ]) +
          sec("Associated Injuries", [
            `Nerve/artery risks; what to document ${safe(3)}.`,
          ]) +
          sec("Initial Management", [
            `ABCDE, analgesia, immobilization, ortho consult ${safe(1)}.`,
          ]) +
          sec("Definitive/Follow-up", [
            `Indications for reduction/pinning; rehab; follow-up ${safe(2)}.`,
          ]);
      }
    }

    // 5) Return (only id/title/url for client)
    const publicSources = sources.map(({ id, title, url }) => ({
      id,
      title,
      url,
    }));
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
