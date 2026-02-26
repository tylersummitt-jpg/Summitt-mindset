// src/lib/daily-coach-pat-message.ts

import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { getOrCreateDailyCoachPatNote } from "@/lib/get-or-create-daily-coach-pat-note";

export type DailyCoachPatMessageResult =
  | { send: true; text: string; dayNumber: number }
  | {
      send: false;
      reason:
        | "not_subscribed"
        | "already_completed_today"
        | "no_current_day"
        | "not_ready";
    };

/**
 * ======================================================
 * Daily Coach Pat SMS Generator (CANONICAL)
 * ======================================================
 *
 * This now calls getOrCreateDailyCoachPatNote directly.
 * There is NO secondary engine.
 *
 * App + SMS + Cron all use the same canonical pathway.
 */
export async function getDailyCoachPatMessageForSMS(
  userId: string
): Promise<DailyCoachPatMessageResult> {
  const metadata = await getClerkPublicMetadata(userId);

  // ----------------------------
  // SUBSCRIPTION GUARD
  // ----------------------------
  if (metadata.summittSubscribed !== true) {
    return { send: false, reason: "not_subscribed" };
  }

  // ----------------------------
  // DAY GUARD
  // ----------------------------
  const currentDay =
    typeof metadata.currentDay === "number" ? metadata.currentDay : null;

  if (!currentDay) {
    return { send: false, reason: "no_current_day" };
  }

  // ----------------------------
  // TIMEZONE-AWARE "already completed today" guard
  // ----------------------------
  const timezone = resolveUserTimezone(metadata.timezone);

  if (typeof metadata.lastCompletedAt === "string") {
    const last = new Date(metadata.lastCompletedAt);
    const now = new Date();

    const lastKey = getDateKeyInTimezone(last, timezone);
    const todayKey = getDateKeyInTimezone(now, timezone);

    if (lastKey === todayKey) {
      return { send: false, reason: "already_completed_today" };
    }
  }

  // ----------------------------
  // CANONICAL NOTE
  // ----------------------------
  try {
    const result = await getOrCreateDailyCoachPatNote({
      userId,
      dayNumber: currentDay,
    });

    if (!result?.noteText) {
      return { send: false, reason: "not_ready" };
    }

    return {
      send: true,
      text: result.noteText,
      dayNumber: result.dayNumber,
    };
  } catch (err) {
    console.error("[DailyCoachPatMessage] error:", err);
    return { send: false, reason: "not_ready" };
  }
}