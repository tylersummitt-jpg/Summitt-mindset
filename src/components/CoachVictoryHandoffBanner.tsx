import type { ReactElement } from "react";
import Link from "next/link";

/**
 * Low-risk coach CTA inside Victory Room (not a separate completion funnel).
 */
export function CoachVictoryHandoffBanner(): ReactElement {
  return (
    <div className="mb-6 rounded-xl border border-orange-200 bg-orange-50 px-4 py-4 text-sm text-gray-800">
      <p className="font-semibold text-gray-900">Coach Leadership Kit</p>
      <p className="mt-1 leading-relaxed">
        Your daily accountability is active. Add your shipping address so we can
        prepare your Pat Summitt Leadership Kit.
      </p>
      <Link
        href="/coach/setup"
        className="mt-3 inline-block font-medium text-[var(--brand)] underline underline-offset-2"
      >
        Add Kit shipping address →
      </Link>
    </div>
  );
}
