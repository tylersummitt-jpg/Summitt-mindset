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

  return (
    <main>
      <section className="bg-[var(--ink)]">
        <div className="max-w-6xl mx-auto px-4 py-24 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-5">
              Get Pat Summitt’s coaching — every day.
            </h1>

            <p className="text-lg text-[var(--muted)] mb-8 leading-relaxed">
              A 7-minute daily practice and reflection system for personal
              growth, inspired by the Coach of the Century.
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
                  className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90 w-full sm:w-auto"
                >
                  Sign In →
                </Link>
              </div>
            )}

            {/* ======================================================
                Public CTA Section
               ====================================================== */}

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/subscribe"
                className="px-6 py-3 rounded-md text-sm font-semibold border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--brand-soft)] text-center"
              >
                Start 7-Day Free Trial
              </Link>

            </div>
          </div>

          <div className="relative w-full h-[420px] rounded-2xl overflow-hidden">
            <Image
              src="/brand/pat-hero.jpeg"
              alt="Coach Pat Summitt cutting down the net"
              fill
              priority
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover grayscale"
            />
          </div>
        </div>
      </section>
    </main>
  );
}
