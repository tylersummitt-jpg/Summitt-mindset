import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pat Summitt Hulu Documentary: Films and Where to Watch",
  description:
    "A guide to Pat Summitt documentaries on Hulu, including the 2026 Trilogy film and other films about her life and leadership. Learn where to watch Pat Summitt Hulu documentaries.",
};

export default function PatSummittHuluDocumentaryPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <section className="max-w-3xl mx-auto px-4 py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          Pat Summitt Hulu Documentary: Films and Where to Watch
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Hulu is one of the platforms where you can find Pat Summitt
            documentaries. Whether you search for &quot;Pat Summitt Hulu
            documentary,&quot; &quot;Pat Summitt documentary,&quot; or &quot;Pat
            Summit documentary&quot; (a common misspelling), this page covers
            what is available and where to find it.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Pat Summitt Documentaries on Hulu
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            In March 2026, a major documentary about Pat Summitt is being
            released. Produced by Trilogy Productions in collaboration with
            Rock&apos;n Robin Productions and Tribeca Productions, the film
            explores her career, leadership philosophy, and lasting impact on
            sports and leadership. Rock&apos;n Robin Productions is led by Robin
            Roberts, the longtime <em>Good Morning America</em> anchor and a close
            friend of Pat Summitt.
          </p>
          <p>
            This feature documentary will be distributed through ESPN and Hulu,
            making it widely accessible to viewers who want a deeper, long-form
            look at how Pat Summitt coached, led, and lived her values. It is
            designed to introduce her story to a new generation of fans and
            leaders.
          </p>
          <p>
            Pat Summitt documentaries and films are typically available through
            ESPN programming, ESPN+, Hulu, and other sports documentary
            platforms depending on the project and current licensing. Because
            new films and broadcasts are released over time, availability can
            change. Hulu has historically featured sports documentaries,
            including those connected to ESPN and Disney content.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Where to Watch Pat Summitt Documentaries on Hulu
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            The 2026 Trilogy/Rock&apos;n Robin/Tribeca documentary will be
            distributed through Hulu, alongside ESPN. Check Hulu&apos;s library
            and search for Pat Summitt documentaries to see current
            availability.
          </p>
          <p>
            Hulu often carries ESPN and Disney content, including sports
            documentaries. Licensing agreements can shift over time, so it is
            worth checking both Hulu and ESPN+ for the full range of Pat Summitt
            films.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Why Pat Summitt Documentaries Matter for Leadership
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt finished her career with 1,098 wins and eight national
            championships. The documentaries about her capture the discipline,
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
          Hulu is one of several platforms that feature Pat Summitt
          documentaries. Films are also distributed through ESPN and ESPN+, and
          new 2026 releases will be available on both ESPN and Hulu.{" "}
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
