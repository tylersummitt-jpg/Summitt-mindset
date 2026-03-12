import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Cinderella Season Documentary: Pat Summitt and the 1997 Championship",
  description:
    "The Cinderella Season is an ESPN documentary about Pat Summitt's 1997 Tennessee Lady Vols—a team that lost 10 games but won the national championship. Learn where to watch and why it matters for leadership.",
};

export default function TheCinderellaSeasonDocumentaryPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <section className="max-w-3xl mx-auto px-4 py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          The Cinderella Season Documentary: Pat Summitt and the 1997 Championship
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            <em>The Cinderella Season</em> is an ESPN documentary that tells
            one of the most unusual championship stories in college basketball
            history. The 1996–97 Tennessee Lady Volunteers lost ten games during
            the season—a number that would normally keep a team out of the title
            conversation. Under Pat Summitt&apos;s leadership, that team still
            found a way to win the national championship.
          </p>
          <p>
            Whether you search for &quot;The Cinderella Season documentary,&quot;
            &quot;Pat Summitt documentary,&quot; or &quot;Pat Summit documentary&quot;
            (a common misspelling), this page covers what the film offers and
            where to find it.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          What The Cinderella Season Documentary Covers
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            The documentary highlights how Pat Summitt kept standards high even
            when the record was uneven. It shows how she challenged her players,
            how the culture she built allowed the program to stay together
            through a difficult year, and how resilience and accountability
            played out inside a championship program.
          </p>
          <p>
            More than a recap of a single season, <em>The Cinderella Season</em>{" "}
            demonstrates what it looks like when a leader refuses to lower
            expectations—even when results are not going according to plan. It is
            a useful film for anyone who wants to understand how great teams
            respond when things are hard.
          </p>
          <p>
            The 1997 title run remains one of the most memorable in women&apos;s
            college basketball. The documentary captures the tension, the
            turnaround, and the leadership that made it possible.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Where to Watch The Cinderella Season
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            <em>The Cinderella Season</em> is distributed through ESPN and
            ESPN+. Availability can change with licensing, but the film has
            historically been available on ESPN+ and through ESPN programming.
            Check ESPN&apos;s schedule and streaming platform for current
            options.
          </p>
          <p>
            ESPN often features documentaries about the Tennessee Lady Vols and
            Pat Summitt during college basketball season and around the NCAA
            tournament. If you&apos;re looking for Pat Summitt ESPN documentaries,
            <em>The Cinderella Season</em> is one of the most frequently
            discussed.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Why The Cinderella Season Matters for Leadership
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            The 1997 season is a case study in maintaining standards when
            outcomes are uncertain. Pat Summitt did not lower her expectations
            because the team had lost games. She continued to demand preparation,
            accountability, and effort—and the culture she had built over years
            held the team together when it mattered most.
          </p>
          <p>
            The documentary is useful for leaders who face difficult seasons—in
            sports, business, or any team context. It shows how shared identity,
            resilience, and a refusal to compromise on standards can lead to
            unexpected breakthroughs.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          More Pat Summitt Documentaries
        </h2>
        <p className="text-[var(--text)] leading-relaxed mb-4">
          <em>The Cinderella Season</em> is one of several documentaries about Pat
          Summitt. Others include <em>Pat XO</em>, new 2026 releases from Omaha
          Productions and Trilogy Productions, and films distributed through ESPN
          and Hulu.{" "}
          <Link
            href="/pat-summitt-documentary"
            className="text-[var(--brand)] font-semibold hover:underline"
          >
            See the full Pat Summitt documentary guide here.
          </Link>
        </p>
      </section>
    </main>
  );
}
