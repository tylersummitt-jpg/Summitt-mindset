import { supabaseServer } from "@/lib/supabase-server";
import { SMS_DAILY_DRAFTS_TABLE } from "@/lib/tyler-text-overview-types";

const LOG_PREFIX = "[tto-mark-current-draft-unusable]";
const MARK_UNUSABLE_ATTEMPTS = 3 as const;

function isProvenNonCurrent(status: string | null): boolean {
  return status !== null && status !== "current";
}

async function loadDraftStatus(draftId: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select("status")
    .eq("id", draftId)
    .maybeSingle();

  if (error) {
    console.warn(LOG_PREFIX, "draft_status_lookup_failed", {
      draft_id: draftId,
      error: error.message,
    });
    return null;
  }
  if (!data) {
    return "";
  }
  return typeof data.status === "string" ? data.status : null;
}

/**
 * Retry a skip UPDATE; only true when DB proves the row is no longer current/sendable.
 */
export async function markCurrentTtoDraftUnusable(draftId: string): Promise<boolean> {
  for (let attempt = 1; attempt <= MARK_UNUSABLE_ATTEMPTS; attempt++) {
    const { data, error } = await supabaseServer
      .from(SMS_DAILY_DRAFTS_TABLE)
      .update({
        status: "skipped",
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftId)
      .eq("status", "current")
      .select("id, status")
      .maybeSingle();

    if (!error) {
      const updatedStatus = typeof data?.status === "string" ? data.status : null;
      if (isProvenNonCurrent(updatedStatus)) {
        return true;
      }
      if (!data) {
        const existing = await loadDraftStatus(draftId);
        if (existing !== null && existing !== "current") {
          return true;
        }
      }
    } else {
      console.warn(LOG_PREFIX, "mark_unusable_failed", {
        draft_id: draftId,
        attempt,
        error: error.message,
      });
    }
  }

  const existing = await loadDraftStatus(draftId);
  return existing !== null && existing !== "current";
}
