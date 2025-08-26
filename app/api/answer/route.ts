// app/api/answer/route.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

type Source = { id: number; title: string; url: string; excerpt?: string };
type ApiResponse = {
  ok: boolean;
  question: string;
  bullets: string[];
  sources: Source[];
  error?: string;
};

async function webSearchWithTavily(query: string): Promise<Source[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return []; // optional
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: 5
      })
    });

    const data = await res.json();
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    return results.map((r: any, i: number) => ({
      id: i + 1,
      title: r.title || r.url || "Source",
      url: r.url || "",
      excerpt: r.content || ""
    }));
  } catch {
    return [];
  }
}

function toBullets(text: string): string[] {
  return text
    .split("\n")
    .map((line: string) => line.trim())      // 👈 typed
    .filter((line: string) => /^[-•\d.]/.test(line) || line.length > 0)
    .map((line: string) => line.replace(/^[-•\d.]\s*/, ""))
    .filter((line: string) => line.length > 0)
    .slice(0, 12);
}

export async function POST(req: Request) {
  try {
    const { question } = (await req.json()) as { question?: string };
    if (!question || question.trim().length === 0) {
      return Response.json(
        { ok: false, question: "", bullets: [], sources: [], error: "Missing question" },
        { status: 400 }
      );
    }

    // (Optional) fetch web sources first
    const sources = await webSearchWithTavily(question);

    // Gemini call
    const gemKey = process.env.GEMINI_API_KEY;
    if (!gemKey) {
      return Response.json(
        { ok: false, question, bullets: [], sources, error: "Missing GEMINI_API_KEY" },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(gemKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const systemHint =
      "You are a concise medical reasoning assistant. Answer as clean bullet points. " +
      "Avoid fluff. Where relevant to ortho/radiology/emergency, include classification, risk factors, " +
      "associated injuries, initial management. Do not invent citations; we will list sources separately.";

    const prompt = `${systemHint}\n\nQuestion: ${question}\n\nBullet points only:`;

    const result = await model.generateContent(prompt);
    const text = result.response.text() || "";
    const bullets = toBullets(text);

    const payload: ApiResponse = { ok: true, question, bullets, sources };
    return Response.json(payload, { status: 200 });
  } catch (err: any) {
    const msg = typeof err?.message === "string" ? err.message : "Server error";
    const payload: ApiResponse = {
      ok: false,
      question: "",
      bullets: [],
      sources: [],
      error: msg
    };
    return Response.json(payload, { status: 500 });
  }
}
