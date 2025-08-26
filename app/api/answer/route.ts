export const runtime = "edge";

type Source = { title: string; url: string; snippet?: string };

// --- Helpers ---------------------------------------------------------------

function toBullets(text: string): string[] {
  return text
    .split("\n")
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0)
    // strip common bullet markers
    .map((line: string) => line.replace(/^(\*|\-|\•|\d+\.)\s*/, ""))
    .filter((line: string) => line.length > 0)
    .slice(0, 12);
}

function buildPrompt(question: string, sources?: Source[]) {
  const srcText =
    sources && sources.length
      ? `\n\nUse ONLY these web sources to answer. Cite inline like [1], [2]...\n${sources
          .map((s, i) => `[${i + 1}] ${s.title} - ${s.url}`)
          .join("\n")}\n`
      : "";

  return `You are a medical assistant for Indian MBBS/MD students and junior doctors.
Answer concisely in structured bullets. Auto-detect the query type and apply the best template:

- Orthopaedics/Trauma: **Classification**, **Risk Factors**, **Associated Injuries**, **Initial Management**, **Definitive/Follow-up**.
- Radiology: **DDx**, **Key Imaging Features**, **Reporting Phrases**, **Urgent Findings**, **Next Steps**.
- Emergency: **Primary Survey**, **Immediate Actions**, **Investigations**, **Differentials**, **Disposition/Follow-up**.

Rules:
- 5–12 bullets total. No prose paragraphs.
- Keep bold section labels like **Classification:** etc.
- India-friendly practice wording.
- If unsure, say so and suggest safe next steps.
${srcText}

Question: ${question}

Return just bullet lines, one per line.`;
}

// --- Tavily search (optional) ---------------------------------------------

async function tavilySearch(q: string): Promise<Source[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query: q,
      search_depth: "basic",
      include_domains: [],
      max_results: 5,
    }),
  });
  if (!res.ok) return [];
  const json = await res.json();
  const items = (json?.results || []) as any[];
  return items.map((r) => ({
    title: r.title || r.url,
    url: r.url,
    snippet: r.content || "",
  }));
}

// --- Gemini call -----------------------------------------------------------

async function askGemini(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=" +
    key;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 800,
      },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini error: ${t}`);
  }

  const json = await res.json();
  const text =
    json?.candidates?.[0]?.content?.parts?.[0]?.text?.toString() || "";
  return text;
}

// --- Route handler ---------------------------------------------------------

export async function POST(req: Request) {
  try {
    const { question } = (await req.json()) as { question?: string };
    if (!question || !question.trim()) {
      return new Response(
        JSON.stringify({ error: "Question is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1) optional web search
    const sources = await tavilySearch(question);

    // 2) build prompt + ask LLM
    const prompt = buildPrompt(question, sources);
    const raw = await askGemini(prompt);

    // 3) normalize to bullets
    const bullets = toBullets(raw);

    return new Response(JSON.stringify({ bullets, sources }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || "Server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
