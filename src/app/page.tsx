// src/app/page.tsx

import Link from "next/link";
import Image from "next/image";
import { currentUser } from "@clerk/nextjs/server";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";

function isSubscribedFromMetadata(md: Record<string, any>) {
  const subscribedRaw = md?.summittSubscribed;
  const plan = md?.summittPlan;

  return (
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual"
  );
}

/** Hero primary CTA — matches coach kit ring offset on dark hero */
const ctaHeroPrimaryClass =
  "inline-flex items-center justify-center w-full sm:w-auto rounded-xl px-6 py-3 text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-95 shadow-md shadow-orange-500/20 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 md:px-8 md:py-4 md:text-base";

const heroValuePropGridClass =
  "mt-0 grid w-full min-w-0 max-w-xl list-none grid-cols-1 gap-3 p-0 md:mt-0 md:grid-cols-3 md:gap-2.5 lg:max-w-2xl lg:gap-3";

const heroValuePropChipClass =
  "flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3 shadow-sm shadow-black/25 backdrop-blur-sm ring-1 ring-inset ring-orange-500/10 md:flex-col md:items-start md:gap-2.5 md:px-3 md:py-3.5 lg:flex-row lg:items-center lg:gap-3 lg:px-3.5";

const heroValuePropIconBoxClass =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--brand)]/30 bg-[var(--brand)]/10 text-[var(--brand)] shadow-sm shadow-orange-950/30";

const heroValuePropIconClass = "h-5 w-5";

const heroValuePropLabelClass =
  "min-w-0 text-sm font-medium leading-snug text-white/90 drop-shadow-sm";

function HeroIconDailyTexts() {
  return (
    <svg
      className={heroValuePropIconClass}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 10h8" />
      <path d="M8 14h5" />
    </svg>
  );
}

function HeroIconFilmRoom() {
  return (
    <svg
      className={heroValuePropIconClass}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m10 10 6 3.5-6 3.5V10z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function HeroIconAskPat() {
  return (
    <svg
      className={heroValuePropIconClass}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      <path d="M9.5 11a1 1 0 1 0 0 .01" />
      <path d="M12.5 11a1 1 0 1 0 0 .01" />
      <path d="M15.5 11a1 1 0 1 0 0 .01" />
    </svg>
  );
}

const howItWorksIconClass = "h-14 w-14";

function HowItWorksIdentityIcon() {
  return (
    <svg
      className={howItWorksIconClass}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="8" r="4" className="text-white" />
      <path d="M5 20c0-3.5 3-5 7-5s7 1.5 7 5" className="text-white" />
    </svg>
  );
}

function HowItWorksGoalIcon() {
  return (
    <svg
      className={howItWorksIconClass}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8" className="text-white" />
      <circle cx="12" cy="12" r="4" className="text-white" />
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2" className="text-[var(--brand)]" />
      <path d="m16 8-2 2 2 2" className="text-[var(--brand)]" />
    </svg>
  );
}

function HowItWorksTextsIcon() {
  return (
    <svg
      className={howItWorksIconClass}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path
        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        className="text-white"
      />
      <circle cx="9" cy="11" r="1" fill="var(--brand)" stroke="none" />
      <circle cx="12" cy="11" r="1" fill="var(--brand)" stroke="none" />
      <circle cx="15" cy="11" r="1" fill="var(--brand)" stroke="none" />
    </svg>
  );
}

function HowItWorksGrowthIcon() {
  return (
    <svg
      className={howItWorksIconClass}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="7" r="3.5" className="text-white" />
      <path d="M5 20c0-3 2.5-4.5 7-4.5s7 1.5 7 4.5" className="text-white" />
      <path d="M16 10l2-2M16 10v3" className="text-[var(--brand)]" />
    </svg>
  );
}

const howItWorksStepCardClass =
  "relative flex min-h-[22rem] flex-col rounded-3xl border border-white/10 bg-white/[0.03] px-6 pb-8 pt-12 text-center shadow-lg shadow-black/25 backdrop-blur-sm sm:min-h-[23rem]";

export default async function HomePage() {
  const user = await currentUser();
  const md = (user?.publicMetadata ?? {}) as Record<string, any>;

  const onboardingCompleted = md?.onboardingCompleted === true;
  const isSubscribed = isSubscribedFromMetadata(md);

  const showContinue =
    !!user && onboardingCompleted === true && isSubscribed === true;

  const showResumeOnboarding =
    !!user && isSubscribed === true && onboardingCompleted !== true;

  const showSubscribe = !!user && isSubscribed !== true;

  let data: { quote?: string; url?: string } = {};

  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;

    if (baseUrl) {
      const res = await fetch(`${baseUrl}/api/quote-of-the-day`, {
        cache: "no-store",
      });

      if (res.ok) {
        data = (await res.json()) as { quote?: string; url?: string };
      }
    }
  } catch {
    data = {};
  }

  const signInSubscribeHref = `/sign-in?redirect_url=${encodeURIComponent("/subscribe")}`;

  return (
    <div>
      {/* Homepage hero — image-led, live HTML overlay */}
      <section className="relative w-full overflow-hidden border-b border-[var(--border)] bg-neutral-950">
        <div className="relative isolate min-h-[72vh] md:min-h-[80vh] w-full min-w-0">
          <div className="absolute inset-0 md:hidden" aria-hidden>
            <Image
              src="/brand/home-hero-mobile.png"
              alt=""
              fill
              sizes="100vw"
              priority
              className="object-cover object-center"
            />
          </div>
          <div className="absolute inset-0 hidden md:block" aria-hidden>
            <Image
              src="/brand/home-hero-desktop.png"
              alt=""
              fill
              sizes="100vw"
              priority
              className="object-cover object-[center_30%] lg:object-center"
            />
          </div>
          <div
            className="absolute inset-0 z-[1] pointer-events-none bg-[linear-gradient(to_top,rgba(0,0,0,0.88)_0%,rgba(0,0,0,0.38)_42%,rgba(0,0,0,0.12)_58%,transparent_78%)] md:bg-[linear-gradient(90deg,rgba(0,0,0,0.94)_0%,rgba(0,0,0,0.52)_14%,rgba(0,0,0,0.2)_26%,rgba(0,0,0,0.06)_36%,transparent_46%)]"
            aria-hidden
          />
          <div className="relative z-10 flex min-h-[72vh] md:min-h-[80vh] w-full max-w-6xl mx-auto min-w-0 flex-col justify-end px-4 sm:px-6 py-10 pb-12 md:mx-0 md:ml-6 lg:ml-10 xl:ml-12 md:mr-auto md:py-20 md:pb-24 md:justify-end md:items-start">
            <div className="flex w-full max-w-2xl flex-col gap-5 md:gap-8 min-w-0">
              <div className="space-y-3 md:space-y-5">
                <h1 className="text-2xl font-bold leading-snug tracking-tight text-white drop-shadow-sm sm:text-3xl md:text-5xl md:leading-tight lg:text-6xl">
                  Pat Summitt is your personal coach - every day.
                </h1>
                <p className="text-base leading-snug text-white/90 drop-shadow-sm sm:text-lg sm:leading-relaxed md:text-xl md:leading-relaxed">
                  Get a daily text message that holds you accountable to one clear commitment and become
                  the person you have always wanted to be.
                </p>
              </div>

              {user && (
                <div className="rounded-2xl border border-white/15 bg-white/95 p-6 shadow-lg backdrop-blur-sm space-y-4">
                  <p className="text-sm font-semibold text-[var(--text)]">
                    Welcome back{user.firstName ? `, ${user.firstName}` : ""}.
                  </p>

                  {showContinue && (
                    <>
                      <p className="text-sm text-[var(--muted)]">
                        Victory Room is ready—your commitment, daily text check-ins, and proof in one place.
                      </p>

                      <Link href={MEMBER_APP_HOME_PATH} className={ctaHeroPrimaryClass}>
                        Open Victory Room →
                      </Link>
                    </>
                  )}

                  {showResumeOnboarding && (
                    <>
                      <p className="text-sm text-[var(--muted)]">
                        Finish setup so Pat can hold you to your commitment by text.
                      </p>

                      <Link href="/onboarding" className={ctaHeroPrimaryClass}>
                        Resume Onboarding →
                      </Link>
                    </>
                  )}

                  {showSubscribe && (
                    <>
                      <p className="text-sm text-[var(--muted)]">
                        Start your membership to turn on daily text accountability and the full app.
                      </p>

                      <Link href="/subscribe" className={ctaHeroPrimaryClass}>
                        Start Membership →
                      </Link>
                    </>
                  )}
                </div>
              )}

              {!user && (
                <>
                  <div className="w-full max-w-md">
                    <Link href={signInSubscribeHref} className={ctaHeroPrimaryClass}>
                      Start 7-Day Free Trial
                    </Link>
                  </div>
                  <div className="flex flex-col gap-3 md:gap-4">
                    <p className="text-sm text-white/80 drop-shadow-sm">
                      Then $19.99 a month • Cancel anytime
                    </p>
                    <ul
                      className={heroValuePropGridClass}
                      aria-label="What's included"
                    >
                      <li className={heroValuePropChipClass}>
                        <span className={heroValuePropIconBoxClass} aria-hidden>
                          <HeroIconDailyTexts />
                        </span>
                        <span className={heroValuePropLabelClass}>
                          Daily coaching texts
                        </span>
                      </li>
                      <li className={heroValuePropChipClass}>
                        <span className={heroValuePropIconBoxClass} aria-hidden>
                          <HeroIconFilmRoom />
                        </span>
                        <span className={heroValuePropLabelClass}>
                          100+ Film Room videos
                        </span>
                      </li>
                      <li className={heroValuePropChipClass}>
                        <span className={heroValuePropIconBoxClass} aria-hidden>
                          <HeroIconAskPat />
                        </span>
                        <span className={heroValuePropLabelClass}>
                          Ask Pat guidance
                        </span>
                      </li>
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------
          Member testimonial
          -------------------------------------------------- */}
      <section className="border-y border-gray-100 bg-white px-4 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        <div className="relative mx-auto max-w-5xl min-w-0 text-center">
          <div className="relative z-[1] flex items-center justify-center gap-3 sm:gap-4">
            <span className="h-px w-12 bg-orange-500/40 sm:w-20" aria-hidden />
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-[var(--brand)] sm:text-base">
              MEMBER FEEDBACK
            </p>
            <span className="h-px w-12 bg-orange-500/40 sm:w-20" aria-hidden />
          </div>

          <blockquote className="relative z-[1] mx-auto mt-8 min-w-0 max-w-4xl sm:mt-10">
            <p className="text-2xl font-semibold leading-relaxed text-gray-950 sm:text-3xl sm:leading-snug lg:text-4xl lg:leading-snug">
              &ldquo;I&apos;ve really enjoyed the daily text messages. Some days they remind me,
              and some days they challenge me. Either way, they help me work on becoming a better
              version of myself.&rdquo;
            </p>
            <div
              className="mx-auto mt-6 h-1 w-12 rounded-full bg-[var(--brand)]"
              aria-hidden
            />
            <footer className="mt-5 text-lg font-bold text-[var(--brand)] sm:text-xl">
              Jackie D.
            </footer>
          </blockquote>
        </div>
      </section>

      {/* --------------------------------------------------
          Quote of the Day
          -------------------------------------------------- */}
      {data?.quote && data?.url && (
        <section className="max-w-3xl mx-auto px-4 py-10 sm:py-14 md:py-16 text-center">
          <h2 className="text-2xl font-bold text-[var(--text)] mb-6">
            Pat Summitt Quote of the Day
          </h2>
          <blockquote className="text-xl leading-relaxed border-l-4 border-[var(--brand)] pl-6 py-4 text-[var(--text)] text-left">
            {data.quote}
          </blockquote>
          <div className="text-left mt-4">
            <Link
              href={data.url}
              className="text-sm font-semibold text-[var(--brand)] hover:underline"
            >
              Read more
            </Link>
          </div>
        </section>
      )}

      {/* --------------------------------------------------
          How Summitt Mindset Works
          -------------------------------------------------- */}
      <section className="relative overflow-hidden border-t border-[var(--border)] bg-neutral-950 px-4 py-16 text-white sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(249,115,22,0.14),transparent_55%),radial-gradient(ellipse_60%_40%_at_80%_100%,rgba(59,130,246,0.08),transparent_50%)]"
          aria-hidden
        />
        <div className="relative mx-auto max-w-7xl min-w-0">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
              How Summitt Mindset Works
            </h2>
            <p className="mt-4 text-base leading-relaxed text-white/70 sm:text-lg">
              A simple, honest path to lasting consistency.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-8 pt-2 md:grid-cols-2 md:gap-6 xl:grid-cols-4 xl:gap-5">
            <article className={howItWorksStepCardClass}>
              <span className="absolute -top-5 left-1/2 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full border-2 border-[var(--brand)] bg-neutral-950 text-lg font-bold tabular-nums text-[var(--brand)] shadow-md shadow-black/40">
                1
              </span>
              <div className="mx-auto mb-6 mt-2 flex h-24 w-24 items-center justify-center rounded-full border border-white/15 bg-black/25 sm:h-28 sm:w-28">
                <HowItWorksIdentityIcon />
              </div>
              <h3 className="text-xl font-bold leading-tight text-white sm:text-2xl">
                Define your identity
              </h3>
              <div className="mx-auto mt-5 h-1 w-10 rounded-full bg-[var(--brand)]" aria-hidden />
              <p className="mt-5 flex-1 text-base leading-relaxed text-white/65">
                Decide who you want to become.
              </p>
            </article>

            <article className={howItWorksStepCardClass}>
              <span className="absolute -top-5 left-1/2 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full border-2 border-[var(--brand)] bg-neutral-950 text-lg font-bold tabular-nums text-[var(--brand)] shadow-md shadow-black/40">
                2
              </span>
              <div className="mx-auto mb-6 mt-2 flex h-24 w-24 items-center justify-center rounded-full border border-white/15 bg-black/25 sm:h-28 sm:w-28">
                <HowItWorksGoalIcon />
              </div>
              <h3 className="text-xl font-bold leading-tight text-white sm:text-2xl">
                Choose your current goal
              </h3>
              <div className="mx-auto mt-5 h-1 w-10 rounded-full bg-[var(--brand)]" aria-hidden />
              <p className="mt-5 flex-1 text-base leading-relaxed text-white/65">
                Pick one goal to focus on right now.
              </p>
            </article>

            <article className={howItWorksStepCardClass}>
              <span className="absolute -top-5 left-1/2 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full border-2 border-[var(--brand)] bg-neutral-950 text-lg font-bold tabular-nums text-[var(--brand)] shadow-md shadow-black/40">
                3
              </span>
              <div className="mx-auto mb-6 mt-2 flex h-24 w-24 items-center justify-center rounded-full border border-white/15 bg-black/25 sm:h-28 sm:w-28">
                <HowItWorksTextsIcon />
              </div>
              <h3 className="text-xl font-bold leading-tight text-white sm:text-2xl">
                Respond to daily texts from Pat Summitt AI
              </h3>
              <div className="mx-auto mt-5 h-1 w-10 rounded-full bg-[var(--brand)]" aria-hidden />
              <p className="mt-5 flex-1 text-base leading-relaxed text-white/65">
                Check in honestly and stay accountable every day.
              </p>
            </article>

            <article className={howItWorksStepCardClass}>
              <span className="absolute -top-5 left-1/2 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full border-2 border-[var(--brand)] bg-neutral-950 text-lg font-bold tabular-nums text-[var(--brand)] shadow-md shadow-black/40">
                4
              </span>
              <div className="mx-auto mb-6 mt-2 flex h-24 w-24 items-center justify-center rounded-full border border-white/15 bg-black/25 sm:h-28 sm:w-28">
                <HowItWorksGrowthIcon />
              </div>
              <h3 className="text-xl font-bold leading-tight text-white sm:text-2xl">
                Become the person you want to be
              </h3>
              <div className="mx-auto mt-5 h-1 w-10 rounded-full bg-[var(--brand)]" aria-hidden />
              <p className="mt-5 flex-1 text-base leading-relaxed text-white/65">
                Build proof, confidence, and real consistency over time.
              </p>
            </article>
          </div>

          <div className="mt-12 flex justify-center sm:mt-14">
            <Link href={signInSubscribeHref} className={ctaHeroPrimaryClass}>
              Start Your 7-Day Free Trial
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
