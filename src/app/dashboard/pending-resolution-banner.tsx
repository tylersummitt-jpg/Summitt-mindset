import Link from "next/link";
import type { V2PendingResolutionKind } from "@/lib/v2-guided-resolution";

const COPY: Record<V2PendingResolutionKind, string> = {
  identity_anchor_update: "Finish updating your identity line from your recent check-in.",
  commitment_replace: "Finish updating your accountability focus from your recent check-in.",
  commitment_tighten: "Finish setting a smaller bar you can say yes to from your recent check-in.",
};

export function PendingResolutionBanner({ kind }: { kind: V2PendingResolutionKind }) {
  const sentence = COPY[kind];

  return (
    <div
      className="border-b border-amber-200/90 bg-amber-50/95 text-amber-950"
      role="region"
      aria-label="Guided follow-up"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="text-sm leading-snug text-amber-950/95">{sentence}</p>
        <Link
          href="/dashboard/guided-resolution"
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-amber-900 px-3 py-1.5 text-sm font-medium text-amber-50 hover:bg-amber-950"
        >
          Continue
        </Link>
      </div>
    </div>
  );
}
