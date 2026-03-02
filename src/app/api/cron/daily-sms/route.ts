import { NextResponse } from "next/server";
import { listClerkUsers } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { getOrCreateDailyCoachPatNote } from "@/lib/get-or-create-daily-coach-pat-note";
import { getOrCreateDailyPracticeVersion } from "@/lib/get-or-create-daily-practice-version";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { sendSMS, isTwilioReady } from "@/lib/twilio";
import { getUserStalenessLevel } from "@/lib/get-user-staleness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const ENV_SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

/**
 * ======================================================
 * CRON AUTH
 * ======================================================
 *
 * IMPORTANT:
 * - Your Vercel cron invocations are currently returning 401.
 * - This is almost certainly because the x-vercel-cron header value is not exactly "1".
 * - We accept any truthy value ("1", "true", "True", etc.) to be robust.
 */
function validateCronSecret(req: Request) {
  // 1) Vercel Cron header (preferred)
  const vercelCronHeader = req.headers.get("x-vercel-cron");
  const isVercelCron =
    vercelCronHeader === "1" ||
    vercelCronHeader === "true" ||
    vercelCronHeader === "True" ||
    vercelCronHeader === "yes" ||
    vercelCronHeader === "on";

  if (isVercelCron) return true;

  // 2) Manual secret (header or query param)
  if (!CRON_SECRET) return false;

  const header = req.headers.get("x-cron-secret");
  if (header && header === CRON_SECRET) return true;

  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (secret && secret === CRON_SECRET) return true;

  return false;
}

/**
 * ======================================================
 * "NEVER MISS" SEND WINDOW
 * ======================================================
 *
 * Goal:
 * - Each user receives at most ONE SMS per local day.
 * - We do NOT care if it's 8:00 vs 8:15. We just want it to happen.
 *
 * Implementation:
 * - If user is eligible AND it's after MORNING_START_HOUR local time,
 *   we will attempt to send if there's no sms_send_events record yet for todayKey.
 *
 * You can adjust this hour safely later.
 */
const MORNING_START_HOUR = 6; // 6:00 AM local time

function shouldSendTodayNow(local: Date) {
  return local.getHours() >= MORNING_START_HOUR;
}

function getReentryLine(level: string): string | null {
  if (level === "short_idle") return "Just picking back up. That’s enough.";
  if (level === "medium_idle") return "No need to restart. Just continue.";
  if (level === "long_idle") return "You’re not behind. Let’s take this small.";
  return null;
}

/**
 * ======================================================
 * HEADER + CTA ROTATION (DETERMINISTIC)
 * ======================================================
 */
function getTrainingCampHeader(dayNumber: number): string | null {
  if (dayNumber >= 1 && dayNumber <= 30) {
    return `TRAINING CAMP - DAY ${dayNumber}`;
  }
  return null;
}

function getCoachHeader(dayNumber: number): string {
  const options = ["DAILY NOTE FROM COACH PAT", "COACH PAT", "A NOTE FROM COACH PAT"];
  return options[dayNumber % options.length];
}

function getCompletionCTA(dayNumber: number): string {
  const options = [
    `Reply with at least one honest sentence to complete today.`,
    `When you're ready, reply to complete Day ${dayNumber}.`,
    `Reply with one sentence to complete today’s training.`,
    `Reply when you’re ready — that completes Day ${dayNumber}.`,
    `Send one honest sentence and you’re done for today.`,
  ];
  return options[dayNumber % options.length];
}

/**
 * ======================================================
 * Helper: try to reserve today's send slot
 * ======================================================
 *
 * We rely on your unique index: (clerk_user_id, day_key)
 * - If insert succeeds: this run owns the send attempt.
 * - If insert fails due to unique violation: SMS already reserved/sent today, skip safely.
 */
async function reserveTodaySendOrSkip({
  userId,
  todayKey,
}: {
  userId: string;
  todayKey: string;
}): Promise<{ reserved: boolean; reason?: string }> {
  const { error } = await supabaseServer.from("sms_send_events").insert({
    clerk_user_id: userId,
    day_key: todayKey,
    status: "reserved",
    metadata: { note: "reserved_by_cron" },
  });

  if (!error) return { reserved: true };

  // Postgres unique violation is usually 23505; Supabase error "code" often contains it.
  // If we can't detect it perfectly, we still treat any insert error as "not reserved"
  // to avoid double-sending. This favors safety over aggressive retries.
  const code = (error as any)?.code;
  const message = (error as any)?.message || String(error);

  if (code === "23505" || message.toLowerCase().includes("duplicate")) {
    return { reserved: false, reason: "already_reserved_or_sent_today" };
  }

  return { reserved: false, reason: "reservation_insert_failed" };
}

export async function GET(req: Request) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const dryRunOverride = url.searchParams.get("dryRun") === "1";
  const SMS_DRY_RUN = ENV_SMS_DRY_RUN || dryRunOverride;

  const pageLimit = 200;
  let offset = 0;

  const stats = {
    ok: true,
    scanned: 0,
    eligible: 0,
    reserved: 0,
    alreadyReservedOrSentToday: 0,
    sent: 0,
    dryRun: 0,
    skippedNotTime: 0,
    skippedMissingIdentity: 0,
    skippedOptedOut: 0,
    skippedAlreadyCompleted: 0,
    skippedMissingTwilio: 0,
    failed: 0,
    reservationErrors: 0,
  };

  while (true) {
    const users = await listClerkUsers({ limit: pageLimit, offset });
    if (!users || users.length === 0) break;

    for (const user of users) {
      stats.scanned += 1;

      const md = user.public_metadata || {};

      if (md.summittSubscribed !== true) continue;
      if (md.smsEnabled !== true) continue;

      // Identity record (canonical opt-out)
      const { data: identity } = await supabaseServer
        .from("sms_identities")
        .select("phone_number, sms_enabled, stopped_at")
        .eq("clerk_user_id", user.id)
        .maybeSingle();

      if (!identity?.phone_number) {
        stats.skippedMissingIdentity += 1;
        continue;
      }
      if (identity.sms_enabled !== true) {
        stats.skippedOptedOut += 1;
        continue;
      }
      if (typeof identity.stopped_at === "string") {
        stats.skippedOptedOut += 1;
        continue;
      }

      const timezone = resolveUserTimezone(md.timezone);
      const now = new Date();

      // localNow = "now" interpreted in that user's timezone
      const localNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

      // Key used for dedupe
      const todayKey = getDateKeyInTimezone(now, timezone);

      // If not forced, only start trying after MORNING_START_HOUR local time.
      // This ensures "never miss": once the user is in the day window, they'll be picked up
      // by the next cron tick.
      if (!force && !shouldSendTodayNow(localNow)) {
        stats.skippedNotTime += 1;
        continue;
      }

      stats.eligible += 1;

      // Reserve (dedupe gate)
      const reservation = await reserveTodaySendOrSkip({
        userId: user.id,
        todayKey,
      });

      if (!reservation.reserved) {
        if (reservation.reason === "already_reserved_or_sent_today") {
          stats.alreadyReservedOrSentToday += 1;
        } else {
          stats.reservationErrors += 1;
        }
        continue;
      }

      stats.reserved += 1;

      // If user already completed today, we skip sending the daily SMS.
      // (This matches your current behavior and avoids unnecessary pings.)
      const { data: completed } = await supabaseServer
        .from("daily_completion_events")
        .select("id")
        .eq("clerk_user_id", user.id)
        .eq("day_key", todayKey)
        .limit(1);

      if (completed && completed.length > 0) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: "skipped_already_completed",
            metadata: { note: "user_completed_today" },
          })
          .eq("clerk_user_id", user.id)
          .eq("day_key", todayKey);

        stats.skippedAlreadyCompleted += 1;
        continue;
      }

      const dayNumber =
        typeof md.currentDay === "number" && md.currentDay > 0 ? md.currentDay : 1;

      const { level } = getUserStalenessLevel({
        timezoneFromMetadata: md.timezone,
        lastCompletedAt: md.lastCompletedAt,
      });

      const version = await getOrCreateDailyPracticeVersion({
        userId: user.id,
        dayNumber,
      });

      const note = await getOrCreateDailyCoachPatNote({
        userId: user.id,
        dayNumber,
      });

      const reentryLine = getReentryLine(level);

      let smsBody = "";

      const trainingHeader = getTrainingCampHeader(dayNumber);
      if (trainingHeader) smsBody += `${trainingHeader}\n\n`;
      if (reentryLine) smsBody += `${reentryLine}\n\n`;

      const coachHeader = getCoachHeader(dayNumber);
      const completionCTA = getCompletionCTA(dayNumber);

      smsBody +=
        `${coachHeader}\n\n` +
        `${note.noteText}\n\n` +
        `TODAY'S PRACTICE\n\n` +
        `${version.actionItem}\n\n` +
        `TODAY'S REFLECTION\n\n` +
        `${version.reflectionPrompt}\n\n` +
        `${completionCTA}`;

      // Twilio readiness + dry run
      if (!isTwilioReady() || SMS_DRY_RUN) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: SMS_DRY_RUN ? "dry_run" : "skipped_missing_twilio",
            metadata: {
              note: SMS_DRY_RUN ? "dry_run_enabled" : "twilio_not_ready",
              timezone,
              local_time: localNow.toISOString(),
            },
          })
          .eq("clerk_user_id", user.id)
          .eq("day_key", todayKey);

        if (SMS_DRY_RUN) stats.dryRun += 1;
        else stats.skippedMissingTwilio += 1;

        continue;
      }

      try {
        const message = await sendSMS({
          to: identity.phone_number,
          body: smsBody,
        });

        await supabaseServer
          .from("sms_send_events")
          .update({
            message_sid: message.sid,
            status: message.status,
            metadata: {
              note: "sent_to_twilio",
              timezone,
              local_time: localNow.toISOString(),
            },
          })
          .eq("clerk_user_id", user.id)
          .eq("day_key", todayKey);

        stats.sent += 1;
      } catch (err) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: "send_failed",
            metadata: {
              error: String(err),
              timezone,
              local_time: localNow.toISOString(),
            },
          })
          .eq("clerk_user_id", user.id)
          .eq("day_key", todayKey);

        stats.failed += 1;
      }
    }

    offset += users.length;
    if (users.length < pageLimit) break;
  }

  return NextResponse.json(stats);
}