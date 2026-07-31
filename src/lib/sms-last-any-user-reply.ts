/**
 * Last any normal user reply — engagement clock.
 * Source: sms_inbound_messages (not outcome spine, not thread projection).
 */

import { supabaseServer } from "@/lib/supabase-server";
import { isSmsComplianceOnlyInbound } from "@/lib/v2-commitment-sms-thread-memory";

/** Page size while scanning past compliance-only rows for the latest real reply. */
const INBOUND_PAGE_SIZE = 100;
/** Hard safety bound: never scan more than this many inbound rows for one user lookup. */
const INBOUND_MAX_SCAN_ROWS = 5000;

/**
 * Latest received_at among non-compliance inbound SMS for a user.
 * Pure acknowledgments (thanks, ok, lol, busy, etc.) count as engagement.
 * STOP/START/HELP (and similar) do not reset the engagement clock.
 *
 * Scans newest-first in pages until a non-compliance row is found or the table is exhausted
 * (capped at INBOUND_MAX_SCAN_ROWS). Does not stop after a fixed 50-row window of compliance.
 */
export async function fetchLastAnyUserReplyAt(clerkUserId: string): Promise<string | null> {
  const clerk = clerkUserId.trim();
  if (!clerk) return null;

  let offset = 0;
  let scanned = 0;

  while (scanned < INBOUND_MAX_SCAN_ROWS) {
    const pageLimit = Math.min(INBOUND_PAGE_SIZE, INBOUND_MAX_SCAN_ROWS - scanned);
    const { data, error } = await supabaseServer
      .from("sms_inbound_messages")
      .select("received_at, raw_body")
      .eq("clerk_user_id", clerk)
      .order("received_at", { ascending: false })
      .range(offset, offset + pageLimit - 1);

    if (error) {
      console.warn("[sms-last-any-user-reply] fetch failed", {
        clerk_user_id: clerk,
        message: error.message,
      });
      return null;
    }

    const rows = data ?? [];
    if (rows.length === 0) return null;

    for (const row of rows) {
      scanned += 1;
      const at = typeof row.received_at === "string" ? row.received_at : null;
      const body = typeof row.raw_body === "string" ? row.raw_body : "";
      if (!at?.trim()) continue;
      if (isSmsComplianceOnlyInbound(body)) continue;
      return at;
    }

    if (rows.length < pageLimit) return null;
    offset += rows.length;
  }

  console.warn("[sms-last-any-user-reply] max_scan_rows_exhausted_without_non_compliance", {
    clerk_user_id: clerk,
    scanned,
  });
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
