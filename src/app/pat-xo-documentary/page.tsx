import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pat XO Documentary: ESPN Nine for IX Film About Pat Summitt",
  description:
    "Pat XO is an ESPN Nine for IX documentary about Pat Summitt's leadership, the Tennessee Lady Vols, and the relationships that defined her coaching career. Learn where to watch and why it matters.",
};

export default function PatXoDocumentaryPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <section className="max-w-3xl mx-auto px-4 py-12 sm:py-16 md:py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          Pat XO Documentary: ESPN Nine for IX Film About Pat Summitt
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            <em>Pat XO</em> is one of the most widely watched documentaries
            about Pat Summitt. Produced as part of ESPN&apos;s Nine for IX
            series, it honors the 40th anniversary of Title IX by telling
            women&apos;s stories in sports. Pat Summitt&apos;s film stands as
            one of the series&apos; signature entries—and for many viewers, it
            remains the definitive introduction to who she was beyond the box
            scores.
          </p>
          <p>
            Whether you search for &quot;Pat XO documentary,&quot; &quot;Pat
            Summitt documentary,&quot; or &quot;Pat Summit documentary&quot;
            (a common misspelling), this page covers what the film offers and
            where to find it.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          What the Pat XO Documentary Covers
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            <em>Pat XO</em> focuses on Pat Summitt&apos;s leadership, the way she
            built the Tennessee Lady Vols into a national powerhouse, and the
            relationships she formed with her players and staff. The documentary
            blends archival footage, interviews with those who knew her best, and
            storytelling that goes beyond championships.
          </p>
          <p>
            Rather than only revisiting wins and titles, <em>Pat XO</em> spends
            time on how she held people accountable, how she communicated, and
            how she believed in her players even when she was demanding more
            from them. It shows the discipline and standards that defined her
            approach—and the human side of a coach who shaped generations of
            athletes and leaders.
          </p>
          <p>
            The film is part of ESPN&apos;s Nine for IX series, which highlights
            women&apos;s stories in sports. Each entry in the series tells a
            different story; Pat Summitt&apos;s is one of the most requested and
            frequently discussed.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Where to Watch Pat XO
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            <em>Pat XO</em> is distributed through ESPN and ESPN+. Availability
            can change with licensing, but the film has historically been
            available on ESPN+ and through ESPN programming. Check ESPN&apos;s
            schedule and streaming platform for current options.
          </p>
          <p>
            ESPN often features Nine for IX documentaries during Women&apos;s
            History Month, around Title IX anniversaries, and during college
            basketball season. If you&apos;re looking for Pat Summitt
            documentaries on ESPN, <em>Pat XO</em> is typically one of the
            first to appear.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Why Pat XO Matters for Leadership
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt finished her career with 1,098 wins and eight national
            championships. But the real story—and what <em>Pat XO</em> captures
            well—is how she built a culture of discipline, accountability, and
            high standards. She demanded that people show up prepared, tell the
            truth, and compete with intensity every day.
          </p>
          <p>
            The documentary is useful for anyone who wants to understand how
            great leaders communicate, hold people accountable, and build trust
            while maintaining high expectations. Her approach to preparation,
            feedback, and team culture offers lessons that extend far beyond
            basketball.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          More Pat Summitt Documentaries
        </h2>
        <p className="text-[var(--text)] leading-relaxed mb-4">
          <em>Pat XO</em> is one of several documentaries about Pat Summitt.
          Others include <em>The Cinderella Season</em>, new 2026 releases from
          Omaha Productions and Trilogy Productions, and films distributed
          through ESPN and Hulu.{" "}
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
