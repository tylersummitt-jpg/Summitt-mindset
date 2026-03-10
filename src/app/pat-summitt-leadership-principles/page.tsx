import Link from "next/link";

export default function PatSummittLeadershipPrinciplesPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          HERO
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          Pat Summitt Leadership Principles
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt was one of the most respected leaders in sports
            history.
          </p>
          <p>
            Her teams were known for discipline, preparation, and
            accountability. But those results came from deeper leadership
            principles that guided everything she did.
          </p>
          <p>
            These principles still offer powerful lessons for leaders today.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          PRINCIPLE 1
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-4">
          Discipline Creates Freedom
        </h2>
        <p className="text-[var(--text)] leading-relaxed">
          Pat Summitt believed discipline was the foundation of excellence.
          Small habits practiced every day lead to consistent results over
          time.
        </p>
      </section>

      {/* --------------------------------------------------
          PRINCIPLE 2
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-4">
          Accountability Builds Strong Teams
        </h2>
        <p className="text-[var(--text)] leading-relaxed">
          Great teams are built on responsibility. Players were expected to
          hold themselves and each other to high standards.
        </p>
      </section>

      {/* --------------------------------------------------
          PRINCIPLE 3
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-4">
          Consistency Matters More Than Motivation
        </h2>
        <p className="text-[var(--text)] leading-relaxed">
          Motivation changes from day to day. Consistency is what allows
          teams and individuals to grow over time.
        </p>
      </section>

      {/* --------------------------------------------------
          PRINCIPLE 4
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-4">
          Standards Define Leadership
        </h2>
        <p className="text-[var(--text)] leading-relaxed">
          Leaders set the tone for the culture around them. The standards
          they maintain shape the results their teams produce.
        </p>
      </section>

      {/* --------------------------------------------------
          APPLYING THESE PRINCIPLES
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Applying These Leadership Principles
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>Many people admire Pat Summitt’s leadership philosophy.</p>
          <p>
            But leadership principles only matter when they are practiced
            consistently.
          </p>
          <p>
            Summitt Mindset was created to help people apply these principles
            in daily life.
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
          <Link
            href="/pat-summitt-leadership"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"
          >
            <h3 className="font-semibold text-[var(--text)] mb-2">
              Pat Summitt Leadership Hub
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              Explore the core leadership ideas that defined Pat Summitt’s
              philosophy.
            </p>
          </Link>
        </div>
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
