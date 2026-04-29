import Link from "next/link";

export default function PatSummittLeadershipPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          HERO
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12 sm:py-16 md:py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          Pat Summitt Leadership
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt was widely respected as one of the greatest leaders
            in sports history.
          </p>
          <p>
            Her teams were known for discipline, accountability, preparation,
            and strong culture.
          </p>
          <p>
            Those leadership principles continue to influence coaches,
            executives, and leaders today.
          </p>
          <p>
            This page explores some of the leadership ideas that defined Pat
            Summitt’s approach.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          PAT SUMMITT LEADERSHIP LESSONS
          -------------------------------------------------- */}
      <section className="max-w-4xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Pat Summitt Leadership Lessons
        </h2>
        <div className="space-y-4">
          <Link
            href="/pat-summitt-leadership-principles"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 hover:bg-[var(--surface)]"
          >
            <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
              Pat Summitt Leadership Principles
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              An overview of the leadership philosophy that defined Pat
              Summitt’s coaching career.
            </p>
          </Link>
          <Link
            href="/pat-summitt-discipline"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 hover:bg-[var(--surface)]"
          >
            <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
              Pat Summitt on Discipline
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              How Pat Summitt built excellence through discipline and daily
              habits.
            </p>
          </Link>
          <Link
            href="/pat-summitt-accountability"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 hover:bg-[var(--surface)]"
          >
            <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
              Pat Summitt on Accountability
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              How Pat Summitt built a culture of responsibility within her
              teams.
            </p>
          </Link>
          <Link
            href="/pat-summitt-team-culture"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 hover:bg-[var(--surface)]"
          >
            <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
              Pat Summitt on Team Culture
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              How strong cultures helped define Pat Summitt’s teams.
            </p>
          </Link>
        </div>
      </section>

      {/* --------------------------------------------------
          WHY THESE IDEAS MATTER
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Why These Leadership Ideas Matter
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Many people admire great leaders, but the real value comes from
            understanding the principles behind their success.
          </p>
          <p>
            Pat Summitt’s leadership philosophy emphasized discipline,
            accountability, and consistency.
          </p>
          <p>
            These ideas remain relevant far beyond basketball.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          CTA
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12 sm:py-16 md:py-20 text-center">
        <h2 className="text-2xl font-bold text-[var(--text)] mb-4">
          Practice Leadership Daily
        </h2>
        <p className="text-[var(--muted)] mb-8 leading-relaxed">
          Summitt Mindset helps people apply leadership principles like these
          one day at a time.
        </p>
        <Link
          href="/subscribe"
          className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90"
        >
          Start 7-Day Free Trial →
        </Link>
      </section>
    </main>
  );
}
