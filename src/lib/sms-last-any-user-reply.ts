/**
 * Last any normal user reply — engagement clock for Silence Cadence V1.
 * Source: sms_inbound_messages (not outcome spine, not thread projection).
 */

import { supabaseServer } from "@/lib/supabase-server";
import { isSmsComplianceOnlyInbound } from "@/lib/v2-commitment-sms-thread-memory";

const INBOUND_SCAN_LIMIT = 50;

/**
 * Latest received_at among non-compliance inbound SMS for a user.
 * Pure acknowledgments (thanks, ok, lol, busy, etc.) count as engagement.
 */
export async function fetchLastAnyUserReplyAt(clerkUserId: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("sms_inbound_messages")
    .select("received_at, raw_body")
    .eq("clerk_user_id", clerkUserId)
    .order("received_at", { ascending: false })
    .limit(INBOUND_SCAN_LIMIT);

  if (error) {
    console.warn("[sms-last-any-user-reply] fetch failed", {
      clerk_user_id: clerkUserId,
      message: error.message,
    });
    return null;
  }

  for (const row of data ?? []) {
    const at = typeof row.received_at === "string" ? row.received_at : null;
    const body = typeof row.raw_body === "string" ? row.raw_body : "";
    if (!at?.trim()) continue;
    if (isSmsComplianceOnlyInbound(body)) continue;
    return at;
  }

  return null;
}

/** First successful check_sent for never-replied anchor. */
export async function fetchFirstCheckSentAt(commitmentId: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("occurred_at")
    .eq("commitment_id", commitmentId)
    .eq("event_type", "check_sent")
    .order("occurred_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[sms-last-any-user-reply] first check_sent lookup failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return null;
  }

  return typeof data?.occurred_at === "string" ? data.occurred_at : null;
}
