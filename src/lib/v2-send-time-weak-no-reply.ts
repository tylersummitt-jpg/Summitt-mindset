/**
 * V2 weak no-reply timing signals: one idempotent negative sample per (user, day_key),
 * only after a successful accountability send with no same-calendar-day outcome.
 * See `maybeRecordV2WeakNoReplyFromPriorAccountabilityDay`.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { getDateKeyInTimezone } from "@/lib/timezone";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { recordV2WeakNoReplyForSendWindow, type V2SendTimeWindow } from "@/lib/v2-send-time-profile";

const ONE_DAY_MS = 86400000;

function isV2SendWindow(v: unknown): v is V2SendTimeWindow {
  return v === "morning" || v === "midday" || v === "afternoon" || v === "evening";
}

function parseSendWindowFromSmsMetadata(meta: unknown): V2SendTimeWindow | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const w = (meta as Record<string, unknown>).v2_send_window;
  return isV2SendWindow(w) ? w : null;
}

async function findCheckSentForDayKey(
  commitmentId: string,
  dayKey: string
): Promise<{ occurred_at: string } | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("occurred_at, payload_json")
    .eq("commitment_id", commitmentId)
    .eq("event_type", "check_sent")
    .order("occurred_at", { ascending: false })
    .limit(40);

  if (error || !data?.length) return null;
  for (const row of data) {
    const p = row.payload_json as Record<string, unknown> | null;
    const dk = typeof p?.day_key === "string" ? p.day_key.trim() : "";
    if (dk === dayKey && typeof row.occurred_at === "string") {
      return { occurred_at: row.occurred_at };
    }
  }
  return null;
}

async function hasAccountabilityOutcomeOnCalendarDay(args: {
  commitmentId: string;
  checkSentAt: string;
  dayKey: string;
  timezone: string;
}): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("occurred_at")
    .eq("commitment_id", args.commitmentId)
    .in("event_type", ["user_yes", "user_no", "user_partial"])
    .gt("occurred_at", args.checkSentAt)
    .limit(80);

  if (error || !data?.length) return false;

  for (const row of data) {
    if (typeof row.occurred_at !== "string") continue;
    if (getDateKeyInTimezone(new Date(row.occurred_at), args.timezone) === args.dayKey) {
      return true;
    }
  }
  return false;
}

/**
 * When daily-sms runs for calendar `todayKey`, evaluate **yesterday** in the user's TZ:
 * if a V2 accountability SMS went out with no same-day user outcome, record one weak negative
 * for the send window (idempotent via `sms_send_events.metadata.v2_weak_no_reply_applied`).
 */
export async function maybeRecordV2WeakNoReplyFromPriorAccountabilityDay(args: {
  clerkUserId: string;
  timezone: string;
  now: Date;
}): Promise<void> {
  const tz = args.timezone;
  const yesterdayKey = getDateKeyInTimezone(new Date(args.now.getTime() - ONE_DAY_MS), tz);

  const commitment = await getActiveCommitment(args.clerkUserId);
  if (!commitment?.id) return;

  const { data: sendRow, error: sendErr } = await supabaseServer
    .from("sms_send_events")
    .select("metadata, message_sid, status")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", yesterdayKey)
    .maybeSingle();

  if (sendErr || !sendRow) return;
  const messageSid = typeof sendRow.message_sid === "string" ? sendRow.message_sid.trim() : "";
  if (!messageSid) return;

  const meta = sendRow.metadata as Record<string, unknown> | null;
  if (!meta || typeof meta !== "object") return;
  if (meta.v2_weak_no_reply_applied === true) return;
  if (meta.v2_accountability !== true) return;
  if (meta.v2_reactivation_nudge === true) return;

  const sendWindow = parseSendWindowFromSmsMetadata(meta);
  if (!sendWindow) return;

  const checkSent = await findCheckSentForDayKey(commitment.id, yesterdayKey);
  if (!checkSent) return;

  const hadOutcome = await hasAccountabilityOutcomeOnCalendarDay({
    commitmentId: commitment.id,
    checkSentAt: checkSent.occurred_at,
    dayKey: yesterdayKey,
    timezone: tz,
  });
  if (hadOutcome) return;

  const recorded = await recordV2WeakNoReplyForSendWindow(args.clerkUserId, sendWindow);
  if (!recorded) return;

  const nextMeta = { ...meta, v2_weak_no_reply_applied: true };
  const { error: updErr } = await supabaseServer
    .from("sms_send_events")
    .update({ metadata: nextMeta })
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", yesterdayKey);

  if (updErr) {
    console.error("[v2-send-time-weak-no-reply] metadata flag update failed", {
      clerk_user_id: args.clerkUserId,
      day_key: yesterdayKey,
      message: updErr.message,
    });
  }
}
