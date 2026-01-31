"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  isSubscribed: boolean;
  firstName: string;
};

export default function AskPatClient({ isSubscribed }: Props) {
  const router = useRouter();

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleStartTrial() {
    router.push("/subscribe?from=ask-pat");
  }

  // 🔶 NOT SUBSCRIBED VIEW
  if (!isSubscribed) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <section>
          <h1 className="text-3xl font-bold mb-3">Ask Pat</h1>
          <p className="text-sm text-gray-600 mb-4">
            Get direct coaching inspired by Pat Summitt’s leadership standards.
            Members can ask Pat questions any time.
          </p>

          <button
            onClick={handleStartTrial}
            className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Start 7-day free trial — $25/mo after
          </button>

          <div className="mt-4 text-xs text-gray-500">
            Your trial unlocks full access to Ask Pat, Daily Practice, and the
            Film Room. Cancel anytime before your trial ends.
          </div>
        </section>
      </main>
    );
  }

  // 🔵 SUBSCRIBER VIEW
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAnswer(null);

    const trimmed = question.trim();
    if (!trimmed) {
      setError("Ask a specific question to get started.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/ask-pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Something went wrong.");
      }

      setAnswer(data.answer ?? "No answer returned.");
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-2">Ask Pat</h1>
      <p className="text-sm text-gray-600 mb-6">
        Ask about leadership, consistency, discipline, or any situation you’re
        facing. This is your direct line into Coach Pat’s mindset.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          className="w-full rounded-lg border px-3 py-2 text-sm min-h-[120px]"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder='Example: "How do I lead when I feel inconsistent?"'
        />

        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {isLoading ? "Asking Pat..." : "Get Pat’s Perspective"}
        </button>
      </form>

      {error && (
        <div className="mt-4 border bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {answer && (
        <section className="mt-6 border rounded-lg bg-gray-50 px-4 py-4">
          <h2 className="text-sm font-semibold mb-2">Pat’s Answer</h2>
          <p className="text-sm whitespace-pre-wrap">{answer}</p>
        </section>
      )}
    </main>
  );
}
