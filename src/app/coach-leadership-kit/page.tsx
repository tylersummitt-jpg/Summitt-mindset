import Image from "next/image";
import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { CoachLeadershipKitTrackedLink } from "@/app/coach-leadership-kit/coach-leadership-kit-tracked-link";
import {
  COACH_SIGN_UP_HREF,
  COACH_SUBSCRIBE_PATH,
} from "@/lib/coach-funnel-links";

const COACH_LANDING_PATH = "/coach-leadership-kit";
const COACH_OG_IMAGE_URL =
  "https://summittmindset.com/brand/coach-leadership-kit-hero-desktop.png";

export const metadata: Metadata = {
  title: "Pat Summitt Leadership Kit for Coaches",
  description:
    "A coach-focused Summitt Mindset membership offer with daily text accountability and a complimentary Pat Summitt Leadership Kit—we cover shipping. Summitt Mindset is for anyone seeking serious accountability; this offer is tailored for sports coaches.",
  alternates: {
    canonical: `https://summittmindset.com${COACH_LANDING_PATH}`,
  },
  openGraph: {
    title: "Pat Summitt Leadership Kit for Coaches | Summitt Mindset",
    description:
      "Coach-focused membership: daily accountability with a complimentary Pat Summitt Leadership Kit (shipping included). The full Summitt Mindset experience is broader—this page highlights an offer for coaches.",
    url: `https://summittmindset.com${COACH_LANDING_PATH}`,
    type: "website",
    images: [
      {
        url: COACH_OG_IMAGE_URL,
        alt: "Coach Pat Summitt Leadership Kit offer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pat Summitt Leadership Kit for Coaches | Summitt Mindset",
    description:
      "Coach-focused Summitt Mindset membership with daily accountability and a complimentary Leadership Kit—we cover shipping.",
    images: [COACH_OG_IMAGE_URL],
  },
};

const ctaPrimaryClass =
  "inline-flex items-center justify-center w-full sm:w-auto rounded-xl px-8 py-4 text-base font-semibold text-white bg-[var(--brand)] hover:opacity-95 shadow-md shadow-orange-500/20 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

/** Hero CTA: ring offset for dark hero; tighter on mobile, full size from md */
const ctaHeroPrimaryClass =
  "inline-flex items-center justify-center w-full sm:w-auto rounded-xl px-6 py-3 text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-95 shadow-md shadow-orange-500/20 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 md:px-8 md:py-4 md:text-base";

/** “Watch the Video” on dark mini-hero — readable + tap target */
const howItWorksVideoButtonClass =
  "inline-flex w-full min-w-0 items-center justify-center rounded-xl bg-[var(--brand)] px-6 py-3 text-sm font-semibold text-neutral-950 shadow-md shadow-orange-500/20 transition hover:-translate-y-0.5 hover:bg-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 sm:w-auto";

export default async function CoachLeadershipKitPage() {
  const user = await currentUser();
  const leadershipKitHref = user ? COACH_SUBSCRIBE_PATH : COACH_SIGN_UP_HREF;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* 1. Hero — image-led, live HTML overlay */}
      <section className="relative w-full overflow-hidden border-b border-[var(--border)] bg-neutral-950">
        <div className="relative isolate min-h-[72vh] md:min-h-[80vh] w-full min-w-0">
          <div className="absolute inset-0 md:hidden" aria-hidden>
            <Image
              src="/brand/coach-leadership-kit-hero-mobile.png"
              alt=""
              fill
              sizes="(max-width: 767px) 100vw, 0px"
              priority
              className="object-cover object-center"
            />
          </div>
          <div className="absolute inset-0 hidden md:block" aria-hidden>
            <Image
              src="/brand/coach-leadership-kit-hero-desktop.png"
              alt=""
              fill
              sizes="(min-width: 768px) 100vw, 0px"
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
              <div className="space-y-4 md:space-y-5">
                <h1 className="text-2xl font-bold leading-snug tracking-tight text-white drop-shadow-sm sm:text-3xl md:text-5xl md:leading-tight lg:text-6xl">
                  You&apos;re in the right place, Coach.
                </h1>
                <p className="text-base leading-snug text-white/90 drop-shadow-sm sm:text-lg sm:leading-relaxed md:text-xl md:leading-relaxed">
                  Join Summitt Mindset, complete onboarding, and we&apos;ll reach
                  out to customize and ship your Pat Summitt Leadership Kit.
                  Shipping is covered.
                </p>
                <ol className="grid list-none gap-3 pt-1 sm:gap-3.5">
                  <li className="flex gap-3 text-left">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold tabular-nums text-white"
                      aria-hidden
                    >
                      1
                    </span>
                    <span className="min-w-0 pt-0.5 text-sm font-medium leading-snug text-white/95 sm:text-base">
                      Create your account
                    </span>
                  </li>
                  <li className="flex gap-3 text-left">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold tabular-nums text-white"
                      aria-hidden
                    >
                      2
                    </span>
                    <span className="min-w-0 pt-0.5 text-sm font-medium leading-snug text-white/95 sm:text-base">
                      Start your membership
                    </span>
                  </li>
                  <li className="flex gap-3 text-left">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold tabular-nums text-white"
                      aria-hidden
                    >
                      3
                    </span>
                    <span className="min-w-0 pt-0.5 text-sm font-medium leading-snug text-white/95 sm:text-base">
                      Complete onboarding
                    </span>
                  </li>
                  <li className="flex gap-3 text-left">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold tabular-nums text-white"
                      aria-hidden
                    >
                      4
                    </span>
                    <span className="min-w-0 pt-0.5 text-sm font-medium leading-snug text-white/95 sm:text-base">
                      We reach out to ship your Leadership Kit
                    </span>
                  </li>
                </ol>
              </div>
              <div className="flex w-full max-w-md">
                <CoachLeadershipKitTrackedLink
                  href={leadershipKitHref}
                  className={ctaHeroPrimaryClass}
                  cta="hero"
                >
                  Start Membership + Unlock Kit
                </CoachLeadershipKitTrackedLink>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. How It Works walkthrough — image-led mini hero */}
      <section
        className="relative w-full overflow-hidden border-b border-[var(--border)] bg-neutral-950"
        aria-label="Watch How It Works walkthrough"
      >
        <div className="relative isolate min-h-[420px] min-w-0 sm:min-h-[460px] md:min-h-[500px] lg:min-h-[540px] w-full">
          <div className="absolute inset-0 md:hidden" aria-hidden>
            <Image
              src="/brand/candace_pat_game_mobile.PNG"
              alt=""
              fill
              sizes="(max-width: 767px) 100vw, 0px"
              className="object-cover object-center"
            />
          </div>
          <div className="absolute inset-0 hidden md:block" aria-hidden>
            <Image
              src="/brand/candace_pat_game_desktop.PNG"
              alt=""
              fill
              sizes="(min-width: 768px) 100vw, 0px"
              className="object-cover object-center"
            />
          </div>
          <div
            className="absolute inset-0 z-[1] pointer-events-none bg-gradient-to-t from-black via-black/85 to-black/25 md:bg-gradient-to-r md:from-black md:from-40% md:via-black/75 md:via-58% md:to-transparent"
            aria-hidden
          />
          <div className="relative z-10 flex min-h-[420px] w-full max-w-6xl mx-auto min-w-0 flex-col justify-end items-start px-4 py-10 sm:min-h-[460px] sm:px-6 sm:py-12 md:min-h-[500px] md:py-14 lg:min-h-[540px] lg:py-16">
            <div className="flex w-full min-w-0 max-w-2xl flex-col gap-4 text-left sm:gap-5">
              <h2 className="text-2xl font-bold leading-tight tracking-tight text-white drop-shadow-sm sm:text-3xl md:text-4xl">
                Watch How It Works
              </h2>
              <p className="text-base leading-relaxed text-white/90 drop-shadow-sm sm:text-lg">
                See exactly what your membership unlocks: the accountability
                system, the Leadership Kit, and how we help you coach with Pat
                Summitt&apos;s principles.
              </p>
              <div className="flex w-full min-w-0 max-w-md pt-1">
                <Link
                  href="/coach-leadership-kit/how-it-works"
                  className={howItWorksVideoButtonClass}
                >
                  Watch the Video
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. How coaches get the Kit */}
      <section className="py-14 md:py-16 lg:py-20 border-b border-[var(--border)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] text-center mb-10 md:mb-12">
            How coaches get the Kit
          </h2>
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            <div className="space-y-2 text-center lg:text-left">
              <p className="text-sm font-semibold uppercase tracking-wide text-[var(--brand)]">
                Step 1
              </p>
              <h3 className="text-lg font-semibold text-[var(--text)]">
                Create your account
              </h3>
              <p className="text-sm text-[var(--muted)] leading-snug">
                Start with a quick Summitt Mindset account.
              </p>
            </div>
            <div className="space-y-2 text-center lg:text-left">
              <p className="text-sm font-semibold uppercase tracking-wide text-[var(--brand)]">
                Step 2
              </p>
              <h3 className="text-lg font-semibold text-[var(--text)]">
                Start your membership
              </h3>
              <p className="text-sm text-[var(--muted)] leading-snug">
                Choose your monthly or annual membership to unlock the full
                experience.
              </p>
            </div>
            <div className="space-y-2 text-center lg:text-left">
              <p className="text-sm font-semibold uppercase tracking-wide text-[var(--brand)]">
                Step 3
              </p>
              <h3 className="text-lg font-semibold text-[var(--text)]">
                Complete onboarding
              </h3>
              <p className="text-sm text-[var(--muted)] leading-snug">
                Set up your daily accountability texts, commitment, and
                personalization.
              </p>
            </div>
            <div className="space-y-2 text-center lg:text-left">
              <p className="text-sm font-semibold uppercase tracking-wide text-[var(--brand)]">
                Step 4
              </p>
              <h3 className="text-lg font-semibold text-[var(--text)]">
                We follow up about your Kit
              </h3>
              <p className="text-sm text-[var(--muted)] leading-snug">
                After onboarding, our team will reach out to customize and ship
                your Pat Summitt Leadership Kit. Shipping is covered.
              </p>
            </div>
          </div>
          <p className="mt-10 max-w-2xl mx-auto text-center text-sm text-[var(--muted)] leading-snug">
            Membership comes first—the Kit is a coach bonus after you finish
            onboarding. Shipping is covered.
          </p>
        </div>
      </section>

      {/* 4. Final CTA */}
      <section className="py-14 md:py-16 lg:py-20 pb-24 border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center space-y-6">
          <div className="space-y-3">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] leading-tight">
              Ready to start your membership?
            </h2>
            <p className="text-base leading-relaxed text-[var(--muted)]">
              Complete setup, activate daily accountability, and we&apos;ll follow
              up about your Leadership Kit.
            </p>
          </div>
          <CoachLeadershipKitTrackedLink
            href={leadershipKitHref}
            className={ctaPrimaryClass}
            cta="footer"
          >
            Start Membership + Unlock Kit
          </CoachLeadershipKitTrackedLink>
        </div>
      </section>
    </div>
  );
}
