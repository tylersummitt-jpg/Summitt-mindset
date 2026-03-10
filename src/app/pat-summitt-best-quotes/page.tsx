import Link from "next/link";
import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Best Pat Summitt Quotes on Leadership and Winning",
  description:
    "50 of the best Pat Summitt quotes on leadership, discipline, teamwork, and success from the legendary Tennessee coach.",
};

export default async function PatSummittBestQuotesPage() {
  const { data: quotesData } = await supabaseServer
    .from("pat_quotes")
    .select("id, quote_text, slug")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(50);

  const quotes = quotesData ?? [];

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          HERO / PAGE TITLE
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          50 Best Pat Summitt Quotes on Leadership, Discipline, and Winning
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt was the longtime head coach of the University of
            Tennessee Lady Vols basketball team and one of the most successful
            coaches in the history of the sport. She won eight national
            championships and 1,098 games—more than any other Division I
            basketball coach, male or female, at the time of her retirement.
            Beyond the wins, she was known for a leadership philosophy built on
            discipline, accountability, and an uncompromising standard of
            excellence.
          </p>
          <p>
            Her influence extended far beyond the court. Pat Summitt&apos;s
            approach to building teams, developing character, and demanding
            the best from herself and others has been studied by coaches,
            executives, and leaders in every field. She showed that great
            leadership is consistent, clear, and rooted in values that don&apos;t
            change when the score is close or the pressure is high.
          </p>
          <p>
            The quotes she left behind capture that philosophy in plain
            language. They remind us that success is built on daily habits,
            that accountability starts with ourselves, and that winning is
            about more than the final score. Whether you&apos;re leading a
            team, running a business, or simply trying to show up better each
            day, her words still point the way.
          </p>
          <p>
            Below are 50 of the best Pat Summitt quotes on leadership,
            discipline, and winning—timeless lessons from a coach who defined
            what it means to lead.
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
            href="/pat-summitt-quotes/leadership"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 font-semibold text-[var(--text)] hover:bg-[var(--surface)] transition"
          >
            Pat Summitt Leadership Quotes
          </Link>
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
          Experience Pat Summitt’s Leadership Every Day
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
