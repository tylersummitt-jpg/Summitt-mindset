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
      className="border-b border-[var(--border)] bg-white shadow-sm ring-1 ring-black/[0.03]"
      role="region"
      aria-label="Guided follow-up"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-2.5">
        <p className="min-w-0 text-sm leading-snug text-gray-900">{sentence}</p>
        <Link href="/dashboard/guided-resolution" className="member-attention-cta-compact">
          Continue
        </Link>
      </div>
    </div>
  );
}
