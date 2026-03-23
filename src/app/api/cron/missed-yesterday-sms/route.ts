import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { sendSMS, isTwilioReady } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const ENV_SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

const MESSAGE = "Yesterday doesn't matter. Let's take today.";

function validateCronSecret(req: Request): boolean {
  if (!CRON_SECRET) return false;
  const header = req.headers.get("x-cron-secret");
  return header === CRON_SECRET;
}

function isMorningWindow(local: Date): boolean {
  const hour = local.getHours();
  return hour >= 6 && hour < 10;
}

export async function GET(req: Request) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRunOverride = url.searchParams.get("dryRun") === "1";
  const SMS_DRY_RUN = ENV_SMS_DRY_RUN || dryRunOverride;

  const stats = {
    ok: true,
    scanned: 0,
    eligible: 0,
    sent: 0,
    skippedCompletedToday: 0,
    skippedCompletedYesterday: 0,
    skippedAlreadySent: 0,
    skippedNotInWindow: 0,
    skippedMissingTwilio: 0,
    dryRun: 0,
    failed: 0,
  };

  const { data: audienceUsers } = await supabaseServer
    .from("sms_audience")
    .select("clerk_user_id, phone_number, timezone")
    .eq("summitt_subscribed", true)
    .eq("sms_enabled", true);

  if (!audienceUsers || audienceUsers.length === 0) {
    return NextResponse.json(stats);
  }

  const now = new Date();
  const oneDayMs = 86_400_000;

  for (const audienceUser of audienceUsers) {
    stats.scanned += 1;

    const timezone = resolveUserTimezone(audienceUser.timezone);
    const todayKey = getDateKeyInTimezone(now, timezone);
    const yesterdayDate = new Date(now.getTime() - oneDayMs);
    const yesterdayKey = getDateKeyInTimezone(yesterdayDate, timezone);

    const localNow = new Date(
      now.toLocaleString("en-US", { timeZone: timezone })
    );

    if (!isMorningWindow(localNow)) {
      stats.skippedNotInWindow += 1;
      continue;
    }

    const { data: completedToday } = await supabaseServer
      .from("daily_completion_events")
      .select("id")
      .eq("clerk_user_id", audienceUser.clerk_user_id)
      .eq("day_key", todayKey)
      .limit(1);

    if (completedToday && completedToday.length > 0) {
      stats.skippedCompletedToday += 1;
      continue;
    }

    const { data: completedYesterday } = await supabaseServer
      .from("daily_completion_events")
      .select("id")
      .eq("clerk_user_id", audienceUser.clerk_user_id)
      .eq("day_key", yesterdayKey)
      .limit(1);

    if (completedYesterday && completedYesterday.length > 0) {
      stats.skippedCompletedYesterday += 1;
      continue;
    }

    const { data: existingEvent } = await supabaseServer
      .from("sms_send_events")
      .select("id, metadata")
      .eq("clerk_user_id", audienceUser.clerk_user_id)
      .eq("day_key", todayKey)
      .maybeSingle();

    if (!existingEvent) {
      stats.skippedAlreadySent += 1;
      continue;
    }

    const meta = (existingEvent?.metadata || {}) as Record<string, unknown>;
    if (meta.missed_yesterday_sent === true) {
      stats.skippedAlreadySent += 1;
      continue;
    }

    stats.eligible += 1;

    if (!isTwilioReady() || SMS_DRY_RUN) {
      if (SMS_DRY_RUN) stats.dryRun += 1;
      else stats.skippedMissingTwilio += 1;
      continue;
    }

    try {
      await sendSMS({
        to: audienceUser.phone_number,
        body: MESSAGE,
      });

      if (existingEvent) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            metadata: { ...meta, missed_yesterday_sent: true },
          })
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);
      } else {
        await supabaseServer.from("sms_send_events").insert({
          clerk_user_id: audienceUser.clerk_user_id,
          day_key: todayKey,
          status: "missed_yesterday_sent",
          metadata: { missed_yesterday_sent: true, note: "missed_yesterday_cron" },
        });
      }

      stats.sent += 1;
    } catch (err) {
      console.error(
        "[missed-yesterday-sms] send failed:",
        audienceUser.clerk_user_id,
        err
      );
      stats.failed += 1;
    }
  }

  return NextResponse.json(stats);
}
