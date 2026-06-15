import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import {
  ALL_PROOF_EVENT_FETCH_LIMIT,
  buildChronologicalProofList,
  deriveMergedProofMomentsFromEventWindow,
  groupEventRowsByCommitmentId,
  mapVictoryCommitmentEventRowsWithCommitmentId,
  type VictoryMoment,
} from "@/lib/v2-victory-room-view";

export type VictoryAllProofViewData = {
  allProofMoments: VictoryMoment[];
  allProofTruncated: boolean;
};

export async function loadVictoryAllProofView(
  clerkUserId: string
): Promise<VictoryAllProofViewData> {
  const { data: commitments, error: commitErr } = await supabaseServer
    .from("v2_commitment")
    .select("id, reactivation_entered_at")
    .eq("clerk_user_id", clerkUserId);

  if (commitErr) {
    console.error("[v2-victory-all-proof] commitments load failed", {
      clerk_user_id: clerkUserId,
      message: commitErr.message,
    });
  }

  const reactivationByCommitment = new Map<string, string | null>();
  for (const row of commitments ?? []) {
    if (typeof row.id !== "string") continue;
    const reAt = row.reactivation_entered_at;
    reactivationByCommitment.set(
      row.id,
      reAt != null && typeof reAt === "string" && reAt.trim() ? reAt : null
    );
  }

  const { data: events, error: evErr } = await supabaseServer
    .from("v2_commitment_event")
    .select("id, event_type, occurred_at, payload_json, commitment_id")
    .eq("clerk_user_id", clerkUserId)
    .order("occurred_at", { ascending: false })
    .limit(ALL_PROOF_EVENT_FETCH_LIMIT);

  if (evErr) {
    console.error("[v2-victory-all-proof] events load failed", {
      clerk_user_id: clerkUserId,
      message: evErr.message,
    });
  }

  const mapped = mapVictoryCommitmentEventRowsWithCommitmentId(events ?? []);
  const allProofTruncated = mapped.length >= ALL_PROOF_EVENT_FETCH_LIMIT;
  const grouped = groupEventRowsByCommitmentId(mapped);

  const flattened: VictoryMoment[] = [];
  for (const [commitmentId, eventRows] of grouped) {
    const { merged } = deriveMergedProofMomentsFromEventWindow({
      eventRowsFull: eventRows,
      reactivationEnteredAt: reactivationByCommitment.get(commitmentId) ?? null,
    });
    flattened.push(...merged);
  }

  const allProofMoments = buildChronologicalProofList(flattened, null);

  return {
    allProofMoments,
    allProofTruncated,
  };
}
