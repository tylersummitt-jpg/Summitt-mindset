import Link from "next/link";

export default function PatSummittTeamCulturePage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          HERO
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          Pat Summitt on Team Culture
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            One of the most important parts of Pat Summitt’s leadership was
            the culture she built within her teams.
          </p>
          <p>
            Her players understood that success was not just about talent. It
            was about commitment, accountability, and shared standards.
          </p>
          <p>
            That culture helped Tennessee become one of the most respected
            programs in sports.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          WHAT IS TEAM CULTURE
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          What Is Team Culture?
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Team culture is the set of expectations, habits, and standards
            that guide how a group works together.
          </p>
          <p>
            Pat Summitt believed culture was built through consistent
            behavior. Leaders set the tone for how teammates prepare,
            communicate, and compete.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          BUILDING A STRONG CULTURE
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Building a Strong Team Culture
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Strong cultures do not happen by accident. They develop through
            daily habits and clear expectations.
          </p>
          <p>
            Pat Summitt expected her players to support each other while
            also holding each other accountable.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          APPLYING CULTURE IN DAILY LIFE
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Applying Culture in Daily Life
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            The same leadership ideas that shape great teams can apply in
            many areas of life.
          </p>
          <p>
            Consistency, accountability, and discipline help people build
            strong cultures in their organizations and communities.
          </p>
          <p>
            Summitt Mindset helps people practice leadership principles like
            these every day.
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
          <Link
            href="/pat-summitt-accountability"
            className="block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"
          >
            <h3 className="font-semibold text-[var(--text)] mb-2">
              Pat Summitt on Accountability
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              How accountability created clarity and trust within Pat
              Summitt’s teams.
            </p>
          </Link>
        </div>
      </section>

      {/* --------------------------------------------------
          CTA
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-20 text-center">
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
