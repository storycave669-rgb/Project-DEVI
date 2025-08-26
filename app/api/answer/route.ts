// app/api/answer/route.ts
import { NextResponse } from "next/server";

type TavilyResult = { url: string; title: string; content?: string };

const GEMINI_KEY = process.env.GEMINI_API_KEY!;
const TAVILY_KEY = process.env.TAVILY_API_KEY!;

async function tavilySearch(query: string): Promise<TavilyResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_KEY,
      query,
      search_depth: "advanced",
      max_results: 6,
      include_answer: false,
      include_images: false,
      include_domains: [], // leave empty for open web
    }),
    // avoid Vercel caching
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Tavily error:", res.status, text);
    return [];
  }

  const json = await res.json();
  // Tavily returns results under `results` (each has url,title,content)
  return Array.isArray(json.results) ? json.results.slice(0, 6) : [];
}

async function askGemini(prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 900,
      },
    }),
  });

  const json = await res.json();
  const text =
    json?.candidates?.[0]?.content?.parts?.[0]?.text ??
    json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("\n") ??
    "";
  return text;
}

function buildPrompt(q: string, sources: TavilyResult[]) {
  const citationLines = sources
    .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`)
    .join("\n");

  return `
You're an assistant for Indian medical trainees (MBBS/PG) and clinicians.
Write a concise, structured answer for the question below.
Use bullet points and **bold** section labels. Include numeric citations like [1], [2] that refer to the source list provided. 
If the query looks like ortho/trauma, include sections:
- Classification
- Risk Factors
- Associated Injuries
- Initial Management
- Definitive/Follow-up
Otherwise adapt sensible sections for the specialty (e.g., radiology reporting tips, differentials, red flags).

Be terse, clinically useful, and avoid speculation.

Question:
${q}

Sources (use these for citations):
${citationLines}
`;
}

function extractBullets(markdown: string): string[] {
  // Split on lines that look like bullets and keep non-empty
  const lines = markdown.split(/\r?\n/);
  const bullets: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^[-*•]\s+/.test(t)) bullets.push(t.replace(/^[-*•]\s+/, ""));
  }
  // if no explicit bullets, fallback to paragraphs
  if (bullets.length === 0) {
    const paras = markdown
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    return paras;
  }
  return bullets;
}

export async function POST(req: Request) {
  try {
    const { question } = await req.json().catch(() => ({}));
    const q = (question || "").toString().trim();
    if (!q) return NextResponse.json({ error: "Missing question" }, { status: 400 });

    // 1) Web search
    const sources = TAVILY_KEY ? await tavilySearch(q) : [];

    // 2) Ask Gemini with sources for citations
    const prompt = buildPrompt(q, sources);
    const text = await askGemini(prompt);

    // 3) Return bullets + sources (title/url only)
    const bullets = extractBullets(text);
    const minimalSources = sources.map(({ title, url }) => ({ title, url }));

    return NextResponse.json({
      ok: true,
      question: q,
      bullets,
      sources: minimalSources,
      raw: text, // handy for debugging, keep for now
    });
  } catch (e: any) {
    console.error("answer route error:", e?.message || e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
