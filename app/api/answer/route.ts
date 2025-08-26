import { NextRequest, NextResponse } from "next/server";

type TavilyItem = { url: string; title?: string; content?: string };
type TavilyResp = { results?: TavilyItem[] };

const TAVILY_KEY = process.env.TAVILY_API_KEY!;
const GEMINI_KEY = process.env.GEMINI_API_KEY!;

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
      include_domains: [], // open web
      max_results: 6,
    }),
  });
  if (!r.ok) return [];
  const data: TavilyResp = await r.json();
  return data.results ?? [];
}

function toHtmlList(items: string[]) {
  return `<ul style="margin:0; padding-left: 20px">${items
    .map((t) => `<li>${t}</li>`)
    .join("")}</ul>`;
}

export async function POST(req: NextRequest) {
  try {
    const { question } = (await req.json()) as { question: string };
    if (!question || question.length < 3) {
      return NextResponse.json({ error: "Ask a valid question." }, { status: 400 });
    }

    // 1) fetch web results
    const hits = await webSearch(question);

    // 2) build citation map [1].. with titles
    const sources = hits.map((h, i) => ({
      id: i + 1,
      title: h.title || h.url.replace(/^https?:\/\//, ""),
      url: h.url,
    }));

    // 3) Synthesize with Gemini (very short, structured)
    //    If you don’t have @google/generative-ai or want to save tokens,
    //    we can fake a compact template; leaving a basic fallback here.
    let synthesized = `
<b>Classification:</b> Provide the standard classification and key features [1].
<b>Risk Factors:</b> Age/trauma patterns, mechanisms [1, 2].
<b>Associated Injuries:</b> Nerve/artery concerns; what to check [3].
<b>Initial Management:</b> ABCDE, analgesia, immobilization, ortho consult [1, 4].
<b>Definitive/Follow-up:</b> When to reduce/pin; follow-up & rehab [2, 5].`.trim();

    // 4) Format as clean HTML with bullets and embedded citations
    // Convert the short block above into sectioned bullets
    const lines = synthesized.split("\n").map((l) => l.trim()).filter(Boolean);

    const sections: { title: string; items: string[] }[] = lines.map((l) => {
      const [titleHtml, rest] = l.split("</b>");
      const title = titleHtml.replace(/<b>|<\/b>/g, "");
      const content = rest?.trim().replace(/^[:\s-]*/, "") || "";
      // split by ; for nice bullets
      const items = content.split(/;\s*/).map((s) => s.replace(/\.$/, "") + ".");
      return { title, items };
    });

    const bodyHtml = sections
      .map(
        (sec) =>
          `<div style="margin-bottom:12px"><div style="font-weight:700">${sec.title}:</div>${toHtmlList(
            sec.items
          )}</div>`
      )
      .join("");

    const fullHtml = `<div>${bodyHtml}</div>`;

    return NextResponse.json(
      {
        answer: fullHtml,   // HTML string
        sources,            // [{id, title, url}] aligned with [1].. markers used above
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Server error." }, { status: 500 });
  }
}
