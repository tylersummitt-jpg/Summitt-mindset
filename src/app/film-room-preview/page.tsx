import Link from "next/link";

const SPEAKERS = [
  { name: "Peyton Manning", descriptor: "NFL Hall of Fame Quarterback" },
  { name: "Robin Roberts", descriptor: "Good Morning America Anchor" },
  { name: "Phillip Fulmer", descriptor: "National Championship Football Coach" },
  { name: "Morgan Vance", descriptor: "Leadership Strategist" },
  { name: "Pat Summitt", descriptor: "Coach of the Century" },
  { name: "Leadership Panel", descriptor: "Lessons on team culture" },
];

export default function FilmRoomPreviewPage() {
  const cardBase =
    "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm";

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          HERO
          -------------------------------------------------- */}
      <section className="bg-[var(--ink)]">
        <div className="max-w-2xl mx-auto px-4 py-16 sm:py-24 text-center">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-tight text-[var(--text)] mb-5">
            Film Room
          </h1>
          <p className="text-lg text-[var(--muted)] mb-4 leading-relaxed max-w-xl mx-auto">
            Learn leadership principles from some of the most respected voices
            in sports, media, and business.
          </p>
          <p className="text-sm text-[var(--muted)] mb-10 max-w-lg mx-auto">
            Film study inside Summitt Mindset is optional. But many members find
            it powerful.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
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
        </div>
      </section>

      {/* --------------------------------------------------
          SPEAKER GRID
          -------------------------------------------------- */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] text-center mb-12">
          Featured Speakers
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {SPEAKERS.map((speaker) => (
            <div
              key={speaker.name}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden shadow-sm"
            >
              <div className="bg-[var(--ink)] aspect-video flex items-center justify-center p-4">
                <p className="text-[var(--text)] font-semibold text-center text-sm sm:text-base">
                  {speaker.name}
                </p>
              </div>
              <div className="p-4">
                <p className="font-bold text-[var(--text)]">{speaker.name}</p>
                <p className="text-sm text-[var(--muted)] mt-1">
                  {speaker.descriptor}
                </p>
                <p className="text-xs text-[var(--muted)] mt-4">
                  Available inside membership
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------
          HOW FILM ROOM WORKS
          -------------------------------------------------- */}
      <section className="bg-[var(--ink)] py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] text-center mb-12">
            How the Film Room Works
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className={cardBase}>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
                Watch When You Want
              </h3>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                Film study is optional. Many members watch a short video after
                completing their daily practice.
              </p>
            </div>
            <div className={cardBase}>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
                Learn from Experience
              </h3>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                Speakers share real lessons about leadership, discipline,
                teamwork, and standards.
              </p>
            </div>
            <div className={cardBase}>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
                Apply the Principle
              </h3>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                The goal is not just watching. It is taking one idea and applying
                it in your life.
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
          Great leadership leaves clues.
        </h2>
        <p className="text-[var(--muted)] mb-8 leading-relaxed">
          Explore the Film Room inside Summitt Mindset.
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
