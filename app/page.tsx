'use client';

import { useState } from 'react';

interface Source {
  title: string;
  url: string;
  id?: number;
}

interface ApiResponse {
  answer_html: string;
  sources_json: Source[] | string;
}

interface FeedbackPayload {
  ts: string;
  mode: string;
  q: string;
  answerHtml: string;
  sources: Source[];
  rating: 'up' | 'down';
}

export default function HomePage() {
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState('auto');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setLoading(true);
    setResponse(null);
    setFeedbackGiven(false);

    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, question }),
      });

      if (!res.ok) throw new Error('Failed to get answer');
      
      const data: ApiResponse = await res.json();
      setResponse(data);
    } catch (error) {
      console.error('Error:', error);
      setResponse({
        answer_html: '<p class="text-red-600">Error: Failed to get answer. Please try again.</p>',
        sources_json: []
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = async (rating: 'up' | 'down') => {
    if (!response || feedbackGiven) return;

    setFeedbackLoading(true);

    // Parse sources_json safely
    let sources: Source[] = [];
    try {
      if (Array.isArray(response.sources_json)) {
        sources = response.sources_json;
      } else if (typeof response.sources_json === 'string') {
        sources = JSON.parse(response.sources_json);
      }
    } catch (error) {
      console.error('Error parsing sources:', error);
      sources = [];
    }

    const payload: FeedbackPayload = {
      ts: new Date().toISOString(),
      mode,
      q: question,
      answerHtml: response.answer_html,
      sources,
      rating
    };

    const webhookUrl = process.env.NEXT_PUBLIC_FEEDBACK_WEBHOOK_URL;
    
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        console.error('Error sending feedback:', error);
      }
    }

    setFeedbackGiven(true);
    setFeedbackLoading(false);
  };

  // Parse sources for display
  const parsedSources: Source[] = response ? (() => {
    try {
      if (Array.isArray(response.sources_json)) {
        return response.sources_json;
      } else if (typeof response.sources_json === 'string') {
        return JSON.parse(response.sources_json);
      }
      return [];
    } catch {
      return [];
    }
  })() : [];

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-md p-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-8 text-center">
            Medical AI Assistant
          </h1>

          <form onSubmit={handleSubmit} className="mb-8">
            <div className="mb-4">
              <label htmlFor="mode" className="block text-sm font-medium text-gray-700 mb-2">
                Mode
              </label>
              <select
                id="mode"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="auto">Auto</option>
                <option value="radiology">Radiology</option>
                <option value="emergency">Emergency</option>
                <option value="ortho">Orthopedics</option>
              </select>
            </div>

            <div className="mb-4">
              <label htmlFor="question" className="block text-sm font-medium text-gray-700 mb-2">
                Question
              </label>
              <textarea
                id="question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Enter your medical question..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Getting Answer...' : 'Get Answer'}
            </button>
          </form>

          {response && (
            <div className="border-t pt-6">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Answer</h2>
                <div 
                  className="prose max-w-none"
                  dangerouslySetInnerHTML={{ __html: response.answer_html }}
                />
              </div>

              {parsedSources.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Sources</h3>
                  <ul className="space-y-2">
                    {parsedSources.map((source, index) => (
                      <li key={source.id || index}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline"
                        >
                          {source.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="border-t pt-4">
                <p className="text-sm text-gray-600 mb-3">Was this answer helpful?</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleFeedback('up')}
                    disabled={feedbackGiven || feedbackLoading}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <span>👍</span>
                    Yes
                  </button>
                  <button
                    onClick={() => handleFeedback('down')}
                    disabled={feedbackGiven || feedbackLoading}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <span>👎</span>
                    No
                  </button>
                </div>
                
                {feedbackGiven && (
                  <p className="text-sm text-gray-500 mt-2">
                    Thank you for your feedback!
                  </p>
                )}
                
                {!process.env.NEXT_PUBLIC_FEEDBACK_WEBHOOK_URL && (
                  <p className="text-xs text-gray-400 mt-2">
                    Note: Feedback webhook not configured
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
