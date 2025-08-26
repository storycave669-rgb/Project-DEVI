export const runtime = "edge";

export async function GET() {
  try {
    const key = process.env.TAVILY_API_KEY;
    if (!key) {
      return new Response(
        JSON.stringify({ ok: false, error: "TAVILY_API_KEY missing" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query: "Gartland type II supracondylar humerus fracture",
        search_depth: "basic",
        max_results: 3
      }),
    });

    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}

    return new Response(
      JSON.stringify({
        ok: r.ok,
        status: r.status,
        jsonType: typeof json,
        sampleTitles: json?.results?.map((x: any) => x.title).slice(0, 3) || null,
        rawSnippet: text.slice(0, 400)
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
