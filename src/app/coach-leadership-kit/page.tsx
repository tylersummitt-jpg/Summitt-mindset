import Image from "next/image";
import Link from "next/link";

const ctaPrimaryClass =
  "inline-flex items-center justify-center w-full sm:w-auto rounded-xl px-8 py-4 text-base font-semibold text-white bg-[var(--brand)] hover:opacity-95 shadow-md shadow-orange-500/20 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

/** Hero CTA: ring offset for dark hero; tighter on mobile, full size from md */
const ctaHeroPrimaryClass =
  "inline-flex items-center justify-center w-full sm:w-auto rounded-xl px-6 py-3 text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-95 shadow-md shadow-orange-500/20 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 md:px-8 md:py-4 md:text-base";

export default async function CoachLeadershipKitPage({
  searchParams,
}: {
  searchParams?: Promise<{ src?: string }> | { src?: string };
}) {
  const params =
    searchParams instanceof Promise ? await searchParams : searchParams;
  const src = typeof params?.src === "string" ? params.src : undefined;
  const subscribeHref = src === "coach" ? "/subscribe?src=coach" : "/subscribe";

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* 1. Hero — image-led, live HTML overlay */}
      <section className="relative w-full overflow-hidden border-b border-[var(--border)] bg-neutral-950">
        <div className="relative isolate min-h-[72vh] md:min-h-[80vh] w-full min-w-0">
          <div className="absolute inset-0 md:hidden" aria-hidden>
            <Image
              src="/brand/coach-leadership-kit-hero-mobile.png"
              alt=""
              fill
              sizes="100vw"
              priority
              className="object-cover object-center"
            />
          </div>
          <div className="absolute inset-0 hidden md:block" aria-hidden>
            <Image
              src="/brand/coach-leadership-kit-hero-desktop.png"
              alt=""
              fill
              sizes="100vw"
              priority
              className="object-cover object-[center_30%] lg:object-center"
            />
          </div>
          <div
            className="absolute inset-0 z-[1] pointer-events-none bg-gradient-to-t from-black via-black/75 to-black/35 md:bg-gradient-to-r md:from-black md:from-45% md:via-black/70 md:via-55% md:to-transparent"
            aria-hidden
          />
          <div className="relative z-10 flex min-h-[72vh] md:min-h-[80vh] w-full max-w-6xl mx-auto min-w-0 flex-col justify-end px-4 sm:px-6 py-10 pb-12 md:py-20 md:pb-24 md:justify-end md:items-start">
            <div className="flex w-full max-w-2xl flex-col gap-5 md:gap-8">
              <div className="space-y-3 md:space-y-5">
                <h1 className="text-2xl font-bold leading-snug tracking-tight text-white drop-shadow-sm sm:text-3xl md:text-5xl md:leading-tight lg:text-6xl">
                  Become the Coach Your Team Needs—Every Single Day.
                </h1>
                <p className="text-base leading-snug text-white/90 drop-shadow-sm sm:text-lg sm:leading-relaxed md:text-xl md:leading-relaxed">
                  Daily personal coaching powered by Pat Summitt AI. Plus a free
                  Leadership Kit to help you build your team&apos;s culture and
                  standards.
                </p>
              </div>
              <div className="w-full max-w-md">
                <Link href={subscribeHref} className={ctaHeroPrimaryClass}>
                  Get the Leadership Kit
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. What is Summitt Mindset? */}
      <section className="py-14 md:py-16 lg:py-20 border-b border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col gap-12 lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center">
            <div className="space-y-6 min-w-0">
              <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] tracking-tight">
                What is Summitt Mindset?
              </h2>
              <p className="text-[var(--muted)] leading-relaxed text-lg max-w-xl">
                It&apos;s built to help{" "}
                <span className="text-[var(--text)] font-medium">you</span>{" "}
                build discipline, clarity, and leadership—so you show up better
                for your team every single day.
              </p>
              <ul className="space-y-4 text-[var(--text)]">
                <li className="flex gap-3">
                  <span
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"
                    aria-hidden
                  />
                  <span>Daily 3–5 minute coaching texts</span>
                </li>
                <li className="flex gap-3">
                  <span
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"
                    aria-hidden
                  />
                  <span>Built on Pat Summitt principles</span>
                </li>
                <li className="flex gap-3">
                  <span
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"
                    aria-hidden
                  />
                  <span>Accountability for YOU as a coach</span>
                </li>
              </ul>
            </div>

            <div className="relative w-full flex justify-center lg:justify-end">
              <div className="relative w-full max-w-sm aspect-[9/16] max-h-[min(85vh,560px)]">
                <Image
                  src="/brand/summitt-mindset-phone.png"
                  alt="Summitt Mindset app on a phone"
                  fill
                  sizes="(max-width: 1023px) 80vw, 360px"
                  className="object-contain object-center drop-shadow-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. What’s Inside the Leadership Kit */}
      <section className="py-14 md:py-16 lg:py-20 bg-[var(--ink)] border-b border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col gap-12 lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center">
            <div className="space-y-8 min-w-0 order-1">
              <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] tracking-tight">
                What&apos;s Inside the Leadership Kit
              </h2>
              <ul className="space-y-4 text-[var(--text)] leading-relaxed">
                <li className="flex gap-3">
                  <span className="text-[var(--brand)] font-semibold shrink-0">
                    ·
                  </span>
                  <span>14-week leadership program</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-[var(--brand)] font-semibold shrink-0">
                    ·
                  </span>
                  <span>Step-by-step coaching structure</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-[var(--brand)] font-semibold shrink-0">
                    ·
                  </span>
                  <span>Team discussion guides</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-[var(--brand)] font-semibold shrink-0">
                    ·
                  </span>
                  <span>Built for middle &amp; high school teams</span>
                </li>
              </ul>
              <Link href={subscribeHref} className={ctaPrimaryClass}>
                Get the Leadership Kit
              </Link>
            </div>

            <div className="relative w-full flex justify-center lg:justify-end order-2">
              <div className="relative w-full max-w-lg aspect-[4/3] max-h-[min(70vh,440px)] lg:max-h-[480px]">
                <Image
                  src="/brand/coach-kit-contents.png"
                  alt="Contents of the Leadership Kit"
                  fill
                  sizes="(max-width: 1023px) 100vw, 50vw"
                  className="object-contain object-center"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. How It Works */}
      <section className="py-14 md:py-16 lg:py-20 border-b border-[var(--border)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] text-center mb-12 md:mb-14">
            How It Works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8 text-center md:text-left">
            <div className="space-y-3">
              <p className="text-sm font-semibold uppercase tracking-wide text-[var(--brand)]">
                Step 1
              </p>
              <h3 className="text-lg font-semibold text-[var(--text)]">
                Join Summitt Mindset
              </h3>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                Start your membership and unlock the full experience.
              </p>
            </div>
            <div className="space-y-3 md:border-x md:border-[var(--border)] md:px-6">
              <p className="text-sm font-semibold uppercase tracking-wide text-[var(--brand)]">
                Step 2
              </p>
              <h3 className="text-lg font-semibold text-[var(--text)]">
                Use it daily—personally
              </h3>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                Short daily coaching that keeps you grounded and accountable.
              </p>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-semibold uppercase tracking-wide text-[var(--brand)]">
                Step 3
              </p>
              <h3 className="text-lg font-semibold text-[var(--text)]">
                Bonus: we send you the Leadership Kit
              </h3>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                Tangible tools to reinforce standards with your team—we cover
                shipping.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Final CTA */}
      <section className="py-14 md:py-16 lg:py-20 pb-24 border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center space-y-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] leading-tight">
            Start Building Your Team&apos;s Culture Today
          </h2>
          <Link href={subscribeHref} className={ctaPrimaryClass}>
            Get the Leadership Kit
          </Link>
        </div>
      </section>
    </main>
  );
}
