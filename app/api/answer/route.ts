import { NextResponse } from "next/server";

// ---- ENV KEYS (set these in Vercel after this step) ----
const TAVILY_KEY = process.env.TAVILY_API_KEY!;
const GEMINI_KEY = process.env.GEMINI_API_KEY!;
const MODEL = "gemini-2.0-flash-exp"; // if not available, switch to "gemini-1.5-flash"

// Tavily live web search
async function tavilySearch(query: string) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_KEY,
      query,
      search_depth: "advanced",
      include_answer: false,
      include_images: false,
      include_raw_content: false,
      max_results: 8
    })
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = await res.json();
  const results = (data.results || []).map((r: any, i: number) => ({
    id: i + 1,
    title: r.title,
    url: r.url,
    snippet: (r.content || "").slice(0, 500)
  }));
  return results;
}

// Hidden/system-style prompt
function buildPrompt(question: string, sources: {id:number;title:string;url:string;snippet:string}[]) {
  const srcBlock = sources.map(s =>
    `Source [${s.id}]: ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}`
  ).join("\n\n");

  return `
You are a clinical Q&A assistant for orthopedics, radiology, and emergency medicine in India.
Answer with concise, clinically useful bullets and numeric inline citations.

ROUTING:
- If fractures/orthopedics terms → ORTHO template
- If imaging/reporting terms (x-ray, CT, MRI, ultrasound) → RADIOLOGY template
- If ED/triage/resus → EMERGENCY template
- If ambiguous, choose the closest.

TEMPLATES (pick ONE):
ORTHO (5–8 bullets):
• Classification: ...
• Risks/Complications: ...
• Red flags: ...
• Associated injuries: ...
• Management (initial + definitive): ...

RADIOLOGY (5–8 bullets):
• Key imaging findings: ...
• Differential diagnosis: ...
• Reporting checklist (brief): ...
• Pitfalls/when to escalate: ...
• Recommendation (modality/follow-up): ...

EMERGENCY (5–8 bullets):
• Initial assessment (triage red flags): ...
• Immediate actions/stabilization: ...
• Imaging and labs: ...
• Disposition & consults: ...
• Pitfalls/common misses: ...

RULES:
- Use ONLY the sources below for facts; if evidence is weak/contradictory, say so briefly.
- EVERY bullet must start with "• " and end with inline numeric citations like [1] or [1,3] mapping to the numbered source list order.
- Be India-aware when relevant (practical, resource-aware tips).
- No extra headings like “Evidence-based”.

SOURCES (cite with [n]):
${srcBlock}

USER QUESTION: "${question}"

Return bullets only.
`.trim();
}

export async function POST(req: Request) {
  try {
    const { q } = await req.json();
    const question = (q || "").trim();
    if (!question || question.length < 6) {
      return NextResponse.json({ error: "Ask a clear medical question (6+ chars)" }, { status: 400 });
    }
    if (!TAVILY_KEY || !GEMINI_KEY) {
      return NextResponse.json({ error: "Server missing API keys" }, { status: 500 });
    }

    // 1) Live search
    const sources = await tavilySearch(
      question + " fracture OR radiology OR emergency medicine site:gov OR site:edu"
    );

    // 2) Build prompt for Gemini
    const prompt = buildPrompt(question, sources);

    // 3) Call Gemini (server-side)
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent?key=" + GEMINI_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );

    if (!r.ok) {
      const txt = await r.text();
      return NextResponse.json({ error: "Gemini failed", details: txt }, { status: 502 });
    }

    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // 4) Parse bullets (lines starting with • or -)
    const bullets = text
      .split("\n")
      .map(l => l.trim())
      .filter(l => /^[-•]\s+/.test(l))
      .map(l => l.replace(/^[-•]\s+/, ""));

    return NextResponse.json({
      bullets: bullets.length ? bullets : [text || "No structured answer produced."],
      sources
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Server error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
