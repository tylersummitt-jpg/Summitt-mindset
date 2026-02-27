// src/app/api/cron/daily-sms/route.ts

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
const SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

/**
 * ======================================================
 * CRON AUTH (CANONICAL)
 * ======================================================
 *
 * We DO NOT use Authorization: Bearer because Clerk middleware
 * may attempt to parse it as a Clerk JWT.
 *
 * Use:
 *   x-cron-secret: <CRON_SECRET>
 *
 * Back-compat (temporary):
 *   ?secret=<CRON_SECRET>
 */
function validateCron(req: Request): boolean {
  if (!CRON_SECRET) return false;

  // ✅ Preferred: header auth
  const header = req.headers.get("x-cron-secret");
  if (header && header === CRON_SECRET) return true;

  // ✅ Temporary back-compat: query param
  const url = new URL(req.url);
  const qp = url.searchParams.get("secret");
  if (qp && qp === CRON_SECRET) return true;

  return false;
}

/**
 * ======================================================
 * Rolling 8AM Local Send Logic
 * ======================================================
 *
 * Cron runs frequently (e.g., every 5 minutes).
 * We send if:
 *   local hour === 8
 *   local minute < 5
 *
 * Unique index on (clerk_user_id, day_key) ensures idempotency.
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

/**
 * ======================================================
 * GET /api/cron/daily-sms
 * ======================================================
 *
 * Note:
 * Vercel Cron can hit GET endpoints easily.
 * We keep GET.
 */
export async function GET(req: Request) {
  if (!validateCron(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const pageLimit = 200;
  let offset = 0;

  let scanned = 0;
  let reserved = 0;
  let sent = 0;
  let dryRun = 0;
  let skipped = 0;
  let failed = 0;

  while (true) {
    const users = await listClerkUsers({ limit: pageLimit, offset });
    if (!users || users.length === 0) break;

    for (const user of users) {
      scanned += 1;

      const md = user.public_metadata || {};

      // Subscription + SMS master switches
      if (md.summittSubscribed !== true) continue;
      if (md.smsEnabled !== true) continue;

      // Identity check (server-side source of truth for STOP/START)
      const { data: identity } = await supabaseServer
        .from("sms_identities")
        .select("phone_number, sms_enabled, stopped_at")
        .eq("clerk_user_id", user.id)
        .maybeSingle();

      if (!identity?.phone_number) continue;
      if (identity.sms_enabled !== true) continue;
      if (typeof identity.stopped_at === "string") continue;

      const timezone = resolveUserTimezone(md.timezone);
      const now = new Date();

      // Local time
      const localNow = new Date(
        now.toLocaleString("en-US", { timeZone: timezone })
      );

      // Only fire inside the local 8:00–8:04 window
      if (!shouldSendNow(localNow)) continue;

      // Day key is computed with the same timezone utility
      const todayKey = getDateKeyInTimezone(now, timezone);

      // ------------------------------------------
      // 1) Reserve idempotently (unique index)
      // ------------------------------------------
      const { error: reservationError } = await supabaseServer
        .from("sms_send_events")
        .insert({
          clerk_user_id: user.id,
          day_key: todayKey,
          status: "reserved",
        });

      // If unique violation, we've already attempted today. Skip.
      if (reservationError) {
        skipped += 1;
        continue;
      }

      reserved += 1;

      // ------------------------------------------
      // 2) If already completed today, skip
      // ------------------------------------------
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

        skipped += 1;
        continue;
      }

      // ------------------------------------------
      // 3) Build content
      // ------------------------------------------
      const dayNumber =
        typeof md.currentDay === "number" && md.currentDay > 0 ? md.currentDay : 1;

      const { level } = getUserStalenessLevel({
        timezoneFromMetadata: md.timezone,
        lastCompletedAt: md.lastCompletedAt,
        now,
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

      // ------------------------------------------
      // 4) Dry run / env not ready
      // ------------------------------------------
      if (!isTwilioReady() || SMS_DRY_RUN) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: SMS_DRY_RUN ? "dry_run" : "skipped_missing_twilio",
            metadata: {
              timezone,
              localNow: localNow.toISOString(),
              dryRun: SMS_DRY_RUN,
              twilioReady: isTwilioReady(),
            },
          })
          .eq("clerk_user_id", user.id)
          .eq("day_key", todayKey);

        if (SMS_DRY_RUN) dryRun += 1;
        else skipped += 1;

        continue;
      }

      // ------------------------------------------
      // 5) Send
      // ------------------------------------------
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

        sent += 1;
      } catch (err) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: "send_failed",
            metadata: { error: String(err) },
          })
          .eq("clerk_user_id", user.id)
          .eq("day_key", todayKey);

        failed += 1;
      }
    }

    offset += users.length;
    if (users.length < pageLimit) break;
  }

  return NextResponse.json({
    ok: true,
    scanned,
    reserved,
    sent,
    dryRun,
    skipped,
    failed,
  });
}