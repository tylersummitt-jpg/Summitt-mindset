import { currentUser, auth } from "@clerk/nextjs/server";
import Link from "next/link";
import EvolutionRecommendationCard from "@/components/EvolutionRecommendationCard";
import { EVOLUTION_V1_SURFACED_ACTIONS } from "@/lib/v2-commitment-evolution-engine-v1";
import {
  syncEvolutionRecommendationForCommitment,
  type EvolutionRecommendationRow,
} from "@/lib/v2-commitment-evolution-recommendation";
import { evolutionV1SurfaceCopy } from "@/lib/v2-evolution-surface-copy";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { getPendingResolutionOrNull } from "@/lib/v2-guided-resolution";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { isUserFullyOnV2AccountabilityPath } from "@/lib/v2-cutover-gates";

export default async function DashboardPage() {
  const user = await currentUser();
  const { userId } = await auth();

  if (!user || !userId) return null;

  const metadata = user.publicMetadata as Record<string, unknown>;

  const fullyOnV2 = await isUserFullyOnV2AccountabilityPath(userId);
  if (!fullyOnV2) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center sm:py-24">
        <h1 className="text-2xl font-semibold text-gray-900">Set your commitment</h1>
        <p className="mt-4 text-sm leading-relaxed text-gray-600">
          To start your updated accountability system, Pat needs one clear commitment to coach you around.
        </p>
        <Link href="/dashboard/commitment-setup" className="member-primary-cta-lg mt-8">
          Set my commitment
        </Link>
      </main>
    );
  }

  const commitment = await getActiveCommitment(userId);
  const nowMs = Date.now();
  const effectiveAsk = commitment ? getEffectiveCoachingAsk(commitment, nowMs) : null;
  const normalizedBaseAsk = commitment
    ? commitment.behavior_statement.trim().replace(/\s+/g, " ")
    : "";
  const normalizedEffectiveAsk = effectiveAsk ? effectiveAsk.trim().replace(/\s+/g, " ") : "";
  const showSplitAsk = Boolean(effectiveAsk) && normalizedEffectiveAsk !== normalizedBaseAsk;
  const pending = commitment ? getPendingResolutionOrNull(commitment) : null;

  let evolutionRec: EvolutionRecommendationRow | null = null;
  if (commitment) {
    try {
      evolutionRec = await syncEvolutionRecommendationForCommitment({
        clerkUserId: userId,
        commitment,
      });
    } catch (e) {
      console.error("[dashboard] evolution sync failed", e);
    }
  }

  const showEvolutionCard =
    Boolean(commitment) &&
    !pending &&
    evolutionRec &&
    evolutionRec.status === "pending" &&
    EVOLUTION_V1_SURFACED_ACTIONS.has(evolutionRec.recommended_action);

  const evolutionCopy =
    showEvolutionCard && evolutionRec
      ? evolutionV1SurfaceCopy(evolutionRec.recommended_action)
      : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 pb-10 md:py-10 md:pb-10">
      <header className="mb-2">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Daily OS</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          Utilities for text check-ins, your current bar, guided follow-up, and Coach Pat recommendations. Proof
          and seasons live in Victory Room.
        </p>
      </header>
      <div className="space-y-8">
        {metadata?.smsEnabled !== true ? (
          <section className="rounded-2xl border border-[var(--border)] border-l-4 border-l-[var(--brand)] bg-white p-6 shadow-sm ring-1 ring-black/[0.03]">
            <h2 className="text-base font-semibold text-gray-900">Turn on accountability texts</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              Pat&apos;s daily check-ins happen by text. You can use the app without texts, but you&apos;ll miss
              the core accountability loop.
            </p>
            <Link href="/user" className="member-text-link-amber mt-4 inline-flex">
              Open Account
            </Link>
          </section>
        ) : null}

        {commitment ? (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-md shadow-gray-900/[0.05] ring-1 ring-black/[0.04]">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Current goal
            </h2>
            <p className="mt-2 text-base font-semibold text-gray-900">{commitment.title}</p>
            {showSplitAsk ? (
              <>
                <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">
                  <span className="font-medium text-gray-900">Your commitment: </span>
                  {commitment.behavior_statement}
                </p>
                <p className="mt-5 border-t border-gray-100 pt-5 text-sm leading-relaxed text-[var(--muted)]">
                  <span className="font-medium text-gray-900">Coach Pat is checking in on today: </span>
                  {effectiveAsk}
                </p>
              </>
            ) : (
              <p className="mt-5 border-t border-gray-100 pt-5 text-sm leading-relaxed text-[var(--muted)]">
                <span className="font-medium text-gray-900">Coach Pat is checking in on: </span>
                {commitment.behavior_statement}
              </p>
            )}
            {commitment.accountability_phase === "low_pressure_reactivation" ? (
              <p className="mt-4 border-l-2 border-amber-300 pl-3 text-xs italic leading-relaxed text-[var(--muted)]">
                You&apos;re in a low-pressure reactivation window—texts stay light until you re-engage.
              </p>
            ) : null}
            {!pending && commitment.accountability_phase !== "low_pressure_reactivation" ? (
              <Link
                href="/dashboard/update-goal"
                className="member-text-link-amber mt-5 inline-flex text-sm font-medium"
              >
                Update my goal
              </Link>
            ) : null}
          </section>
        ) : (
          <section className="rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm ring-1 ring-black/[0.03]">
            <h2 className="text-base font-semibold text-gray-900">No active commitment on file</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              Daily text accountability needs an active commitment with a clear behavior statement. If you
              expected checks already, finish saving your commitment in onboarding—or ask for help if you
              believe this is wrong.
            </p>
          </section>
        )}

        {pending ? (
          <section className="rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm ring-1 ring-black/[0.03]">
            <h2 className="text-base font-semibold text-gray-900">Finish your guided follow-up</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              {pending.kind === "identity_anchor_update"
                ? "Finish updating your identity line from your recent check-in."
                : pending.kind === "commitment_replace"
                  ? "Finish updating your accountability focus from your recent check-in."
                  : "Finish setting a smaller bar you can say yes to from your recent check-in."}
            </p>
            <Link href="/dashboard/guided-resolution" className="member-attention-cta mt-4">
              Open guided resolution
            </Link>
          </section>
        ) : null}

        {showEvolutionCard && evolutionRec && evolutionCopy?.headline ? (
          <EvolutionRecommendationCard
            recommendationId={evolutionRec.id}
            headline={evolutionCopy.headline}
            body={evolutionCopy.body}
          />
        ) : null}

        <p className="text-sm text-[var(--muted)]">
          <Link href="/dashboard/victory-room" className="font-medium text-gray-900 underline underline-offset-2">
            Victory Room
          </Link>
          {" "}
          — proof, seasons, and shareable moments.
        </p>
      </div>
    </main>
  );
}
