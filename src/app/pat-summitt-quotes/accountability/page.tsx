import Link from "next/link";
import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Pat Summitt Accountability Quotes",
  description:
    "Powerful Pat Summitt quotes about accountability, responsibility, and building strong teams.",
};

export default async function PatSummittAccountabilityQuotesPage() {
  const { data: quotesData } = await supabaseServer
    .from("pat_quotes")
    .select("id, quote_text, slug")
    .eq("active", true)
    .eq("topic", "accountability")
    .order("created_at", { ascending: true })
    .limit(12);

  const quotes = quotesData ?? [];

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          HERO
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          Pat Summitt Accountability Quotes
        </h1>
        <p className="text-[var(--text)] leading-relaxed">
          Accountability was one of the core values that defined Pat
          Summitt&apos;s leadership. Her teams were known for holding
          themselves and each other to high standards. These quotes reflect how
          accountability built trust and results.
        </p>
      </section>

      {/* --------------------------------------------------
          QUOTE LIST
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <div className="space-y-8">
          {quotes.map((quote) => (
            <Link
              key={quote.id}
              href={`/pat-summitt-quotes/${quote.slug}`}
              className="block"
            >
              <blockquote className="border-l-4 border-[var(--brand)] pl-4 py-4 text-[var(--text)] leading-relaxed hover:bg-[var(--surface)] transition">
                <p className="mb-2">{quote.quote_text}</p>
                <cite className="text-[var(--muted)] not-italic">
                  — Pat Summitt
                </cite>
              </blockquote>
            </Link>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------
          LEADERSHIP CONTEXT
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h2 className="text-xl font-bold text-[var(--text)] mb-4">
          Accountability and Leadership
        </h2>
        <p className="text-[var(--text)] leading-relaxed mb-4">
          Pat Summitt believed accountability created clarity. When
          expectations are clear and everyone takes responsibility, teams
          achieve more.
        </p>
        <Link
          href="/pat-summitt-accountability"
          className="text-[var(--brand)] font-semibold hover:underline"
        >
          Read more: Pat Summitt on Accountability →
        </Link>
      </section>

      {/* --------------------------------------------------
          7-DAY LEADERSHIP CHALLENGE CTA
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12 text-center">
        <h2 className="text-xl font-bold text-[var(--text)] mb-4">
          Start the 7-Day Pat Summitt Leadership Challenge
        </h2>
        <p className="text-[var(--muted)] mb-6 leading-relaxed">
          If Pat Summitt&apos;s leadership inspires you, this free 7-day
          challenge helps turn that inspiration into a simple daily practice.
        </p>
        <Link
          href="/pat-summitt-leadership-challenge"
          className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90"
        >
          Start the Free Challenge
        </Link>
      </section>
    </main>
  );
}
