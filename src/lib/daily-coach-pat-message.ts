import { clerkClient } from "@clerk/nextjs/server";
import { resolveDailyPracticeForUser } from "@/lib/resolve-daily-practice";
import { generateCoachPatNote } from "@/lib/coach-pat-generator";
import {
  resolveUserTimezone,
  getDateKeyInTimezone,
} from "@/lib/timezone";

export type DailyCoachPatMessageResult =
  | {
      send: true;
      text: string;
      dayNumber: number;
    }
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
 * This function determines:
 * - whether an SMS should be sent today
 * - what day the user is on
 * - what practice is active
 * - what Coach Pat should say
 *
 * It does NOT:
 * - send SMS
 * - write Supabase
 * - update Clerk
 *
 * It is used by:
 * - /debug/daily-sms-preview
 * - future Twilio outbound sender
 *
 * Source of truth:
 * - resolveDailyPracticeForUser()
 */
export async function getDailyCoachPatMessageForSMS(
  userId: string
): Promise<DailyCoachPatMessageResult> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);

  const metadata = user.publicMetadata || {};

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
  // TIMEZONE-AWARE CALENDAR GUARD
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
  // CANONICAL PRACTICE RESOLUTION
  // ----------------------------
  let practice;
  try {
    practice = await resolveDailyPracticeForUser(userId);
  } catch (err) {
    console.error("Daily SMS resolver error:", err);
    return { send: false, reason: "not_ready" };
  }

  // ----------------------------
  // COACH PAT NOTE GENERATION
  // ----------------------------
  const text = await generateCoachPatNote({
    userId,
    dayNumber: practice.currentDay,
    actionItem: practice.actionItem,
  });

  if (!text) {
    return { send: false, reason: "not_ready" };
  }

  return {
    send: true,
    text,
    dayNumber: practice.currentDay,
  };
}
