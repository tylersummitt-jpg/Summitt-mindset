import "server-only";

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { EVOLUTION_V1_SURFACED_ACTIONS } from "@/lib/v2-commitment-evolution-engine-v1";
import { evolutionVictoryRoomNudgeCopy } from "@/lib/v2-evolution-surface-copy";
import { getPendingResolutionOrNull } from "@/lib/v2-guided-resolution";
import { fetchPendingEvolutionRecommendation } from "@/lib/v2-commitment-evolution-recommendation";

/** Temporary hidden utility route until evolution actions move into Victory Room. */
export const EVOLUTION_REVIEW_HREF = "/dashboard";

export type VictoryEvolutionNudge = {
  headline: string;
  body: string;
  href: string;
};

export async function loadVictoryEvolutionNudge(args: {
  clerkUserId: string;
  commitment?: ActiveV2CommitmentRow | null;
}): Promise<VictoryEvolutionNudge | null> {
  const commitment =
    args.commitment ?? (await getActiveCommitment(args.clerkUserId));
  if (!commitment) return null;

  const pending = getPendingResolutionOrNull(commitment);
  if (pending) return null;

  let evolutionRec = null;
  try {
    evolutionRec = await fetchPendingEvolutionRecommendation(commitment.id);
  } catch (e) {
    console.error("[v2-victory-evolution-nudge] fetch pending evolution failed", e);
    return null;
  }

  if (
    !evolutionRec ||
    evolutionRec.status !== "pending" ||
    !EVOLUTION_V1_SURFACED_ACTIONS.has(evolutionRec.recommended_action)
  ) {
    return null;
  }

  const copy = evolutionVictoryRoomNudgeCopy(evolutionRec.recommended_action);
  if (!copy.headline.trim() || !copy.body.trim()) {
    return null;
  }

  return {
    headline: copy.headline,
    body: copy.body,
    href: EVOLUTION_REVIEW_HREF,
  };
}
