import Link from "next/link";

export default function PatSummittDisciplinePage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          HERO
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12 sm:py-16 md:py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          Pat Summitt on Discipline
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Discipline was one of the defining characteristics of Pat
            Summitt’s leadership.
          </p>
          <p>
            Her teams were known for preparation, accountability, and
            consistency. Those standards were built through daily habits and
            a commitment to doing things the right way.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          WHY DISCIPLINE MATTERS
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Why Discipline Matters
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt believed discipline helped teams reach their
            potential. When individuals consistently follow through on their
            responsibilities, the entire team becomes stronger.
          </p>
          <p>
            Discipline was not about punishment. It was about building
            habits that allowed players to perform at their best.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          DAILY HABITS
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Daily Habits Build Discipline
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Discipline is rarely built through big moments. It is built
            through small decisions repeated every day.
          </p>
          <p>
            Players were expected to show up prepared, focused, and
            accountable for their effort.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          APPLYING DISCIPLINE
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Applying Discipline in Daily Life
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Many people admire discipline, but applying it consistently can be
            difficult.
          </p>
          <p>
            Summitt Mindset was created to help people practice leadership
            principles like discipline every day.
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
            href="/pat-summitt-accountability"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"
          >
            <h3 className="font-semibold text-[var(--text)] mb-2">
              Pat Summitt on Accountability
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              How Pat Summitt built a culture of responsibility within her
              teams.
            </p>
          </Link>
          <Link
            href="/pat-summitt-team-culture"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"
          >
            <h3 className="font-semibold text-[var(--text)] mb-2">
              Pat Summitt on Team Culture
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              How strong cultures helped define Pat Summitt’s teams.
            </p>
          </Link>
        </div>
      </section>

      {/* --------------------------------------------------
          CTA
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12 sm:py-16 md:py-20 text-center">
        <h2 className="text-2xl font-bold text-[var(--text)] mb-8">
          Start Your Daily Practice
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
