// src/app/ask-pat/ask-pat-client.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AskPatFeedback from "@/components/ask-pat-feedback";
import {
  utBody,
  utBodyMuted,
  utCard,
  utErrorPanel,
  utFormField,
  utHeroTitle,
  utPageCanvas,
  utPageInnerAskPat,
  utPrimaryBtn,
} from "@/components/utility-page-visual";

type Props = {
  isSubscribed: boolean;
  isNativeSummittMindsetIos?: boolean;
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

export default function AskPatClient({
  isSubscribed,
  isNativeSummittMindsetIos = false,
}: Props) {
  const router = useRouter();

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleStartTrial() {
    router.push("/subscribe?from=ask-pat");
  }

  function handleMembershipInfo() {
    router.push("/app/membership");
  }

  // ======================================================
  // 🔶 NOT SUBSCRIBED VIEW
  // ======================================================
  if (!isSubscribed) {
    if (isNativeSummittMindsetIos) {
      return (
        <main className={utPageCanvas}>
          <div className={`${utPageInnerAskPat} space-y-8`}>
            <section>
              <h1 className={`${utHeroTitle} mb-4`}>Ask Pat</h1>
              <p className={`${utBody} mb-6`}>
                Ask Pat is available to members with an active Summitt Mindset
                membership. Memberships are managed on the Summitt Mindset
                website.
              </p>
              <button
                type="button"
                onClick={handleMembershipInfo}
                className={utPrimaryBtn}
              >
                Membership info
              </button>
            </section>
          </div>
        </main>
      );
    }

    return (
      <main className={utPageCanvas}>
        <div className={`${utPageInnerAskPat} space-y-8`}>
        <section>
          <h1 className={`${utHeroTitle} mb-4`}>Ask Pat</h1>

          <p className={`${utBody} mb-6`}>
            Get direct coaching inspired by Pat Summitt’s leadership standards.
            Members can ask Pat questions any time.
          </p>

          <button type="button" onClick={handleStartTrial} className={utPrimaryBtn}>
            Start 7-day free trial
          </button>

          <div className={`mt-4 ${utBodyMuted}`}>
            Your trial unlocks full access to Ask Pat, Film Room, and optional in-app depth—alongside
            Daily text accountability on your commitment. Cancel anytime before your trial ends.
          </div>
        </section>
        </div>
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
    <main className={utPageCanvas}>
      <div className={`${utPageInnerAskPat} space-y-10`}>
      <header className="space-y-3">
        <h1 className={utHeroTitle}>Ask Pat</h1>
        <p className={`${utBody} max-w-2xl`}>
          Ask about leadership, consistency, discipline, or any situation you’re
          facing. This is your direct line into Coach Pat’s mindset.
        </p>
        <p className={`${utBody} max-w-2xl`}>
          Built from the real words of Pat Summitt—her interviews, speeches, and teachings shape every response.
        </p>
      </header>

      <section className={`${utCard} p-6 space-y-4`}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            className={`${utFormField} min-h-[160px]`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={"Example: \"How do I stay disciplined when I don't feel motivated?\""}
            disabled={isLoading}
          />

          <button type="submit" disabled={isLoading} className={utPrimaryBtn}>
            {isLoading ? "Asking Pat..." : "Get Pat’s Perspective"}
          </button>
        </form>

        {error ? <div className={utErrorPanel}>{error}</div> : null}
      </section>

      {answer ? (
        <section className={`${utCard} px-6 py-6 space-y-5`}>
          <div>
            <h2 className={`text-sm font-semibold mb-3 ${utBodyMuted}`}>Pat’s Answer</h2>
            <p className="text-base leading-relaxed whitespace-pre-wrap text-stone-100">
              {answer}
            </p>
          </div>

          <AskPatFeedback dayNumber={null} />
        </section>
      ) : null}
      </div>
    </main>
  );
}
