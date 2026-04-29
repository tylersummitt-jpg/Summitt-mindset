import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pat Summitt ESPN Documentary: Films and Where to Watch",
  description:
    "A guide to Pat Summitt documentaries on ESPN, including Pat XO, The Cinderella Season, and new 2026 releases. Learn where to watch Pat Summitt ESPN films and why they matter for leadership.",
};

export default function PatSummittEspnDocumentaryPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <section className="max-w-3xl mx-auto px-4 py-12 sm:py-16 md:py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          Pat Summitt ESPN Documentary: Films and Where to Watch
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            ESPN has produced and distributed several documentaries about Pat
            Summitt, making it one of the primary places to find films about her
            life, her leadership, and the Tennessee Lady Vols. Whether you search
            for &quot;Pat Summitt ESPN documentary,&quot; &quot;Pat Summitt
            documentary,&quot; or &quot;Pat Summit documentary&quot; (a common
            misspelling), this page covers what is available and where to find
            it.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Pat Summitt Documentaries on ESPN
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            <em>Pat XO</em> was produced as part of ESPN&apos;s Nine for IX
            series, honoring the 40th anniversary of Title IX. The documentary
            focuses on Pat Summitt&apos;s leadership, the way she built the
            Tennessee Lady Vols, and the relationships she formed with her players
            and staff. It blends archival footage, interviews, and storytelling
            from those who knew her best. For many viewers, it is the definitive
            starting point for understanding who she was beyond the box scores.
          </p>
          <p>
            <em>The Cinderella Season</em> tells the story of the 1996–97
            Tennessee Lady Volunteers—a team that lost ten games during the
            season but still won the national championship. The documentary
            highlights how Pat Summitt kept standards high even when the record
            was uneven, how she challenged her players, and how the culture she
            built allowed the program to stay together through a difficult year.
          </p>
          <p>
            In March 2026, new Pat Summitt content is being released. A special
            event from Peyton Manning&apos;s Omaha Productions will air
            periodically on ESPN, and a major documentary from Trilogy
            Productions, Rock&apos;n Robin Productions, and Tribeca Productions
            will be distributed through ESPN and Hulu.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Where to Watch Pat Summitt ESPN Documentaries
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt documentaries on ESPN are typically available through
            ESPN programming, ESPN+, and linear broadcasts. Availability can
            change with licensing and scheduling. ESPN often features
            documentaries about the Tennessee Lady Vols and women&apos;s
            basketball during college basketball season, Women&apos;s History
            Month, and around Title IX anniversaries.
          </p>
          <p>
            ESPN+ is the primary streaming home for many ESPN documentaries.
            Check the ESPN+ library and ESPN&apos;s schedule for current
            availability of Pat XO, The Cinderella Season, and other Pat
            Summitt films.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Why Pat Summitt ESPN Documentaries Matter for Leadership
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt finished her career with 1,098 wins and eight national
            championships. The ESPN documentaries about her capture the discipline,
            accountability, and standards that defined her approach. She demanded
            that people show up prepared, tell the truth, accept responsibility,
            and compete with intensity every day.
          </p>
          <p>
            These films are useful for anyone who wants to understand how great
            leaders communicate, hold people accountable, and build culture. Her
            approach to preparation, feedback, and team identity offers lessons
            that extend far beyond basketball.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          More Pat Summitt Documentaries
        </h2>
        <p className="text-[var(--text)] leading-relaxed mb-4">
          ESPN is one of several platforms that feature Pat Summitt
          documentaries. Films are also distributed through Hulu, and new 2026
          releases will be available on both ESPN and Hulu.{" "}
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
