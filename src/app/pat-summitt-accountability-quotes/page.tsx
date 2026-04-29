import Link from "next/link";
import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Pat Summitt Accountability Quotes: Leadership Lessons on Responsibility and Standards",
  description:
    "Read powerful Pat Summitt accountability quotes about responsibility, leadership standards, and building teams that hold themselves accountable.",
};

export default async function PatSummittAccountabilityQuotesPage() {
  const { data: quotesData } = await supabaseServer
    .from("pat_quotes")
    .select("id, quote_text, slug")
    .eq("active", true)
    .eq("topic", "accountability")
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
          Pat Summitt Accountability Quotes
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt&apos;s philosophy of accountability was simple but
            uncompromising: everyone on the team was responsible for their
            effort, their preparation, and their impact on others. She believed
            that great teams don&apos;t rely on one person to hold everyone
            accountable—they hold each other to a shared standard.
          </p>
          <p>
            That philosophy shaped the Tennessee basketball program. Players
            were expected to own their mistakes, show up ready to work, and
            support their teammates. Accountability wasn&apos;t about blame; it
            was about responsibility. When everyone took ownership of their
            role, the team could achieve more than any individual could alone.
          </p>
          <p>
            Pat Summitt believed that great leaders demand accountability
            from themselves first. She held herself to the same standards she
            asked of her players—preparation, effort, and honesty. That
            consistency is what made her message credible and her program
            one of the most respected in sports history.
          </p>
          <p>
            Her accountability quotes still resonate with leaders today because
            they cut through the noise. In a world where responsibility is
            often diffuse, her words remind us that excellence requires people
            who own their actions and hold each other to a higher standard.
            Below are some of her most powerful quotes on accountability,
            responsibility, and building teams that deliver.
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
            href="/pat-summitt-quotes/leadership"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 font-semibold text-[var(--text)] hover:bg-[var(--surface)] transition"
          >
            Pat Summitt Leadership Quotes
          </Link>
          <Link
            href="/pat-summitt-quotes/team"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 font-semibold text-[var(--text)] hover:bg-[var(--surface)] transition"
          >
            Pat Summitt Team Culture Quotes
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
          prompt, and one action each day—inspired by the accountability and
          standards that defined her career.
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
