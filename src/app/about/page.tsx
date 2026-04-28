import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { getPageImage } from "@/data/page-images";

export default function AboutPage() {
  const image = getPageImage("/about");

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <PageHero
        title="About Summitt Mindset"
        subtitle="Inspired by the leadership standards of Coach Pat Summitt—discipline, accountability, and the belief that what you hold yourself to, consistently, shapes who you become."
        imageSrc={image?.src ?? "/brand/pat-hero.jpeg"}
        imageAlt={image?.alt ?? "Coach Pat Summitt"}
        imagePosition="object-[center_20%]"
      />

      {/* --------------------------------------------------
          WHO PAT SUMMITT WAS
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Who Pat Summitt Was
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>
            Pat Summitt served as the head coach of the University of Tennessee
            Lady Volunteers for 38 seasons. She became one of the most respected
            leaders in sports history.
          </p>
          <p>
            She led Tennessee to eight national championships and over 1,000
            career wins. More importantly, she built a culture of accountability,
            preparation, and high standards.
          </p>
          <p>
            Her leadership style influenced generations of athletes, coaches, and
            leaders far beyond basketball.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          WHY SUMMITT MINDSET EXISTS
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          Why Summitt Mindset Exists
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>Built from the real words of Pat Summitt.</p>
          <p>
            We studied her interviews, speeches, and teachings to shape every part of this experience.
          </p>
          <p>
            Grounded in how she coached, led, and challenged people to grow.
          </p>
          <p>
            Many people admire Coach Pat Summitt’s leadership. But admiration
            alone does not change how we live.
          </p>
          <p>
            Summitt Mindset turns those principles into something you can keep: one clear commitment,
            honest accountability over SMS, and a calm app layer for depth and proof.
          </p>
          <p>
            The center is not a day score—it is the promise you make to yourself, held with steadiness.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          THE PHILOSOPHY
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-[var(--text)] mb-6">
          The Philosophy
        </h2>
        <div className="space-y-4 text-[var(--text)] leading-relaxed">
          <p>Leadership is built through consistency.</p>
          <p>Discipline is built in small decisions.</p>
          <p>
            And the standards you keep every day shape the person you become.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------
          FINAL CTA
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold text-[var(--text)] mb-4">
          Start with SMS-first accountability.
        </h2>
        <p className="text-[var(--muted)] mb-8 leading-relaxed">
          One commitment, Pat by text, Victory Room for proof—optional depth in the app when you want it.
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
