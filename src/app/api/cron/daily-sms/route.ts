import crypto from "crypto";
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
 * Valid CRON_SECRET required. Accept either:
 * - x-cron-secret: <CRON_SECRET>
 * - Authorization: Bearer <CRON_SECRET> (Vercel scheduled crons)
 */
function timingSafeEqualUtf8(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function validateCronSecret(req: Request): boolean {
  if (!CRON_SECRET) return false;

  const xCron = req.headers.get("x-cron-secret");
  if (xCron && timingSafeEqualUtf8(xCron, CRON_SECRET)) return true;

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token && timingSafeEqualUtf8(token, CRON_SECRET)) return true;
  }

  return false;
}

function logDailySmsCronAuthFailure(req: Request) {
  console.error("[daily-sms] cron auth failed", {
    cronSecretConfigured: Boolean(CRON_SECRET),
    hasXCronSecretHeader: Boolean(req.headers.get("x-cron-secret")),
    hasAuthorizationHeader: Boolean(req.headers.get("authorization")),
  });
}

/**
 * ======================================================
 * PREFERENCE-BASED SEND WINDOW
 * ======================================================
 *
 * Goal:
 * - Each user receives at most ONE SMS per local day.
 * - Send time is based on smsTimePreference (early_morning=6, morning=8, midday=10).
 * - 10-minute window at the start of the hour aligns with 5-minute cron + jitter.
 */
const SEND_HOUR_BY_PREFERENCE = {
  early_morning: 6,
  morning: 8,
  midday: 10,
} as const;

function isInSendWindow(local: Date, sendHour: number): boolean {
  return local.getHours() === sendHour && local.getMinutes() < 10;
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
    logDailySmsCronAuthFailure(req);
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
    userLoopErrors: 0,
    recoveredReserved: 0,
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

      let stage = "getClerkUser";
      try {
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
      stage = "query_send_events";
      const { data: existingRow } = await supabaseServer
        .from("sms_send_events")
        .select("id, status, metadata, message_sid")
        .eq("clerk_user_id", audienceUser.clerk_user_id)
        .eq("day_key", todayKey)
        .maybeSingle();

      let existingEvent = existingRow;

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
        const messageSidRaw = existingEvent.message_sid;
        const hasMessageSid =
          typeof messageSidRaw === "string" && messageSidRaw.trim().length > 0;

        // Unsent stuck "reserved" (insert succeeded, send/update never completed)
        if (existingEvent.status === "reserved" && !hasMessageSid) {
          const priorStatus = existingEvent.status;
          const reservedMeta = (existingEvent.metadata || {}) as Record<
            string,
            unknown
          >;
          const recoveredMeta = {
            ...reservedMeta,
            retry_count: 0,
            note: "recovered_stuck_reserved",
            recovered_at: new Date().toISOString(),
          };

          console.log("[daily-sms] recovered stuck reserved row", {
            clerk_user_id: audienceUser.clerk_user_id,
            priorStatus,
            messageSidPresent: hasMessageSid,
          });

          stats.recoveredReserved += 1;

          await supabaseServer
            .from("sms_send_events")
            .update({
              status: "send_failed",
              metadata: recoveredMeta,
            })
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey);

          existingEvent = {
            ...existingEvent,
            status: "send_failed",
            metadata: recoveredMeta,
          };
        }

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
            stage = "build_content";
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

            stage = "twilio_send_or_skip";
            if (!isTwilioReady() || SMS_DRY_RUN) {
              stats.alreadyReservedOrSentToday += 1;
              continue;
            }

            let retryMessage;
            try {
              retryMessage = await sendSMS({
                to: audienceUser.phone_number,
                body: smsBody,
              });
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
              continue;
            }

            const retrySuccessPayload = {
              message_sid: retryMessage.sid,
              status: retryMessage.status,
              sms_body: smsBody,
              metadata: {
                ...existingMeta,
                retry_count: retryCount + 1,
                note: "retry_success",
                timezone,
                local_time: localNow.toISOString(),
              },
            };
            const { error: retryUpdErr } = await supabaseServer
              .from("sms_send_events")
              .update(retrySuccessPayload)
              .eq("clerk_user_id", audienceUser.clerk_user_id)
              .eq("day_key", todayKey);
            if (retryUpdErr) {
              console.error(
                "[daily-sms] sms_send_events update failed after Twilio success (retry path)",
                {
                  clerk_user_id: audienceUser.clerk_user_id,
                  todayKey,
                  message_sid: retryMessage.sid,
                  error: retryUpdErr,
                }
              );
              const { error: retryUpdErr2 } = await supabaseServer
                .from("sms_send_events")
                .update(retrySuccessPayload)
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey);
              if (retryUpdErr2) {
                console.error(
                  "[daily-sms] sms_send_events second update failed after Twilio success (retry path)",
                  {
                    clerk_user_id: audienceUser.clerk_user_id,
                    todayKey,
                    message_sid: retryMessage.sid,
                    error: retryUpdErr2,
                  }
                );
              }
            }
            stats.sent += 1;
            stats.retried += 1;
            continue;
          }
        }
        // CASE B: any other status - skip
        stats.alreadyReservedOrSentToday += 1;
        continue;
      }

      // STEP 3: Only reserve if no row exists
      stage = "reserve";
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

      stage = "build_content";
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
      stage = "twilio_send_or_skip";
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

      let mainMessage;
      try {
        mainMessage = await sendSMS({
          to: audienceUser.phone_number,
          body: smsBody,
        });
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

      if (mainMessage) {
        const mainSuccessPayload = {
          message_sid: mainMessage.sid,
          status: mainMessage.status,
          sms_body: smsBody,
          metadata: {
            note: "sent_to_twilio",
            timezone,
            local_time: localNow.toISOString(),
          },
        };
        const { error: mainUpdErr } = await supabaseServer
          .from("sms_send_events")
          .update(mainSuccessPayload)
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);
        if (mainUpdErr) {
          console.error(
            "[daily-sms] sms_send_events update failed after Twilio success (main path)",
            {
              clerk_user_id: audienceUser.clerk_user_id,
              todayKey,
              message_sid: mainMessage.sid,
              error: mainUpdErr,
            }
          );
          const { error: mainUpdErr2 } = await supabaseServer
            .from("sms_send_events")
            .update(mainSuccessPayload)
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey);
          if (mainUpdErr2) {
            console.error(
              "[daily-sms] sms_send_events second update failed after Twilio success (main path)",
              {
                clerk_user_id: audienceUser.clerk_user_id,
                todayKey,
                message_sid: mainMessage.sid,
                error: mainUpdErr2,
              }
            );
          }
        }
        stats.sent += 1;
      }
      } catch (userErr: unknown) {
        const message =
          userErr instanceof Error ? userErr.message : String(userErr);
        console.error("[daily-sms] user processing error", {
          clerk_user_id: audienceUser.clerk_user_id,
          stage,
          message,
        });
        stats.userLoopErrors += 1;
        continue;
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

  console.log("[daily-sms] run summary", {
    scanned: stats.scanned,
    eligible: stats.eligible,
    reserved: stats.reserved,
    sent: stats.sent,
    skippedAlreadyCompleted: stats.skippedAlreadyCompleted,
    skippedOutOfWindow: stats.skippedNotTime,
    skippedAlreadySent: stats.alreadyReservedOrSentToday,
    skippedOptedOut: stats.skippedOptedOut,
    failed: stats.failed,
    reservationErrors: stats.reservationErrors,
    userLoopErrors: stats.userLoopErrors,
    recoveredReserved: stats.recoveredReserved,
  });

  return NextResponse.json(stats);
}