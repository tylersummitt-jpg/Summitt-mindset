import Link from "next/link";
import { supabaseServer } from "@/lib/supabase-server";

export default async function PatSummittQuotesPage() {
  const { data: quotesData } = await supabaseServer
    .from("pat_quotes")
    .select("id, quote_text, slug")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(40);

  const quotes = quotesData ?? [];

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          HERO
          -------------------------------------------------- */}
      <section className="max-w-4xl mx-auto px-4 py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          Pat Summitt Quotes
        </h1>
        <p className="text-[var(--text)] leading-relaxed">
          Pat Summitt&apos;s leadership philosophy inspired generations of
          leaders, athletes, and teams. Her quotes on discipline,
          accountability, and excellence continue to guide people today.
        </p>
      </section>

      {/* --------------------------------------------------
          EXPLORE QUOTES BY LEADERSHIP TOPIC
          -------------------------------------------------- */}
      <section className="max-w-4xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Explore Quotes by Leadership Topic
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/pat-summitt-quotes/discipline"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 hover:bg-[var(--surface)]"
          >
            <h3 className="font-semibold text-[var(--text)]">
              Pat Summitt Quotes About Discipline
            </h3>
          </Link>
          <Link
            href="/pat-summitt-quotes/leadership"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 hover:bg-[var(--surface)]"
          >
            <h3 className="font-semibold text-[var(--text)]">
              Pat Summitt Quotes About Leadership
            </h3>
          </Link>
          <Link
            href="/pat-summitt-quotes/accountability"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 hover:bg-[var(--surface)]"
          >
            <h3 className="font-semibold text-[var(--text)]">
              Pat Summitt Quotes About Accountability
            </h3>
          </Link>
          <Link
            href="/pat-summitt-quotes/team"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 hover:bg-[var(--surface)]"
          >
            <h3 className="font-semibold text-[var(--text)]">
              Pat Summitt Quotes About Team Culture
            </h3>
          </Link>
          <Link
            href="/pat-summitt-quotes/standards"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 hover:bg-[var(--surface)]"
          >
            <h3 className="font-semibold text-[var(--text)]">
              Pat Summitt Quotes About Standards
            </h3>
          </Link>
        </div>
      </section>

      {/* --------------------------------------------------
          QUOTE GRID
          -------------------------------------------------- */}
      <section className="max-w-4xl mx-auto px-4 py-16">
        <h2 className="text-xl font-bold text-[var(--text)] mb-8">
          Pat Summitt Quotes
        </h2>
        <div className="space-y-6">
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
          LEADERSHIP CONNECTION
          -------------------------------------------------- */}
      <section className="max-w-4xl mx-auto px-4 py-16">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Leadership Principles in Practice
        </h2>
        <p className="text-[var(--text)] leading-relaxed mb-6">
          Pat Summitt&apos;s leadership principles—discipline, accountability,
          and high standards—apply as much today as they did during her
          coaching career. Explore how these ideas shape effective leadership.
        </p>
        <div className="space-y-4">
          <Link
            href="/pat-summitt-leadership"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--brand)] font-semibold hover:underline"
          >
            Pat Summitt Leadership Hub →
          </Link>
          <Link
            href="/pat-summitt-leadership-principles"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--brand)] font-semibold hover:underline"
          >
            Pat Summitt Leadership Principles →
          </Link>
        </div>
      </section>

      {/* --------------------------------------------------
          CHALLENGE CTA
          -------------------------------------------------- */}
      <section className="max-w-4xl mx-auto px-4 py-20 text-center">
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
