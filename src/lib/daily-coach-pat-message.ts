// src/lib/daily-coach-pat-message.ts

import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { generateDailyCoachPatMessage } from "@/lib/daily-coach-pat-engine";

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
 * Determines:
 * - whether an SMS should be sent today
 * - what day the user is on
 * - returns the SAME cached coach note used in-app
 *
 * It does NOT:
 * - send SMS
 * - write journal entries
 * - complete days
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
  // CANONICAL NOTE (CACHED ENGINE)
  // ----------------------------
  const result = await generateDailyCoachPatMessage({
    userId,
    dayNumber: currentDay,
  });

  if (!result.ok || !result.note) {
    return { send: false, reason: "not_ready" };
  }

  return {
    send: true,
    text: result.note,
    dayNumber: result.dayNumber,
  };
}
