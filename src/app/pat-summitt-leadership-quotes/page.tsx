import Link from "next/link";
import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Pat Summitt Leadership Quotes",
  description:
    "50 powerful leadership quotes from legendary coach Pat Summitt about discipline, accountability, teamwork, and winning.",
};

export default async function PatSummittLeadershipQuotesPillarPage() {
  const { data: quotesData } = await supabaseServer
    .from("pat_quotes")
    .select("id, quote_text, slug")
    .eq("topic", "leadership")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(40);

  const quotes = quotesData ?? [];

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          HERO / PAGE TITLE
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          50 Pat Summitt Leadership Quotes That Define Great Leadership
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt didn&apos;t just win basketball games—she built leaders.
            Her leadership philosophy, rooted in discipline, accountability,
            and an unwavering standard of excellence, made her one of the most
            influential coaches of all time. The quotes she left behind continue
            to shape how we think about leading teams, making hard decisions,
            and holding ourselves and others to a higher standard.
          </p>
          <p>
            Whether you&apos;re a coach, an executive, or someone who wants to
            lead with more intention, Pat Summitt&apos;s words cut through the
            noise. They remind us that great leadership isn&apos;t about being
            liked; it&apos;s about being clear, consistent, and committed to
            the growth of the people around us.
          </p>
          <p>
            Below are 50 of her most powerful leadership quotes—each one a
            lesson in what it takes to lead with purpose and leave a lasting
            impact.
          </p>
        </div>
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
          EXPLORE MORE PAT SUMMITT QUOTES
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Explore More Pat Summitt Quotes
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/pat-summitt-quotes/discipline"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 font-semibold text-[var(--text)] hover:bg-[var(--surface)] transition"
          >
            Pat Summitt Discipline Quotes
          </Link>
          <Link
            href="/pat-summitt-quotes/team"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 font-semibold text-[var(--text)] hover:bg-[var(--surface)] transition"
          >
            Pat Summitt Team Culture Quotes
          </Link>
          <Link
            href="/pat-summitt-quotes/accountability"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 font-semibold text-[var(--text)] hover:bg-[var(--surface)] transition"
          >
            Pat Summitt Accountability Quotes
          </Link>
          <Link
            href="/pat-summitt-quotes/standards"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 font-semibold text-[var(--text)] hover:bg-[var(--surface)] transition"
          >
            Pat Summitt Quotes About Standards
          </Link>
        </div>
      </section>

      {/* --------------------------------------------------
          CTA
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12 text-center">
        <h2 className="text-xl font-bold text-[var(--text)] mb-4">
          Start the 7-Day Pat Summitt Leadership Challenge
        </h2>
        <p className="text-[var(--muted)] mb-6 leading-relaxed">
          Turn these quotes into a daily practice. Our free 7-day challenge
          helps you apply Pat Summitt&apos;s principles one day at a time.
        </p>
        <p className="text-[var(--text)] leading-relaxed mt-4">
          Reading a great Pat Summitt quote is a spark; turning it into a habit is what changes how you lead. Summitt Mindset helps you take one small action and one honest reflection each day so her standards actually show up in your life.
        </p>

        <p className="text-[var(--text)] leading-relaxed mt-2">
          Each daily practice is short, calm, and repeatable—built so real people with real responsibilities can keep showing up, one day at a time.
        </p>
        <Link
          href="/subscribe"
          className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90"
        >
          Start Your 7-Day Free Trial
        </Link>
        <p className="text-sm text-[var(--muted)] mt-2">
          7-Day Free Trial • Cancel Anytime
        </p>
        <p className="text-sm text-[var(--muted)] mt-4">
          Not ready yet?{" "}
          <Link
            href="/pat-summitt-leadership-challenge"
            className="text-[var(--brand)] font-semibold hover:underline"
          >
            Try the free 7-Day Leadership Challenge.
          </Link>
        </p>
      </section>
    </main>
  );
}
