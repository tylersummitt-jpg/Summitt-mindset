/**
 * Morning TTO post-send operational bookkeeping only.
 * No model calls. No coaching-memory recompute. No invented answer/template semantics.
 */

import { planCommitmentSmsThreadMemoryFromOutbound } from "@/lib/v2-commitment-sms-thread-memory";
import {
  hasCheckSentForCommitmentDaySlot,
  reconcileCheckSentPostSendBookkeepingForCommitment,
} from "@/lib/v2-outbound-check-sent";
import { reconcileRefreshPostSendBookkeepingForCommitment } from "@/lib/v2-refresh-session";
import { supabaseServer } from "@/lib/supabase-server";
import { SMS_DAILY_PRODUCTION_SEND_SLOT } from "@/lib/tyler-text-overview-types";

/**
 * Operational check_sent marker for cadence day_key / dedupe only.
 * Not an accountability template selection and not an expected-answer classifier.
 */
export const MORNING_TTO_OPERATIONAL_CHECK_SENT_TEMPLATE_ID = 0;

export async function runMorningTtoPostSendBookkeeping(args: {
  commitmentId: string;
  clerkUserId: string;
  dayKey: string;
  sentBody: string;
  messageSid: string;
  sentAt?: Date;
}): Promise<{ ok: boolean; error?: string }> {
  const commitmentId = args.commitmentId.trim();
  const clerkUserId = args.clerkUserId.trim();
  const dayKey = args.dayKey.trim();
  const sentBody = args.sentBody.trim();
  const messageSid = args.messageSid.trim();

  if (!commitmentId || !clerkUserId || !dayKey || !sentBody || !messageSid) {
    return { ok: false, error: "missing_required_fields" };
  }

  let hardError: string | undefined;

  try {
    await reconcileCheckSentPostSendBookkeepingForCommitment({
      commitmentId,
      clerkUserId,
      scheduledDeletionFence: true,
    });
  } catch (err) {
    console.warn("[morning-tto-post-send] reconcile_check_sent_failed", {
      commitment_id: commitmentId,
      clerk_user_id: clerkUserId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await reconcileRefreshPostSendBookkeepingForCommitment({
      commitmentId,
      clerkUserId,
      scheduledDeletionFence: true,
    });
  } catch (err) {
    console.warn("[morning-tto-post-send] reconcile_refresh_failed", {
      commitment_id: commitmentId,
      clerk_user_id: clerkUserId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const sentAt = args.sentAt ?? new Date();
  // Exact sent body only. Do not invent expected-answer types.
  const threadPlan = await planCommitmentSmsThreadMemoryFromOutbound({
    commitmentId,
    clerkUserId,
    sentBody,
    sentAt,
    messageSid,
    source: "daily_sms",
    clearBindingOpenQuestion: true,
  });
  let recordCheckSent = true;
  try {
    recordCheckSent = !(await hasCheckSentForCommitmentDaySlot({
      commitmentId,
      dayKey,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
    }));
  } catch (err) {
    console.warn("[morning-tto-post-send] check_sent dedupe read failed; database rechecks", {
      commitment_id: commitmentId,
      clerk_user_id: clerkUserId,
      message: err instanceof Error ? err.message : String(err),
    });
    recordCheckSent = true;
  }

  try {
      const persisted = await supabaseServer.rpc("tto_record_scheduled_post_send_bookkeeping", {
        p_clerk_user_id: clerkUserId,
        p_commitment_id: commitmentId,
        p_day_key: dayKey,
        p_send_slot: SMS_DAILY_PRODUCTION_SEND_SLOT,
        p_message_sid: messageSid,
        p_body_preview: sentBody.slice(0, 160),
        p_sent_at: sentAt.toISOString(),
        p_record_check_sent: recordCheckSent,
        p_thread_memory: threadPlan.ok ? { ops: threadPlan.ops } : null,
        p_replay: null,
      });
      if (persisted.error) {
        hardError = persisted.error.message;
      } else {
        const row = (Array.isArray(persisted.data) ? persisted.data[0] : persisted.data) as
          | { outcome?: string; reason?: string | null }
          | null;
        const outcome = row?.outcome ?? "invalid";
        if (!threadPlan.ok || outcome === "thread_memory_failed") {
          console.warn("[morning-tto-post-send] thread_memory_upsert_failed", {
            commitment_id: commitmentId,
            clerk_user_id: clerkUserId,
            error: threadPlan.ok ? row?.reason ?? outcome : threadPlan.error,
          });
        }
        if (outcome === "check_sent_failed" || outcome === "invalid") {
          hardError = row?.reason ?? outcome;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[morning-tto-post-send] operational_check_sent_insert_failed", {
        commitment_id: commitmentId,
        clerk_user_id: clerkUserId,
        message_sid: messageSid,
        error: message,
      });
      hardError = message;
  }

  return hardError ? { ok: false, error: hardError } : { ok: true };
}
