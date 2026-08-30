import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

/** Durable inbound job status parked for Tyler's manual Pat answer. */
export const AWAITING_MANUAL_PAT_ANSWER_STATUS = "awaiting_manual_pat_answer";

/** Skip / log reason for proactive Morning / Evening / Weekly suppression. */
export const AWAITING_MANUAL_PAT_ANSWER_SKIP_REASON = "awaiting_manual_pat_answer";

/**
 * True when this member has at least one inbound Coach job waiting for a
 * manual Pat answer. No semantics, no thread inspection, no AI.
 * Fail-closed on lookup error: cannot verify "no pending question" → treat as pending.
 */
export async function hasAwaitingManualPatAnswer(
  clerkUserId: string
): Promise<boolean> {
  const id = clerkUserId.trim();
  if (!id) return false;

  const { data, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("message_sid")
    .eq("clerk_user_id", id)
    .eq("status", AWAITING_MANUAL_PAT_ANSWER_STATUS)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[has-awaiting-manual-pat-answer] lookup_failed", {
      clerk_user_id: id,
      error: error.message,
    });
    return true;
  }

  return typeof data?.message_sid === "string" && data.message_sid.trim().length > 0;
}
