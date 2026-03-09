"use client";

import Link from "next/link";
import { useState } from "react";

export default function PatSummittLeadershipChallengePage() {
  const [email, setEmail] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await fetch("/api/challenge/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });
    if (res.ok) {
      setEmail("");
      setSuccess(true);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          HERO
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-4">
          7-Day Pat Summitt Leadership Challenge
        </h1>
        <p className="text-xl text-[var(--muted)] mb-6">
          Turn Pat Summitt’s leadership principles into a simple daily habit.
        </p>
        <p className="text-[var(--text)] leading-relaxed mb-8 max-w-2xl mx-auto">
          For 7 days, you’ll receive one short leadership lesson inspired by Pat
          Summitt, one reflection prompt, and one simple action to practice
          that day.
        </p>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col sm:flex-row gap-3 justify-center mt-6"
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            required
            className="px-4 py-3 rounded-md border border-[var(--border)] bg-white text-[var(--text)] min-w-0 sm:min-w-[240px]"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90 whitespace-nowrap"
          >
            Start the Free Challenge
          </button>
        </form>
        {success && (
          <p className="text-green-600 mt-4">
            You&apos;re in! Check your email for Day 1 of the challenge.
          </p>
        )}
      </section>

      {/* --------------------------------------------------
          HOW IT WORKS
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h2 className="text-xl font-bold text-[var(--text)] mb-8 text-center">
          How It Works
        </h2>
        <div className="space-y-6">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
              1. Join the challenge
            </h3>
            <p className="text-[var(--muted)] leading-relaxed">
              Receive the first leadership lesson immediately.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
              2. Practice one principle per day
            </h3>
            <p className="text-[var(--muted)] leading-relaxed">
              Each day takes about 3–5 minutes.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
              3. Build a leadership habit
            </h3>
            <p className="text-[var(--muted)] leading-relaxed">
              Finish the week with a stronger mindset and clearer standards.
            </p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------
          WHAT YOU'LL LEARN
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          What You&apos;ll Learn
        </h2>
        <ul className="space-y-3 text-[var(--text)] leading-relaxed list-disc pl-6">
          <li>Discipline creates freedom</li>
          <li>Accountability builds strong teams</li>
          <li>Consistency beats motivation</li>
          <li>Standards define leadership</li>
          <li>Respond instead of reacting</li>
        </ul>
      </section>

      {/* --------------------------------------------------
          FINAL CTA
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold text-[var(--text)] mb-4">
          Start the Free Challenge Today
        </h2>
        <p className="text-[var(--muted)] mb-8 leading-relaxed max-w-xl mx-auto">
          If Pat Summitt’s story inspires you, this challenge helps turn that
          inspiration into daily action.
        </p>
        <Link
          href="#"
          className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90"
        >
          Start the Free Challenge
        </Link>
      </section>
    </main>
  );
}
