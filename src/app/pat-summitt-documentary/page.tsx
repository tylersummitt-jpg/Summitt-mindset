import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title:
    "Pat Summitt Documentary Guide: ESPN Films, Pat XO, Cinderella Season, and New 2026 Releases",
  description:
    "A complete guide to Pat Summitt documentaries including ESPN films like Pat XO, The Cinderella Season, and the new 2026 Pat Summitt documentaries produced with Omaha Productions, Trilogy Productions, Rock’n Robin Productions, and Tribeca Productions.",
};

export default function PatSummittDocumentaryPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* --------------------------------------------------
          SECTION 1 — OVERVIEW
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-6">
          Pat Summitt Documentary Guide: Films, ESPN Documentaries, and the 2026 Releases
        </h1>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt was the longtime head coach of the University of
            Tennessee Lady Vols and one of the most successful coaches in the
            history of sports. She won at the highest level while demanding
            discipline, accountability, and high standards from herself and
            everyone around her.
          </p>
          <p>
            Because of that impact, many people search for Pat Summitt
            documentaries and films—whether they remember watching her teams in
            real time, discovered her story through ESPN, or simply want to
            study how she led. Several films have explored her life, her
            leadership style, and the program she built at Tennessee.
          </p>
          <p>
            This page is a simple guide to the best-known Pat Summitt
            documentaries and films, including new releases, ESPN projects like
            <em> Pat XO</em>, and stories about the seasons that defined her
            career.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          SECTION 2 — NEW PAT SUMMITT FILMS (MARCH 2026)
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          New Pat Summitt Films (March 2026)
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            In March 2026, two new projects about Pat Summitt are being
            released—each offering a different way to understand her impact on
            women&apos;s basketball and leadership.
          </p>
          <p>
            The first project is a special event honoring Pat Summitt produced
            by Peyton Manning’s Omaha Productions. This event celebrates her
            legacy and influence on women’s basketball, the Tennessee program,
            and leadership more broadly. It will air periodically on ESPN and
            is designed to introduce her story to a new generation of fans and
            leaders.
          </p>
          <p>
            The second project is a major documentary produced by Trilogy
            Productions in collaboration with Rock’n Robin Productions and
            Tribeca Productions. Rock’n Robin Productions is led by Robin
            Roberts, the longtime{" "}
            <span className="italic">Good Morning America</span> anchor and a
            close friend of Pat Summitt. This feature documentary explores her
            career, leadership philosophy, and lasting impact on sports and
            leadership.
          </p>
          <p>
            The Trilogy/ Rock’n Robin/ Tribeca film will be distributed through
            ESPN and Hulu, making it widely accessible to viewers who want a
            deeper, long-form look at how Pat Summitt coached, led, and lived
            her values.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          SECTION 3 — PAT XO (ESPN NINE FOR IX)
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Pat XO (ESPN Nine for IX)
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            <em>Pat XO</em> was produced as part of ESPN’s{" "}
            <a
              href="https://www.espn.com/espnw/title-nine-for-ix/"
              target="_blank"
              rel="noreferrer"
              className="font-semibold underline"
            >
              Nine for IX documentary series
            </a>{" "}
            honoring the 40th anniversary of Title IX. The series highlights
            women’s stories in sports; Pat Summitt&apos;s film is one of its
            signature entries.
          </p>
          <p>
            The documentary focuses on Pat Summitt’s leadership, the way she
            built the Tennessee Lady Vols, and the relationships she formed
            with her players and staff. It blends archival footage, interviews,
            and storytelling from those who knew her best.
          </p>
          <p>
            Rather than only revisiting championships, <em>Pat XO</em> spends
            time on how she held people accountable, how she communicated, and
            how she believed in her players even when she was demanding more
            from them. For many viewers, it is the definitive starting point
            for understanding who she was beyond the box scores.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          SECTION 4 — THE CINDERELLA SEASON (ESPN)
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          The Cinderella Season (ESPN)
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            <em>The Cinderella Season</em> tells the story of one of the most
            unusual championship runs in college basketball history. The
            Tennessee Lady Volunteers lost ten games during the season—a number
            that would normally keep a team out of the title conversation.
          </p>
          <p>
            Under Pat Summitt’s leadership, that team still found a way to win
            the national championship. The documentary highlights how she kept
            standards high even when the record was uneven, how she challenged
            her players, and how the culture she built allowed the program to
            stay together through a difficult year.
          </p>
          <p>
            More than a recap of a single season,{" "}
            <em>The Cinderella Season</em> shows what resilience, accountability,
            and a shared identity look like inside a championship program. It is
            a useful film for anyone who wants to understand how great teams
            respond when things are not going according to plan.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          WHERE TO WATCH PAT SUMMITT DOCUMENTARIES
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Where to Watch Pat Summitt Documentaries
        </h2>
        <p className="text-[var(--text)] leading-relaxed">
          Pat Summitt documentaries and films are typically available through
          ESPN programming, ESPN+, Hulu, and other sports documentary platforms
          depending on the project and current licensing. Because new films and
          broadcasts are released over time, availability can change. ESPN
          features many of the projects connected to her career, including
          special events and documentaries highlighting the Tennessee Lady
          Volunteers and the broader growth of women&apos;s basketball.
        </p>
      </section>

      {/* --------------------------------------------------
          SECTION 5 — WHY PAT SUMMITT'S STORY MATTERS
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Why Pat Summitt&apos;s Story Matters
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt finished her career with{" "}
            <strong>1,098 career wins</strong>—more than any other Division I
            basketball coach, male or female, at the time of her retirement.
            That total reflects decades of consistency, but the real story is
            how she built Tennessee into a national powerhouse.
          </p>
          <p>
            She turned the Tennessee Lady Vols into one of the most respected
            programs in sports: eight national championships, countless Final
            Fours, and a standard of preparation that influenced the entire
            women&apos;s game. Her teams were known for their defense,
            toughness, and willingness to play anyone, anywhere.
          </p>
          <p>
            Her influence extended far beyond the sideline. Generations of
            players and assistant coaches carried her ideas into their own
            programs, businesses, and families. Many of today’s leaders in
            women’s basketball trace their approach directly back to Pat
            Summitt.
          </p>
          <p>
            At the center of it all was a leadership style built on{" "}
            <strong>discipline, accountability, and standards</strong>. She
            demanded that people show up prepared, tell the truth, accept
            responsibility, and compete with intensity every day. The
            documentaries and films about her life matter because they keep
            those ideas in front of new generations who may never have seen her
            coach in person.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          SECTION 6 — LEADERSHIP LESSONS
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Leadership Lessons from Pat Summitt
        </h2>
        <p className="text-[var(--text)] leading-relaxed mb-6">
          If you want to go deeper than the films, these pages break down the
          core pillars of Pat Summitt&apos;s leadership—what she expected from
          herself and from the people she led.
        </p>
        <ul className="space-y-3 text-[var(--text)] leading-relaxed list-disc pl-6">
          <li>
            <Link
              href="/pat-summitt-discipline"
              className="text-[var(--brand)] font-semibold hover:underline"
            >
              Discipline
            </Link>
          </li>
          <li>
            <Link
              href="/pat-summitt-accountability"
              className="text-[var(--brand)] font-semibold hover:underline"
            >
              Accountability
            </Link>
          </li>
          <li>
            <Link
              href="/pat-summitt-team-culture"
              className="text-[var(--brand)] font-semibold hover:underline"
            >
              Team culture
            </Link>
          </li>
          <li>High standards</li>
          <li>Competitive excellence</li>
        </ul>
      </section>

      {/* --------------------------------------------------
          SECTION 7 — CTA (UNCHANGED)
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12 text-center">
        <h2 className="text-xl font-bold text-[var(--text)] mb-4">
          Take the 7-Day Pat Summitt Leadership Challenge
        </h2>
        <p className="text-[var(--muted)] mb-6 leading-relaxed">
          Turn Pat Summitt&apos;s leadership philosophy into daily habits. Our
          free 7-day challenge sends you one short lesson, one reflection
          prompt, and one action each day—inspired by the principles that
          defined her career.
        </p>
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline:
              "Pat Summitt Documentary Guide: Films, ESPN Documentaries, and the 2026 Releases",
            description:
              "A complete guide to Pat Summitt documentaries including Pat XO, The Cinderella Season, and the new 2026 Pat Summitt documentaries produced with Omaha Productions, Trilogy Productions, Rock’n Robin Productions, and Tribeca Productions.",
            author: {
              "@type": "Organization",
              name: "Summitt Mindset",
            },
            publisher: {
              "@type": "Organization",
              name: "Summitt Mindset",
            },
            mainEntityOfPage:
              "https://summittmindset.com/pat-summitt-documentary",
            about: [
              "Pat Summitt documentary",
              "Pat XO documentary",
              "Cinderella Season documentary",
              "Pat Summitt ESPN film",
              "Pat Summitt Hulu documentary",
            ],
          }),
        }}
      />
    </main>
  );
}
