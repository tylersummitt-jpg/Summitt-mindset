// src/app/page.tsx

import Link from "next/link";
import Image from "next/image";
import { currentUser } from "@clerk/nextjs/server";

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
                        Your dashboard is ready—commitment, SMS check-ins, and Victory Room.
                      </p>

                      <Link href="/dashboard" className={ctaHeroPrimaryClass}>
                        Open dashboard →
                      </Link>
                    </>
                  )}

                  {showResumeOnboarding && (
                    <>
                      <p className="text-sm text-[var(--muted)]">
                        Finish setup so Pat can hold you to your commitment on SMS.
                      </p>

                      <Link href="/onboarding" className={ctaHeroPrimaryClass}>
                        Resume Onboarding →
                      </Link>
                    </>
                  )}

                  {showSubscribe && (
                    <>
                      <p className="text-sm text-[var(--muted)]">
                        Start your membership to turn on SMS accountability and the full app.
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
                  <p className="text-sm text-white/80 drop-shadow-sm">
                    7-day free trial • Cancel anytime
                  </p>
                </>
              )}
            </div>
          </div>
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

      <section className="bg-gray-50 border-t">
        <div className="max-w-4xl mx-auto px-4 py-12 sm:py-16 md:py-20 text-center space-y-6">
          <h2 className="text-2xl sm:text-3xl font-bold">
            Not ready to subscribe yet? Try the free 7-day leadership challenge.
          </h2>

          <p className="text-base sm:text-lg text-gray-700">
            One leadership lesson, one reflection prompt, and one practical
            action each day—inspired by Pat&apos;s principles.
          </p>

          <p className="text-sm text-gray-600">
            Most people start with the{" "}
            <Link
              href={user ? "/subscribe" : signInSubscribeHref}
              className="text-[var(--brand)] font-semibold hover:underline"
            >
              7-day free trial
            </Link>
            .
          </p>

          <p>
            <Link
              href="/pat-summitt-leadership-challenge"
              className="text-[var(--brand)] font-semibold hover:underline"
            >
              Try the free 7-Day Leadership Challenge
            </Link>
          </p>
        </div>
      </section>

      <section className="bg-white border-t">
        <div className="max-w-5xl mx-auto px-4 py-12 sm:py-16 md:py-20 text-center space-y-8">

          <h2 className="text-2xl sm:text-3xl font-bold">
            Pat Summitt&apos;s Leadership Principles
          </h2>

          <p className="text-base sm:text-lg text-gray-700 max-w-3xl mx-auto">
            Pat Summitt didn&apos;t just build winning teams. She built
            leaders. Her principles of discipline, accountability,
            consistency, and team-first leadership continue to shape how
            people lead today.
          </p>

          <div className="grid md:grid-cols-3 gap-6 mt-8">

            <Link
              href="/pat-summitt-discipline"
              className="block border rounded-lg p-6 hover:shadow-md transition"
            >
              <h3 className="font-semibold text-lg mb-2">Discipline</h3>
              <p className="text-gray-600 text-sm">
                Pat believed discipline creates freedom and long-term
                success.
              </p>
            </Link>

            <Link
              href="/pat-summitt-accountability"
              className="block border rounded-lg p-6 hover:shadow-md transition"
            >
              <h3 className="font-semibold text-lg mb-2">Accountability</h3>
              <p className="text-gray-600 text-sm">
                Leaders hold themselves and others to high standards.
              </p>
            </Link>

            <Link
              href="/pat-summitt-team-culture"
              className="block border rounded-lg p-6 hover:shadow-md transition"
            >
              <h3 className="font-semibold text-lg mb-2">Team Culture</h3>
              <p className="text-gray-600 text-sm">
                Great teams are built on trust, standards, and shared
                purpose.
              </p>
            </Link>

          </div>

        </div>
      </section>

      {/* --------------------------------------------------
          How Summitt Mindset Works
          -------------------------------------------------- */}
      <section className="max-w-6xl mx-auto px-4 py-12 sm:py-16 md:py-20">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] mb-4">
            How Summitt Mindset Works
          </h2>
          <p className="text-[var(--muted)] leading-relaxed">
            SMS accountability on your commitment, optional depth in the app, and Victory Room when you want proof.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
              Optional depth
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed mb-4">
              Films, prompts, and reflection live here when you want more than SMS—secondary to your commitment bar.
            </p>
            <Link
              href="/daily-practice"
              className="text-sm font-semibold text-[var(--brand)] hover:underline"
            >
              Explore optional depth →
            </Link>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
              Ask Pat
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed mb-4">
              Ask leadership questions and receive guidance inspired by Pat
              Summitt’s philosophy and standards.
            </p>
            <Link
              href="/ask-pat-preview"
              className="text-sm font-semibold text-[var(--brand)] hover:underline"
            >
              See Ask Pat →
            </Link>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
              Film Room
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed mb-4">
              Watch leadership lessons from respected voices in sports, media,
              and business.
            </p>
            <Link
              href="/film-room-preview"
              className="text-sm font-semibold text-[var(--brand)] hover:underline"
            >
              Explore Film Room →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
