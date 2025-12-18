"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";

export default function AskPatPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn, user } = useUser();

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ Real subscription check based on Clerk publicMetadata
  const isSubscribed =
    isLoaded && isSignedIn && user?.publicMetadata?.summittSubscribed === true;

  // While Clerk is loading
  if (!isLoaded) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p>Loading…</p>
      </main>
    );
  }

  // 🔁 Send people to the subscribe flow when they click the CTA
  function handleStartTrial() {
    router.push("/subscribe?from=ask-pat");
  }

  // 🔶 NOT SUBSCRIBED VIEW (marketing + examples)
  if (!isSubscribed) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <section>
          <h1 className="text-3xl font-bold mb-3">Ask Pat</h1>
          <p className="text-sm text-gray-600 mb-4">
            Get coaching straight from Pat Summitt&apos;s leadership philosophy.
            Members can ask Pat as many questions as they want, any time.
          </p>

          <button
            onClick={handleStartTrial}
            className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Start 7-day free trial &mdash; $25/mo after
          </button>

          <div className="mt-4 text-xs text-gray-500">
            Your trial gives you full access to Ask Pat, the Summitt Assessment
            breakdown, and the growing Summitt Mindset library. Cancel anytime
            before your trial ends.
          </div>
        </section>

        <section className="border rounded-lg bg-gray-50 px-4 py-4 space-y-4">
          <h2 className="text-sm font-semibold">
            Example questions Ask Pat can answer
          </h2>
          <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
            <li>
              &quot;How do I hold someone accountable without tearing them
              down?&quot;
            </li>
            <li>
              &quot;What should I do with a talented person who doesn&apos;t
              give consistent effort?&quot;
            </li>
            <li>
              &quot;How do I lead when my team is struggling with
              confidence?&quot;
            </li>
          </ul>

          <div className="mt-3 text-xs text-gray-500">
            These are examples. To ask your own question and get a custom answer
            in Pat&apos;s voice, start your free trial.
          </div>
        </section>
      </main>
    );
  }

  // 🔵 SUBSCRIBER VIEW (full Ask Pat experience)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAnswer(null);

    const trimmed = question.trim();
    if (!trimmed) {
      setError("Ask Pat a specific question to get started.");
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
        throw new Error(
          data.error || "Something went wrong. Please try again."
        );
      }

      setAnswer(data.answer ?? "No answer returned.");
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-2">Ask Pat</h1>
      <p className="text-sm text-gray-600 mb-6">
        Ask a question about leadership, the Definite Dozen, or any situation
        you&apos;re facing. This is your direct line into Pat Summitt&apos;s
        leadership philosophy.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Your question
        </label>
        <textarea
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-gray-900 min-h-[120px]"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder='Example: "How do I confront a team member who&apos;s not giving their best effort?"'
        />

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isLoading ? "Asking Pat..." : "Get Pat’s Perspective"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {answer && (
        <section className="mt-6 border rounded-lg bg-gray-50 px-4 py-4">
          <h2 className="text-sm font-semibold mb-2">Pat’s Answer</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {answer}
          </p>
        </section>
      )}
    </main>
  );
}
