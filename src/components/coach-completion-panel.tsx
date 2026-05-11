import type { ReactElement } from "react";
import Link from "next/link";

/**
 * Presentational coach funnel completion — display only.
 * Used on /onboarding/complete (after Finish Setup) and /coach/complete (fallback).
 */

const bodyClass =
  "text-base font-normal leading-relaxed text-gray-600";

const secondaryCtaClass =
  "inline-flex w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-6 py-3.5 text-base font-semibold text-gray-900 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

export function CoachCompletionPanel(): ReactElement {
  return (
    <div className="mx-auto w-full max-w-lg rounded-2xl border border-white/15 bg-white/95 p-6 text-center shadow-xl sm:p-8">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
        You&apos;re All Set.
      </h1>
      <p className={`mt-4 ${bodyClass}`}>
        Your Summitt Mindset membership is active, your daily accountability is
        ready, and your Pat Summitt Leadership Kit bonus is being prepared.
      </p>
      <p className={`mt-4 ${bodyClass}`}>
        A member of the Summitt Mindset team will reach out to confirm your mailing
        address and customize your Kit.
      </p>

      <div className="mt-10 flex flex-col gap-3 sm:mx-auto sm:max-w-md">
        <Link
          href="/film-room"
          className="inline-flex w-full items-center justify-center rounded-xl bg-[var(--brand)] px-6 py-3.5 text-base font-semibold text-white shadow-md shadow-orange-500/20 transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        >
          Start With Film Room
        </Link>
        <Link href="/ask-pat" className={secondaryCtaClass}>
          Ask Pat
        </Link>
        <Link href="/dashboard" className={secondaryCtaClass}>
          Dashboard
        </Link>
      </div>
    </div>
  );
}
