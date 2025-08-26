// app/api/answer/route.ts
import { NextResponse, NextRequest } from "next/server";
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";

export const runtime = "nodejs"; // use Node runtime on Vercel

// ---------- Types ----------
type AskBody = {
  question: string;
};

type TavilyHit = {
  title: string;
  url: string;
  content?: string;
};

type TavilyResponse = {
  results: Array<{
    title: string;
    url: string;
    content?: string;
    snippet?: string;
  }>;
};

type Source = {
  id: number;
  title: string;
  url: string;
  excerpt: string;
};

type Synthesis = {
  bullets: string[];
  raw: string;
};

// ---------- Helpers ----------
function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return v;
}

/** Turn a block of text into clean bullet strings. */
function textToBullets(text: string): string[] {
  const bullets: string[] = text
    .split("\n")
    .map((line: string) => line.trim())
    // lines that start with dash / bullet / numbering become bullets
    .filter((line: string) => /^([-•]|(\d+[\.\)]))\s+/.test(line))
    .map((line: string) => line.replace(/^([-•]|(\d+[\.\)]))\s+/, ""));

  // Fallback: if no markdown-style bullets detected, split into sentences
  if (bullets.length === 0) {
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0)
      .slice(0, 10);
  }
  return bullets.slice(0, 10);
}

/** Fetch sources from Tavily. */
async function fetchSources(query: string): Promise<Source[]> {
  const apiKey = envOrThrow("TAVILY_API_KEY");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    // Keep this light; adjust knobs later
    body: JSON.stringify({
      api_key: apiKey,
      query,
      include_answer: false,
      include_images: false,
      max_results: 5,
      search_depth: "basic",
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as TavilyResponse;

  const hits: TavilyHit[] = data.results?.map((r) => ({
    title: r.title ?? "Untitled",
    url: r.url,
    content: r.content ?? r.snippet ?? "",
  })) ?? [];

  const sources: Source[] = hits.map((h: TavilyHit, idx: number) => ({
    id: idx + 1,
    title: h.title,
    url: h.url,
    excerpt: (h.content ?? "").slice(0, 220),
  }));

  return sources;
}

/** Ask Gemini to synthesize. */
async function synthesizeWithGemini(
  model: GenerativeModel,
  question: string,
  sources: Source[]
): Promise<Synthesis> {
  const citationsList: string = sources
    .map((s: Source, i: number) => `${i + 1}. ${s.title} — ${s.url}`)
    .join("\n");

  const prompt = `
You are a concise medical assistant for exam prep and quick reference.
Return up to 10 short, actionable bullet points in Markdown bullets.
Use the user's question and the provided sources. Do not invent citations.

QUESTION:
"${question}"

SOURCES:
${citationsList}

FORMAT STRICTLY:
- Bullet 1
- Bullet 2
- ...
Then a blank line and "Sources:" followed by numeric list:
[1] Title — URL
[2] Title — URL
`;

  const result = await model.generateContent(prompt);
  const text = (await result.response.text()) ?? "";

  // Split out the "Sources" section if present
  const main = text.split(/\n\s*Sources:\s*/i)[0] ?? text;

  return {
    bullets: textToBullets(main),
    raw: text,
  };
}

// ---------- Route ----------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AskBody;

    if (!body?.question || typeof body.question !== "string") {
      return NextResponse.json(
        { error: "Missing 'question' (string) in request body." },
        { status: 400 }
      );
    }

    // 1) Gather sources
    const sources = await fetchSources(body.question);

    // 2) Synthesize with Gemini
    const genAI = new GoogleGenerativeAI(envOrThrow("GEMINI_API_KEY"));
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const synthesis = await synthesizeWithGemini(model, body.question, sources);

    return NextResponse.json(
      {
        ok: true,
        question: body.question,
        bullets: synthesis.bullets,
        raw: synthesis.raw,
        sources,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "Unknown error in /api/answer",
      },
      { status: 500 }
    );
  }
}
