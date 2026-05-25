import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

/**
 * Clears Review acknowledgment on the current proposed commitment intake so SMS
 * requires a fresh Review after Identity changes during incomplete onboarding.
 */
export async function clearProposedCommitmentReviewAcknowledgment(
  clerkUserId: string
): Promise<void> {
  const { data: proposed } = await supabaseServer
    .from("v2_commitment")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!proposed?.id) {
    return;
  }

  const nowIso = new Date().toISOString();
  const { error } = await supabaseServer
    .from("v2_commitment_intake")
    .update({ review_acknowledged_at: null, updated_at: nowIso })
    .eq("commitment_id", proposed.id)
    .eq("clerk_user_id", clerkUserId);

  if (error) {
    console.error("[onboarding-reset-review-ack] update failed", {
      clerk_user_id: clerkUserId,
      commitment_id: proposed.id,
      message: error.message,
    });
  }
}
