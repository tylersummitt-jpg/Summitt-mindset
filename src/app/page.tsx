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

function safeDayNumber(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return 1;
  return Math.floor(n);
}

export default async function HomePage() {
  const user = await currentUser();
  const md = (user?.publicMetadata ?? {}) as Record<string, any>;

  const onboardingCompleted = md?.onboardingCompleted === true;
  const isSubscribed = isSubscribedFromMetadata(md);
  const currentDay = safeDayNumber(md?.currentDay);

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

  return (
    <main>
      <section className="bg-[var(--ink)]">
        <div className="max-w-6xl mx-auto px-4 py-24 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-5">
              Pat Summitt is your personal leadership coach — every day.
            </h1>

            <p className="text-lg text-[var(--muted)] mb-8 leading-relaxed">
              A simple daily leadership practice inspired by the Coach of the
              Century. Reflect for a few minutes each day and watch the
              results in your life.
            </p>

            {user && (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm mb-6 space-y-4">
                <p className="text-sm font-semibold">
                  Welcome back{user.firstName ? `, ${user.firstName}` : ""}.
                </p>

                {showContinue && (
                  <>
                    <p className="text-sm text-[var(--muted)]">
                      Your practice is ready.
                    </p>

                    <Link
                      href={`/dashboard/day/${currentDay}`}
                      className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90 w-full sm:w-auto"
                    >
                      Continue Today’s Practice →
                    </Link>
                  </>
                )}

                {showResumeOnboarding && (
                  <>
                    <p className="text-sm text-[var(--muted)]">
                      Finish setup to personalize your training.
                    </p>

                    <Link
                      href="/onboarding"
                      className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90 w-full sm:w-auto"
                    >
                      Resume Onboarding →
                    </Link>
                  </>
                )}

                {showSubscribe && (
                  <>
                    <p className="text-sm text-[var(--muted)]">
                      Start your membership to begin training.
                    </p>

                    <Link
                      href="/subscribe"
                      className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90 w-full sm:w-auto"
                    >
                      Start Membership →
                    </Link>
                  </>
                )}
              </div>
            )}

            {!user && (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm mb-6">
                <p className="text-sm font-semibold mb-1">Already a member?</p>

                <p className="text-sm text-[var(--muted)] mb-5">
                  Sign in to go straight to today’s practice.
                </p>

                <Link
                  href="/sign-in"
                  className="text-[var(--brand)] font-semibold hover:underline"
                >
                  Sign In →
                </Link>
              </div>
            )}

            {/* ======================================================
                Public CTA Section
               ====================================================== */}

            <Link
              href="/subscribe"
              className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90 w-full sm:w-auto"
            >
              Start 7-Day Free Trial
            </Link>
            <p className="text-sm text-[var(--muted)] mt-2">
              7-day free trial • Cancel anytime • Available in the app or by daily text message.
            </p>
            <p className="text-sm text-[var(--muted)] mt-4">
              Not ready yet?{" "}
              <Link
                href="/pat-summitt-leadership-challenge"
                className="text-[var(--brand)] font-semibold hover:underline"
              >
                Try the free 7-Day Leadership Challenge
              </Link>
            </p>
          </div>

          <div className="relative w-full h-[420px] rounded-2xl overflow-hidden">
            <Image
              src="/brand/pat-hero.jpeg"
              alt="Coach Pat Summitt cutting down the net"
              fill
              priority
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------
          Quote of the Day
          -------------------------------------------------- */}
      {data?.quote && data?.url && (
        <section className="max-w-3xl mx-auto px-4 py-16 text-center">
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

      <section className="bg-white border-t">
        <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-6">
          <h2 className="text-3xl font-bold">
            Don&apos;t let inspiration stop at the{" "}
            <Link
              href="/pat-summitt-documentary"
              className="text-[var(--brand)] font-semibold hover:underline"
            >
              documentary
            </Link>
            .
          </h2>
          <p className="text-lg text-gray-700">
            Millions of people are rediscovering Pat Summitt through
            documentaries and stories about her life. But inspiration fades
            unless it becomes a habit.
          </p>
          <p className="text-lg text-gray-700">
            Summitt Mindset turns Pat Summitt&apos;s leadership principles
            into a simple daily practice — one reflection, one journal entry,
            one step forward.
          </p>
        </div>
      </section>

      <section className="bg-gray-50 border-t">
        <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-6">
          <h2 className="text-3xl font-bold">
            Not ready to subscribe yet? Try the free 7-day leadership challenge.
          </h2>

          <p className="text-lg text-gray-700">
            One leadership lesson, one reflection prompt, and one practical
            action each day—inspired by Pat&apos;s principles.
          </p>

          <p className="text-sm text-gray-600">
            Most people start with the{" "}
            <Link
              href="/subscribe"
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
        <div className="max-w-5xl mx-auto px-4 py-20 text-center space-y-8">

          <h2 className="text-3xl font-bold">
            Pat Summitt&apos;s Leadership Principles
          </h2>

          <p className="text-lg text-gray-700 max-w-3xl mx-auto">
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
      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] mb-4">
            How Summitt Mindset Works
          </h2>
          <p className="text-[var(--muted)] leading-relaxed">
            Three simple tools help you build discipline, leadership, and
            consistency one day at a time.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
              Daily Practice
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed mb-4">
              Start with a short note inspired by Coach Pat. You get one simple
              action and a reflection prompt for the day.
            </p>
            <Link
              href="/daily-practice"
              className="text-sm font-semibold text-[var(--brand)] hover:underline"
            >
              Explore Daily Practice →
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
    </main>
  );
}
