'use client';

import { useState } from 'react';

const FEEDBACK_HOOK = process.env.NEXT_PUBLIC_FEEDBACK_WEBHOOK_URL || '';

type Source = { id?: number; title: string; url: string };

export default function Page() {
  const [mode, setMode] = useState<'auto' | 'radiology' | 'emergency' | 'ortho'>('auto');
  const [q, setQ] = useState('');
  const [answerHtml, setAnswerHtml] = useState<string>('');
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [rated, setRated] = useState<'up' | 'down' | null>(null);
  const [toast, setToast] = useState<string>('');

  async function ask() {
    setLoading(true);
    setRated(null);
    setToast('');
    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, question: q }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setAnswerHtml(data.answer_html || '');
      const src = Array.isArray(data.sources_json)
        ? data.sources_json
        : safeParseArray(data.sources_json);
      setSources(src);
    } catch (e: any) {
      setAnswerHtml(`<p class="text-red-600">Error: ${e?.message || 'Failed'}</p>`);
      setSources([]);
    } finally {
      setLoading(false);
    }
  }

  async function rate(rating: 'up' | 'down') {
    if (rated || !FEEDBACK_HOOK) {
      setRated(rating);
      if (!FEEDBACK_HOOK) setToast('Feedback webhook not configured');
      return;
    }
    setRated(rating);
    setToast('Thanks!');
    try {
      await fetch(FEEDBACK_HOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts: new Date().toISOString(),
          mode,
          q,
          answerHtml,
          sources,
          rating,
        }),
      });
    } catch {
      // ignore webhook errors
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <h1 className="text-3xl font-semibold">Project Devi</h1>
      <p className="text-sm text-gray-500">Minimal medical Q&amp;A with live sources.</p>

      <div className="flex gap-2 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask a clinical question…"
          className="flex-1 rounded border px-3 py-2"
        />
        <div className="flex gap-2">
          {(['auto', 'radiology', 'emergency', 'ortho'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded border px-3 py-2 text-sm ${
                m === mode ? 'bg-black text-white' : 'bg-white'
              }`}
            >
              {cap(m)}
            </button>
          ))}
        </div>
        <button
          onClick={ask}
          disabled={!q || loading}
          className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Answer</h2>
        <div
          className="prose max-w-none prose-ul:my-2 prose-li:my-1"
          dangerouslySetInnerHTML={{ __html: answerHtml || '<p class="text-gray-400">—</p>' }}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-semibold">Sources</h3>
        {sources?.length ? (
          <ul className="list-disc pl-6">
            {sources.map((s, i) => (
              <li key={i}>
                <a className="text-blue-600 underline" href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-gray-400 text-sm">—</div>
        )}
      </section>

      <section className="flex items-center gap-3">
        <span className="text-sm text-gray-600">Was this useful?</span>
        <button
          onClick={() => rate('up')}
          disabled={rated !== null}
          className={`rounded border px-2 py-1 text-sm ${
            rated === 'up' ? 'bg-green-600 text-white' : 'bg-white'
          }`}
        >
          Good
        </button>
        <button
          onClick={() => rate('down')}
          disabled={rated !== null}
          className={`rounded border px-2 py-1 text-sm ${
            rated === 'down' ? 'bg-red-600 text-white' : 'bg-white'
          }`}
        >
          Bad
        </button>
        <span className="text-xs text-gray-500">{toast}</span>
      </section>
    </main>
  );
}

function safeParseArray(v: any): Source[] {
  try {
    const j = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}
