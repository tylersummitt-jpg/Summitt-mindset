import { NextResponse } from "next/server";
import { getClerkUser } from "@/lib/clerk-rest";
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
 * Only allow requests with valid CRON_SECRET via x-cron-secret header.
 */
function validateCronSecret(req: Request): boolean {
  if (!CRON_SECRET) return false;
  const header = req.headers.get("x-cron-secret");
  return header === CRON_SECRET;
}

/**
 * ======================================================
 * PREFERENCE-BASED SEND WINDOW
 * ======================================================
 *
 * Goal:
 * - Each user receives at most ONE SMS per local day.
 * - Send time is based on smsTimePreference (early_morning=6, morning=8, midday=10).
 * - 5-minute window prevents duplicate sends if cron runs multiple times.
 */
const SEND_HOUR_BY_PREFERENCE = {
  early_morning: 6,
  morning: 8,
  midday: 10,
} as const;

function isInSendWindow(local: Date, sendHour: number): boolean {
  return local.getHours() === sendHour && local.getMinutes() < 5;
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

  const stats = {
    ok: true,
    scanned: 0,
    eligible: 0,
    reserved: 0,
    alreadyReservedOrSentToday: 0,
    sent: 0,
    retried: 0,
    dryRun: 0,
    skippedNotTime: 0,
    skippedMissingIdentity: 0,
    skippedOptedOut: 0,
    skippedAlreadyCompleted: 0,
    skippedMissingTwilio: 0,
    failed: 0,
    reservationErrors: 0,
  };

  const { data: audienceUsers } = await supabaseServer
    .from("sms_audience")
    .select("clerk_user_id, phone_number, sms_enabled, stopped_at, timezone, sms_time_preference, summitt_subscribed")
    .eq("summitt_subscribed", true)
    .eq("sms_enabled", true);

  if (!audienceUsers || audienceUsers.length === 0) {
    return NextResponse.json(stats);
  }

  for (const audienceUser of audienceUsers) {
      stats.scanned += 1;

      const user = await getClerkUser(audienceUser.clerk_user_id);
      const md = user.public_metadata || {};

      if (typeof audienceUser.stopped_at === "string") {
        stats.skippedOptedOut += 1;
        continue;
      }

      const timezone = resolveUserTimezone(audienceUser.timezone);
      const now = new Date();

      // localNow = "now" interpreted in that user's timezone
      const localNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

      // Key used for dedupe
      const todayKey = getDateKeyInTimezone(now, timezone);

      const pref = audienceUser.sms_time_preference ?? "morning";
      const sendHour =
        SEND_HOUR_BY_PREFERENCE[pref as keyof typeof SEND_HOUR_BY_PREFERENCE] ?? 8;

      // STEP 1: Read existing event before reserve (and before window check)
      const { data: existingEvent } = await supabaseServer
        .from("sms_send_events")
        .select("id, status, metadata")
        .eq("clerk_user_id", audienceUser.clerk_user_id)
        .eq("day_key", todayKey)
        .maybeSingle();

      // Retries bypass send window; first-time sends require it
      const meta = existingEvent?.metadata as Record<string, unknown> | undefined;
      const retryCountFromMeta =
        typeof meta?.retry_count === "number" ? meta.retry_count : 0;
      const isRetryPending =
        existingEvent?.status === "send_failed" && retryCountFromMeta < 3;

      if (!existingEvent && !force && !isInSendWindow(localNow, sendHour)) {
        stats.skippedNotTime += 1;
        continue;
      }

      stats.eligible += 1;

      // STEP 2 & 3: Handle existing row or proceed to reserve
      if (existingEvent) {
        // CASE A: send_failed with retries left
        if (existingEvent.status === "send_failed") {
          const existingMeta = (existingEvent.metadata || {}) as Record<string, unknown>;
          const retryCount = typeof existingMeta.retry_count === "number" ? existingMeta.retry_count : 0;

          if (retryCount < 3) {
            // Check completion (user may have completed since failure)
            const { data: completed } = await supabaseServer
              .from("daily_completion_events")
              .select("id")
              .eq("clerk_user_id", audienceUser.clerk_user_id)
              .eq("day_key", todayKey)
              .limit(1);

            if (completed && completed.length > 0) {
              await supabaseServer
                .from("sms_send_events")
                .update({
                  status: "skipped_already_completed",
                  metadata: { ...existingMeta, note: "user_completed_today" },
                })
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey);
              stats.skippedAlreadyCompleted += 1;
              continue;
            }

            const dayNumber =
              typeof md.currentDay === "number" && md.currentDay > 0 ? md.currentDay : 1;
            const version = await getOrCreateDailyPracticeVersion({
              userId: audienceUser.clerk_user_id,
              dayNumber,
            });
            const note = await getOrCreateDailyCoachPatNote({
              userId: audienceUser.clerk_user_id,
              dayNumber,
            });
            const completionCTA = getCompletionCTA(dayNumber);
            const trainingHeader = getTrainingCampHeader(dayNumber);
            let smsBody = "";
            const { level } = getUserStalenessLevel({
              timezoneFromMetadata: md.timezone,
              lastCompletedAt: md.lastCompletedAt,
            });
            const reentryLine = getReentryLine(level);
            if (reentryLine) {
              smsBody += `${reentryLine}\n\n`;
            }
            smsBody += `${note.noteText}\n`;
            smsBody += `- Coach Pat\n\n`;
            if (trainingHeader) smsBody += `${trainingHeader}\n\n`;
            smsBody += `TODAY'S PRACTICE\n\n`;
            smsBody += `${version.actionItem}\n\n`;
            smsBody += `TODAY'S REFLECTION\n\n`;
            smsBody += `${version.reflectionPrompt}\n\n`;
            smsBody += completionCTA;

            if (!isTwilioReady() || SMS_DRY_RUN) {
              stats.alreadyReservedOrSentToday += 1;
              continue;
            }

            try {
              const message = await sendSMS({
                to: audienceUser.phone_number,
                body: smsBody,
              });
              await supabaseServer
                .from("sms_send_events")
                .update({
                  message_sid: message.sid,
                  status: message.status,
                  sms_body: smsBody,
                  metadata: {
                    ...existingMeta,
                    retry_count: retryCount + 1,
                    note: "retry_success",
                    timezone,
                    local_time: localNow.toISOString(),
                  },
                })
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey);
              stats.sent += 1;
              stats.retried += 1;
            } catch (err) {
              const newRetryCount = retryCount + 1;
              await supabaseServer
                .from("sms_send_events")
                .update({
                  status: "send_failed",
                  metadata: {
                    ...existingMeta,
                    retry_count: newRetryCount,
                    error: String(err),
                    note: "retry_failed",
                    timezone,
                    local_time: localNow.toISOString(),
                  },
                })
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey);
              stats.failed += 1;
            }
            continue;
          }
        }
        // CASE B: any other status - skip
        stats.alreadyReservedOrSentToday += 1;
        continue;
      }

      // STEP 3: Only reserve if no row exists
      const reservation = await reserveTodaySendOrSkip({
        userId: audienceUser.clerk_user_id,
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
        .eq("clerk_user_id", audienceUser.clerk_user_id)
        .eq("day_key", todayKey)
        .limit(1);

      if (completed && completed.length > 0) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: "skipped_already_completed",
            metadata: { note: "user_completed_today" },
          })
          .eq("clerk_user_id", audienceUser.clerk_user_id)
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
        userId: audienceUser.clerk_user_id,
        dayNumber,
      });

      const note = await getOrCreateDailyCoachPatNote({
        userId: audienceUser.clerk_user_id,
        dayNumber,
      });

      const completionCTA = getCompletionCTA(dayNumber);
      const trainingHeader = getTrainingCampHeader(dayNumber);

      let smsBody = "";
      const reentryLine = getReentryLine(level);
      if (reentryLine) {
        smsBody += `${reentryLine}\n\n`;
      }

      smsBody += `${note.noteText}\n`;
      smsBody += `- Coach Pat\n\n`;
      if (trainingHeader) smsBody += `${trainingHeader}\n\n`;
      smsBody += `TODAY'S PRACTICE\n\n`;
      smsBody += `${version.actionItem}\n\n`;
      smsBody += `TODAY'S REFLECTION\n\n`;
      smsBody += `${version.reflectionPrompt}\n\n`;
      smsBody += completionCTA;

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
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);

        if (SMS_DRY_RUN) stats.dryRun += 1;
        else stats.skippedMissingTwilio += 1;

        continue;
      }

      try {
        const message = await sendSMS({
          to: audienceUser.phone_number,
          body: smsBody,
        });

        await supabaseServer
          .from("sms_send_events")
          .update({
            message_sid: message.sid,
            status: message.status,
            sms_body: smsBody,
            metadata: {
              note: "sent_to_twilio",
              timezone,
              local_time: localNow.toISOString(),
            },
          })
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);

        stats.sent += 1;
      } catch (err) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: "send_failed",
            metadata: {
              error: String(err),
              retry_count: 0,
              timezone,
              local_time: localNow.toISOString(),
            },
          })
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);

        stats.failed += 1;
      }
    }

  // Persist daily summary for observability (do not block cron success)
  const dayKey = getDateKeyInTimezone(new Date(), "UTC");
  try {
    await supabaseServer.from("sms_daily_stats").upsert(
      {
        day_key: dayKey,
        total_users: stats.scanned,
        eligible: stats.eligible,
        sent: stats.sent,
        failed: stats.failed,
        retried: stats.retried,
        skipped_not_time: stats.skippedNotTime,
        skipped_missing_identity: stats.skippedMissingIdentity,
        skipped_already_completed: stats.skippedAlreadyCompleted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "day_key" }
    );
  } catch (err) {
    console.error("[daily-sms] sms_daily_stats upsert failed:", err);
  }

  return NextResponse.json(stats);
}