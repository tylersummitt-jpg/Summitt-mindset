import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

/**
 * True when the user has an active accountability season row for this commitment.
 * Used by Update Goal (same_season_sync requires this) and API guardrails.
 */
export async function hasActiveAccountabilitySeasonForCommitment(
  clerkUserId: string,
  commitmentId: string
): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("user_accountability_season")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .eq("commitment_id", commitmentId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error("[v2-accountability-season-alignment] lookup failed", {
      clerk_user_id: clerkUserId,
      commitment_id: commitmentId,
      message: error.message,
    });
    return false;
  }

  return Boolean(data?.id);
}
