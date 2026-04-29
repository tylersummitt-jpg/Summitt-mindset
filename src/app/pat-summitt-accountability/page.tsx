import Link from "next/link";

export default function PatSummittAccountabilityPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          HERO
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12 sm:py-16 md:py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          Pat Summitt on Accountability
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Accountability was one of the core values that defined Pat
            Summitt’s leadership style.
          </p>
          <p>
            Her teams were known for holding themselves and each other to
            high standards.
          </p>
          <p>
            That culture of responsibility helped build some of the most
            consistent teams in sports history.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          WHY ACCOUNTABILITY MATTERS
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Why Accountability Matters
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Great teams depend on trust and responsibility. Each person must
            follow through on their role.
          </p>
          <p>
            Pat Summitt believed accountability created clarity. When
            expectations are clear, people understand what is required to
            succeed.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          ACCOUNTABILITY WITHIN A TEAM
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Accountability Within a Team
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            One of Pat Summitt’s leadership strengths was creating an
            environment where teammates challenged each other to improve.
          </p>
          <p>
            Accountability was not about blame. It was about helping
            everyone reach their potential.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          APPLYING ACCOUNTABILITY
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Applying Accountability in Daily Life
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Accountability is a powerful leadership principle, but it
            requires consistency.
          </p>
          <p>
            Summitt Mindset helps people practice leadership ideas like
            accountability every day.
          </p>
          <p>
            One short practice. One honest reflection. One day at a time.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          RELATED LEADERSHIP ARTICLES
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Related Leadership Articles
        </h2>
        <div className="space-y-4">
          <Link
            href="/pat-summitt-leadership-principles"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"
          >
            <h3 className="font-semibold text-[var(--text)] mb-2">
              Pat Summitt Leadership Principles
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              An overview of the leadership philosophy that defined Pat
              Summitt’s coaching career.
            </p>
          </Link>
          <Link
            href="/pat-summitt-discipline"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"
          >
            <h3 className="font-semibold text-[var(--text)] mb-2">
              Pat Summitt on Discipline
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              How Pat Summitt built excellence through discipline and daily
              habits.
            </p>
          </Link>
        </div>
      </section>

      {/* --------------------------------------------------
          CTA
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12 sm:py-16 md:py-20 text-center">
        <h2 className="text-2xl font-bold text-[var(--text)] mb-8">
          Practice Leadership Daily
        </h2>
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
