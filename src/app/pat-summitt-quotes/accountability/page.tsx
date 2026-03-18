import Link from "next/link";
import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { getPageImage } from "@/data/page-images";
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
    .limit(40);

  const quotes = quotesData ?? [];
  const image =
    getPageImage("/pat-summitt-quotes") ?? {
      src: "/brand/pat-hero.jpeg",
      alt: "Coach Pat Summitt",
    };

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <PageHero
        title="Accountability"
        subtitle="Pat Summitt quotes on accountability"
        imageSrc={image.src}
        imageAlt={image.alt}
      />

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
          CTA
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12 text-center">
        <h2 className="text-xl font-bold text-[var(--text)] mb-4">
          Start the 7-Day Pat Summitt Leadership Challenge
        </h2>
        <p className="text-[var(--muted)] mb-6 leading-relaxed">
          If Pat Summitt&apos;s leadership inspires you, this free 7-day
          challenge helps turn that inspiration into a simple daily practice.
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
