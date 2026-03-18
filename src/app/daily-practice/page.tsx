import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { getPageImage } from "@/data/page-images";

export default function DailyPracticeMarketingPage() {
  const cardBase =
    "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm";
  const cardSoft =
    "rounded-2xl border border-[var(--border)] bg-[var(--brand-soft)] p-6 shadow-sm";
  const image = getPageImage("/daily-practice");

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <PageHero
        title="Pat Summitt is your personal life coach — every day."
        subtitle="A simple daily leadership practice inspired by the Coach of the Century. Reflect for a few minutes each day and watch the results in your life."
        imageSrc={image?.src ?? "/brand/pat-hero.jpeg"}
        imageAlt={image?.alt ?? "Coach Pat Summitt"}
      >
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/subscribe"
            className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90"
          >
            Start 7-Day Free Trial
          </Link>
          <Link
            href="/ask-pat-preview"
            className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--ink)]"
          >
            See Ask Pat
          </Link>
        </div>
      </PageHero>

      {/* --------------------------------------------------
          3-STEP EXPLANATION
          -------------------------------------------------- */}
      <section className="max-w-4xl mx-auto px-4 py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] text-center mb-12">
          Get a Daily Note from Coach Pat and watch the results in your life.
        </h2>
        <div className="grid sm:grid-cols-3 gap-6">
          <div className={cardBase}>
            <p className="text-sm font-semibold text-[var(--brand)] mb-2">
              Step 1
            </p>
            <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
              Read Today’s Note
            </h3>
            <p className="text-[var(--muted)] text-sm leading-relaxed">
              Start with a short note inspired by Coach Pat’s standards and
              leadership style.
            </p>
          </div>
          <div className={cardBase}>
            <p className="text-sm font-semibold text-[var(--brand)] mb-2">
              Step 2
            </p>
            <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
              Do One Practice
            </h3>
            <p className="text-[var(--muted)] text-sm leading-relaxed">
              You get one simple action for the day. Nothing overwhelming. Just
              one thing to focus on.
            </p>
          </div>
          <div className={cardBase}>
            <p className="text-sm font-semibold text-[var(--brand)] mb-2">
              Step 3
            </p>
            <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
              Reflect Honestly
            </h3>
            <p className="text-[var(--muted)] text-sm leading-relaxed">
              Write one honest response. That’s how growth becomes real.
            </p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------
          DAILY PRACTICE PREVIEW (static marketing only)
          -------------------------------------------------- */}
      <section className="max-w-2xl mx-auto px-4 py-16">
        <p className="text-sm text-[var(--muted)] text-center mb-8">
          A preview of what your day looks like
        </p>
        <div className="space-y-6">
          <div className={cardSoft}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-[var(--text)]">
                A Note from Coach Pat
              </p>
              <span className="text-xs text-[var(--muted)]">Today</span>
            </div>
            <p className="text-[var(--text)] whitespace-pre-line leading-relaxed">
              Keep it simple today. Show up fully. Finish one thing with
              discipline and let that standard shape the rest of your day.
            </p>
          </div>

          <div className={cardBase}>
            <p className="text-sm font-semibold text-[var(--text)] mb-3">
              Today’s Practice
            </p>
            <p className="text-[var(--text)] whitespace-pre-line leading-relaxed">
              Pick one small thing you’ve been avoiding and finish it today. Do
              it clean. Do it without rushing.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-[var(--text)]">
              Reflection
            </p>
            <p className="text-sm text-[var(--muted)]">
              What is one small thing you will finish today? What would doing it
              well say about your standard?
            </p>
            <div
              className="w-full border border-[var(--border)] rounded-xl p-4 text-sm bg-[var(--surface)] text-[var(--muted)] min-h-[120px]"
              aria-hidden
            >
              Write one honest sentence…
            </div>
            <button
              type="button"
              disabled
              className="w-full rounded-md py-3 font-semibold text-[var(--muted)] bg-[var(--ink)] border border-[var(--border)] cursor-not-allowed"
            >
              Complete Today’s Practice
            </button>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------
          WHY PEOPLE STICK WITH IT
          -------------------------------------------------- */}
      <section className="bg-[var(--ink)] py-16">
        <div className="max-w-4xl mx-auto px-4">
          <div className="grid sm:grid-cols-3 gap-8">
            <div>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
                It’s short.
              </h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                Most days take just a few minutes.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
                It’s personal.
              </h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                The experience feels like daily coaching, not content overload.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
                It helps you stay consistent.
              </h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                You are not trying to change your whole life in one day. You are
                building a standard.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------
          FINAL CTA
          -------------------------------------------------- */}
      <section className="max-w-2xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] mb-4">
          Start small. Stay with it. Watch what changes.
        </h2>
        <p className="text-[var(--muted)] mb-8 leading-relaxed">
          Summitt Mindset helps you practice leadership one day at a time — in
          the app or by text.
        </p>
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
