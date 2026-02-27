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
 * CRON AUTH (secure + Vercel-cron compatible)
 * ======================================================
 *
 * - Vercel cron requests include: x-vercel-cron: 1
 * - Manual testing can use:
 *    - Header: x-cron-secret: <CRON_SECRET>
 *    - OR query: ?secret=<CRON_SECRET>
 */
function validateCronSecret(req: Request) {
  // Allow real Vercel cron jobs
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  if (isVercelCron) return true;

  if (!CRON_SECRET) return false;

  // Manual header option
  const header = req.headers.get("x-cron-secret");
  if (header && header === CRON_SECRET) return true;

  // Manual query option
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (secret && secret === CRON_SECRET) return true;

  return false;
}

/**
 * ======================================================
 * Rolling 8AM Local Send Logic
 * ======================================================
 *
 * Cron should run every 5 minutes.
 * We send if:
 *   local hour === 8
 *   local minute < 5
 */
function shouldSendNow(local: Date) {
  return local.getHours() === 8 && local.getMinutes() < 5;
}

function withComplianceFooter(body: string) {
  return (
    body +
    "\n\n— Summitt Mindset\nReply STOP to opt out. Reply HELP for help."
  );
}

function getReentryLine(level: string): string | null {
  if (level === "short_idle") return "Just picking back up. That’s enough.";
  if (level === "medium_idle") return "No need to restart. Just continue.";
  if (level === "long_idle") return "You’re not behind. Let’s take this small.";
  return null;
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
    sent: 0,
    dryRun: 0,
    skippedNotTime: 0,
    skippedMissingIdentity: 0,
    skippedOptedOut: 0,
    skippedAlreadyCompleted: 0,
    skippedMissingTwilio: 0,
    failed: 0,
  };

  while (true) {
    const users = await listClerkUsers({ limit: pageLimit, offset });
    if (!users || users.length === 0) break;

    for (const user of users) {
      stats.scanned += 1;

      const md = user.public_metadata || {};

      if (md.summittSubscribed !== true) continue;
      if (md.smsEnabled !== true) continue;

      // Must have an enabled sms_identity (STOP-safe)
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

      const localNow = new Date(
        now.toLocaleString("en-US", { timeZone: timezone })
      );

      if (!force && !shouldSendNow(localNow)) {
        stats.skippedNotTime += 1;
        continue;
      }

      stats.eligible += 1;

      const todayKey = getDateKeyInTimezone(now, timezone);

      // Reserve (idempotent via unique index on (clerk_user_id, day_key))
      const { error: reservationError } = await supabaseServer
        .from("sms_send_events")
        .insert({
          clerk_user_id: user.id,
          day_key: todayKey,
          status: "reserved",
        });

      if (reservationError) {
        // Most common is unique violation -> already reserved earlier
        continue;
      }

      stats.reserved += 1;

      // If already completed today, mark skip
      const { data: completed } = await supabaseServer
        .from("daily_completion_events")
        .select("id")
        .eq("clerk_user_id", user.id)
        .eq("day_key", todayKey)
        .limit(1);

      if (completed && completed.length > 0) {
        await supabaseServer
          .from("sms_send_events")
          .update({ status: "skipped_already_completed" })
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
      if (reentryLine) smsBody += `${reentryLine}\n\n`;

      smsBody +=
        `${note.noteText}\n\n` +
        `Today’s Practice\n\n` +
        `${version.actionItem}\n\n` +
        `Reflection\n\n` +
        `${version.reflectionPrompt}\n\n` +
        `Reply with one honest sentence.\n` +
        `When you're ready, text DONE.`;

      smsBody = withComplianceFooter(smsBody);

      // Dry run / missing Twilio
      if (!isTwilioReady() || SMS_DRY_RUN) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: SMS_DRY_RUN ? "dry_run" : "skipped_missing_twilio",
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
          })
          .eq("clerk_user_id", user.id)
          .eq("day_key", todayKey);

        stats.sent += 1;
      } catch (err) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: "send_failed",
            metadata: { error: String(err) },
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