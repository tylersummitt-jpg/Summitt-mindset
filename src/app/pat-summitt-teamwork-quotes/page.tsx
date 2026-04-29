import Link from "next/link";
import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Pat Summitt Teamwork Quotes: Leadership Lessons on Building Great Teams",
  description:
    "Read powerful Pat Summitt teamwork quotes about team culture, leadership, and building championship teams.",
};

export default async function PatSummittTeamworkQuotesPage() {
  const { data: quotesData } = await supabaseServer
    .from("pat_quotes")
    .select("id, quote_text, slug")
    .eq("active", true)
    .eq("topic", "team")
    .order("created_at", { ascending: true })
    .limit(40);

  const quotes = quotesData ?? [];

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          HERO / PAGE TITLE
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12 sm:py-16 md:py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          Pat Summitt Teamwork Quotes
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt&apos;s philosophy of team culture was built on a simple
            idea: great teams are more than the sum of their parts. She believed
            that when players trusted each other, held each other accountable, and
            put the team first, they could achieve things that no individual
            could accomplish alone.
          </p>
          <p>
            That belief defined the Tennessee program. Her teams were known for
            their chemistry, their shared standards, and their willingness to
            sacrifice for the good of the group. Teamwork wasn&apos;t a slogan—it
            was the daily practice of showing up for each other, communicating
            clearly, and holding everyone to the same high standard.
          </p>
          <p>
            Pat Summitt understood that great teams require trust and
            accountability. Players had to trust that their teammates would
            prepare, would compete, and would support them when it mattered. And
            they had to hold each other accountable—not with blame, but with
            responsibility. That combination of trust and accountability is what
            made her program one of the most successful in sports history.
          </p>
          <p>
            Her teamwork quotes still inspire leaders and coaches today because
            they capture something timeless: the best teams are built on
            culture, not just talent. Below are some of her most powerful words
            on teamwork, team culture, and what it takes to build a group that
            wins together.
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
          MORE PAT SUMMITT LEADERSHIP QUOTES
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          More Pat Summitt Leadership Quotes
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/pat-summitt-best-quotes"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 font-semibold text-[var(--text)] hover:bg-[var(--surface)] transition"
          >
            50 Best Pat Summitt Quotes
          </Link>
          <Link
            href="/pat-summitt-discipline-quotes"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 font-semibold text-[var(--text)] hover:bg-[var(--surface)] transition"
          >
            Pat Summitt Discipline Quotes
          </Link>
          <Link
            href="/pat-summitt-accountability-quotes"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 font-semibold text-[var(--text)] hover:bg-[var(--surface)] transition"
          >
            Pat Summitt Accountability Quotes
          </Link>
          <Link
            href="/pat-summitt-quotes/leadership"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 font-semibold text-[var(--text)] hover:bg-[var(--surface)] transition"
          >
            Pat Summitt Leadership Quotes
          </Link>
        </div>
      </section>

      {/* --------------------------------------------------
          CTA
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12 text-center">
        <h2 className="text-xl font-bold text-[var(--text)] mb-4">
          Take the 7-Day Pat Summitt Leadership Challenge
        </h2>
        <p className="text-[var(--muted)] mb-6 leading-relaxed">
          Turn Pat Summitt&apos;s leadership philosophy into daily habits. Our
          free 7-day challenge sends you one short lesson, one reflection
          prompt, and one action each day—inspired by the teamwork and team
          culture that defined her career.
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
