/**
 * Morning TTO post-send operational bookkeeping only.
 * No model calls. No coaching-memory recompute. No invented answer/template semantics.
 */

import { upsertCommitmentSmsThreadMemoryFromOutbound } from "@/lib/v2-commitment-sms-thread-memory";
import {
  hasCheckSentForCommitmentDaySlot,
  insertV2CheckSentEventBestEffort,
  reconcileCheckSentPostSendBookkeepingForCommitment,
} from "@/lib/v2-outbound-check-sent";
import { reconcileRefreshPostSendBookkeepingForCommitment } from "@/lib/v2-refresh-session";
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
    });
  } catch (err) {
    console.warn("[morning-tto-post-send] reconcile_refresh_failed", {
      commitment_id: commitmentId,
      clerk_user_id: clerkUserId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Exact sent body only. Do not invent expected-answer types.
  const threadMem = await upsertCommitmentSmsThreadMemoryFromOutbound({
    commitmentId,
    clerkUserId,
    sentBody,
    sentAt: args.sentAt ?? new Date(),
    messageSid,
    source: "daily_sms",
    clearBindingOpenQuestion: true,
  });
  if (!threadMem.ok) {
    console.warn("[morning-tto-post-send] thread_memory_upsert_failed", {
      commitment_id: commitmentId,
      clerk_user_id: clerkUserId,
      error: threadMem.error,
    });
  }

  try {
    // Truthful outbound marker for cadence day_key + message_sid + body preview.
    // Does not call the standard accountability outbound-success helper (no promptKind / answer semantics).
    if (
      !(await hasCheckSentForCommitmentDaySlot({
        commitmentId,
        dayKey,
        sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      }))
    ) {
      await insertV2CheckSentEventBestEffort({
        commitmentId,
        clerkUserId,
        dayKey,
        messageSid,
        bodyPreview: sentBody.slice(0, 160),
        templateId: MORNING_TTO_OPERATIONAL_CHECK_SENT_TEMPLATE_ID,
        templateFamily: "standard",
        sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      });
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
