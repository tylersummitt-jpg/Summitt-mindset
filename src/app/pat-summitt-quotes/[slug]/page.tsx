import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { QuoteShareCard } from "@/components/QuoteShareCard";
import { supabaseServer } from "@/lib/supabase-server";

type PageProps = {
  params: Promise<{ slug: string }>;
};

type GenerateMetadataProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: GenerateMetadataProps): Promise<Metadata> {
  const { slug } = await params;

  const { data } = await supabaseServer
    .from("pat_quotes")
    .select("quote_text")
    .eq("slug", slug)
    .eq("active", true)
    .single();

  if (!data) {
    return {};
  }

  const title = `${data.quote_text.slice(0, 60)} — Pat Summitt Quote`;
  const description =
    "A leadership quote from Coach Pat Summitt on discipline, accountability, and leadership.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function PatSummittQuotePage({ params }: PageProps) {
  const { slug } = await params;

  const { data: quote } = await supabaseServer
    .from("pat_quotes")
    .select("id, quote_text, slug, topic, quote_insight")
    .eq("slug", slug)
    .eq("active", true)
    .single();

  if (!quote) {
    notFound();
  }

  const { data: relatedQuotes } = await supabaseServer
    .from("pat_quotes")
    .select("quote_text, slug")
    .eq("active", true)
    .eq("topic", quote.topic)
    .neq("slug", quote.slug)
    .limit(4);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Quotation",
    text: quote.quote_text,
    author: {
      "@type": "Person",
      name: "Pat Summitt",
    },
  };

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData),
        }}
      />
      {/* --------------------------------------------------
          HERO
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)]">
          Pat Summitt Quote
        </h1>
      </section>

      {/* --------------------------------------------------
          QUOTE
          -------------------------------------------------- */}
      <section className="max-w-2xl mx-auto px-4 py-12">
        <blockquote className="text-xl leading-relaxed border-l-4 border-[var(--brand)] pl-6 py-4 text-[var(--text)]">
          {quote.quote_text}
        </blockquote>
        <p className="text-center text-[var(--muted)] mt-4">
          Inspired by Pat Summitt&apos;s leadership?{" "}
          <Link
            href="/pat-summitt-leadership-challenge"
            className="text-[var(--brand)] font-semibold ml-1 hover:underline"
          >
            Start the free 7-Day Leadership Challenge
          </Link>
        </p>
      </section>

      {quote.quote_insight && (
        <section className="max-w-2xl mx-auto px-4 py-8 text-left space-y-3">
          <h2 className="text-lg font-semibold text-[var(--text)]">
            Leadership Insight
          </h2>
          <p className="text-[var(--text)] leading-relaxed">
            {quote.quote_insight}
          </p>
        </section>
      )}

      <section className="mt-8 max-w-2xl mx-auto text-left space-y-3">
        <h2 className="text-lg font-semibold">
          Leadership Lesson
        </h2>

        <p className="text-gray-700 leading-relaxed">
          Pat Summitt believed leadership begins with personal accountability and daily discipline.
          This quote reflects her philosophy that success is built through consistent effort,
          clear standards, and the courage to lead by example.
        </p>
      </section>

      <section className="max-w-2xl mx-auto px-4 py-8">
        <QuoteShareCard quote={quote.quote_text} slug={quote.slug} />
      </section>

      {/* --------------------------------------------------
          SHARE THIS QUOTE
          -------------------------------------------------- */}
      <section className="max-w-2xl mx-auto px-4 py-8">
        <h2 className="text-lg font-bold text-[var(--text)] mb-4">
          Share This Quote
        </h2>
        <div className="space-y-3">
          <a
            href={
              "https://twitter.com/intent/tweet?text=" +
              encodeURIComponent(`"${quote.quote_text}" — Pat Summitt`)
            }
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-[var(--brand)] hover:underline"
          >
            Tweet this quote
          </a>
          <CopyLinkButton />
        </div>
      </section>

      {/* --------------------------------------------------
          APPLYING THE LESSON
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Leadership Lesson
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>Great quotes can inspire us.</p>
          <p>
            But the real value comes from applying the lesson consistently.
          </p>
          <p>
            Summitt Mindset was created to help people practice leadership
            daily.
          </p>
          <p>One practice. One reflection. One day at a time.</p>
        </div>
      </section>

      {/* --------------------------------------------------
          RELATED QUOTES
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Related Quotes
        </h2>
        <div className="space-y-4">
          {(relatedQuotes ?? []).map((q) => (
            <Link
              key={q.slug}
              href={`/pat-summitt-quotes/${q.slug}`}
              className="block border-l-4 border-[var(--brand)] pl-4 py-3 hover:bg-[var(--surface)]"
            >
              {q.quote_text}
            </Link>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------
          EXPLORE PAT SUMMITT LEADERSHIP
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-4">
          Explore Pat Summitt Leadership
        </h2>
        <p className="text-[var(--text)] leading-relaxed mb-6">
          Pat Summitt&apos;s quotes reflect a deeper leadership philosophy
          built on discipline, accountability, and high standards.
        </p>
        <div className="space-y-4">
          <Link
            href="/pat-summitt-leadership"
            className="block border-l-4 border-[var(--brand)] pl-4 py-3 hover:bg-[var(--surface)] text-[var(--text)] font-semibold"
          >
            Pat Summitt Leadership
          </Link>
          <Link
            href="/pat-summitt-leadership-principles"
            className="block border-l-4 border-[var(--brand)] pl-4 py-3 hover:bg-[var(--surface)] text-[var(--text)] font-semibold"
          >
            Pat Summitt Leadership Principles
          </Link>
          <Link
            href="/pat-summitt-discipline"
            className="block border-l-4 border-[var(--brand)] pl-4 py-3 hover:bg-[var(--surface)] text-[var(--text)] font-semibold"
          >
            Pat Summitt on Discipline
          </Link>
        </div>
      </section>

      {/* --------------------------------------------------
          MORE PAT SUMMITT QUOTES BY TOPIC
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          More Pat Summitt Quotes by Topic
        </h2>
        <div className="space-y-4">
          <Link
            href="/pat-summitt-quotes/discipline"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)] font-semibold hover:bg-[var(--surface)]"
          >
            Pat Summitt Discipline Quotes
          </Link>
          <Link
            href="/pat-summitt-quotes/leadership"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)] font-semibold hover:bg-[var(--surface)]"
          >
            Pat Summitt Leadership Quotes
          </Link>
          <Link
            href="/pat-summitt-quotes/accountability"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)] font-semibold hover:bg-[var(--surface)]"
          >
            Pat Summitt Accountability Quotes
          </Link>
          <Link
            href="/pat-summitt-quotes/team"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)] font-semibold hover:bg-[var(--surface)]"
          >
            Pat Summitt Team Culture Quotes
          </Link>
          <Link
            href="/pat-summitt-quotes/standards"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)] font-semibold hover:bg-[var(--surface)]"
          >
            Pat Summitt Quotes About Standards
          </Link>
        </div>
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

      {/* --------------------------------------------------
          CTA
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold text-[var(--text)] mb-8">
          Start Your Daily Practice
        </h2>
        <Link
          href="/subscribe"
          className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90"
        >
          Start 7-Day Free Trial
        </Link>
      </section>
    </main>
  );
}
