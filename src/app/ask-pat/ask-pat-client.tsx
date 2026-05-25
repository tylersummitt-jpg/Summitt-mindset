// src/app/ask-pat/ask-pat-client.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AskPatFeedback from "@/components/ask-pat-feedback";

type Props = {
  isSubscribed: boolean;
  firstName: string;
};

type AskPatResponse =
  | {
      ok: true;
      answer: string;
    }
  | {
      ok?: false;
      error: string;
      reason?: string;
      limitPerDay?: number;
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

  // ======================================================
  // 🔶 NOT SUBSCRIBED VIEW
  // ======================================================
  if (!isSubscribed) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-12 space-y-8">
        <section>
          <h1 className="text-4xl font-semibold mb-4">Ask Pat</h1>

          <p className="text-base text-[var(--muted)] mb-6">
            Get direct coaching inspired by Pat Summitt’s leadership standards.
            Members can ask Pat questions any time.
          </p>

          <button
            onClick={handleStartTrial}
            className="inline-flex items-center justify-center rounded-lg bg-[var(--brand)] px-5 py-3 text-sm font-semibold text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 focus:ring-offset-[var(--bg)]"
          >
            Start 7-day free trial
          </button>

          <div className="mt-4 text-sm text-[var(--muted)]">
            Your trial unlocks full access to Ask Pat, Film Room, and optional in-app depth—alongside
            Daily text accountability on your commitment. Cancel anytime before your trial ends.
          </div>
        </section>
      </main>
    );
  }

  // ======================================================
  // 🔵 SUBSCRIBER VIEW (Ask Pat Session)
  // ======================================================
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

      const data = (await res.json()) as AskPatResponse;

      if (!res.ok) {
        throw new Error(
          (data as any)?.error || "Something went wrong. Please try again."
        );
      }

      if ((data as any)?.answer === undefined) {
        const msg =
          (data as any)?.error ||
          "Ask Pat is unavailable right now. Please try again later.";

        setError(msg);
        return;
      }

      setAnswer((data as any).answer ?? "No answer returned.");
      setQuestion("");
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-12 space-y-10">
      {/* Header */}
      <header className="space-y-3">
        <h1 className="text-4xl font-semibold">Ask Pat</h1>
        <p className="text-base text-[var(--muted)] max-w-2xl">
          Ask about leadership, consistency, discipline, or any situation you’re
          facing. This is your direct line into Coach Pat’s mindset.
        </p>
        <p className="text-base text-[var(--muted)] max-w-2xl">
          Built from the real words of Pat Summitt—her interviews, speeches, and teachings shape every response.
        </p>
      </header>

      {/* Ask Box */}
      <section className="rounded-xl border bg-[var(--ink)] p-6 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            className="w-full rounded-lg border border-[var(--border)] bg-white px-4 py-3 text-base min-h-[160px] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={"Example: \"How do I stay disciplined when I don't feel motivated?\""}
            disabled={isLoading}
          />

          <button
            type="submit"
            disabled={isLoading}
            className="rounded-lg bg-[var(--brand)] px-5 py-3 text-sm font-semibold text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 focus:ring-offset-[var(--bg)] disabled:cursor-not-allowed disabled:bg-gray-400 disabled:opacity-100 disabled:hover:opacity-100"
          >
            {isLoading ? "Asking Pat..." : "Get Pat’s Perspective"}
          </button>
        </form>

        {error && (
          <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 rounded-lg">
            {error}
          </div>
        )}
      </section>

      {/* Answer */}
      {answer && (
        <section className="rounded-xl border bg-[var(--surface)] px-6 py-6 space-y-5">
          <div>
            <h2 className="text-sm font-semibold mb-3 text-[var(--muted)]">
              Pat’s Answer
            </h2>
            <p className="text-base leading-relaxed whitespace-pre-wrap">
              {answer}
            </p>
          </div>

          {/* Canon Feedback Touchpoint */}
          <AskPatFeedback dayNumber={null} />
        </section>
      )}
    </main>
  );
}
