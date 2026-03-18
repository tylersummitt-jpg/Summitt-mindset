import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { getPageImage } from "@/data/page-images";

export default function AskPatPreviewPage() {
  const cardBase =
    "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm";
  const image = getPageImage("/ask-pat-preview");

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <PageHero
        title="Ask Pat."
        subtitle="Get leadership guidance inspired by Coach Pat Summitt's standards, discipline, and mindset. Ask about leadership, consistency, discipline, or a real situation you're facing."
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
            href="/daily-practice"
            className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--ink)]"
          >
            See Daily Practice
          </Link>
        </div>
      </PageHero>

      {/* --------------------------------------------------
          EXAMPLE QUESTION
          -------------------------------------------------- */}
      <section className="max-w-2xl mx-auto px-4 py-16">
        <p className="text-sm font-semibold text-[var(--muted)] mb-3">
          Example Question
        </p>
        <div className={cardBase}>
          <p className="text-[var(--text)] leading-relaxed italic">
            “How do I stay disciplined when I don’t feel motivated?”
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          PAT'S ANSWER
          -------------------------------------------------- */}
      <section className="max-w-2xl mx-auto px-4 pb-16">
        <p className="text-sm font-semibold text-[var(--text)] mb-3">
          Pat’s Perspective
        </p>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--brand-soft)] p-6 shadow-sm">
          <p className="text-[var(--text)] whitespace-pre-line leading-relaxed">
            Let me tell you about a time back in my playing days when motivation
            was nowhere to be found. I was nursing a knee injury, sidelined with a
            twelve-inch scar and told by the top coaches that I didn't have a
            chance to make the Olympic team.
            {"\n\n"}
            It would have been easy to give up — to say, "I'm tired, I'm hurt,
            I'm done."
            {"\n\n"}
            But I didn't.
            {"\n\n"}
            Instead, I spent hours in the gym, gave up red meat, worked out six
            hours a day, and played through the pain.
            {"\n\n"}
            Motivation? It came and went.
            {"\n"}
            Discipline? That's what got me through.
            {"\n\n"}
            Start smaller than you think you should.
            {"\n"}
            Finish one thing today that you said you would do.
            {"\n\n"}
            Do it clean.
            {"\n"}
            Do it without excuses.
            {"\n\n"}
            That's how standards are built.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          HOW ASK PAT WORKS
          -------------------------------------------------- */}
      <section className="bg-[var(--ink)] py-16">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] text-center mb-12">
            How Ask Pat Works
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className={cardBase}>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
                Ask a Real Question
              </h3>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                Bring a leadership challenge, a discipline problem, or something
                you are working through.
              </p>
            </div>
            <div className={cardBase}>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
                Get Pat’s Perspective
              </h3>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                Responses are inspired by Pat Summitt’s leadership philosophy and
                grounded in your journey.
              </p>
            </div>
            <div className={cardBase}>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
                Apply It Today
              </h3>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                The goal is not just advice. It is helping you take the next
                right step.
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
          Leadership gets clearer when you reflect.
        </h2>
        <p className="text-[var(--muted)] mb-8 leading-relaxed">
          Members can ask Pat questions anytime while building their daily
          practice.
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
