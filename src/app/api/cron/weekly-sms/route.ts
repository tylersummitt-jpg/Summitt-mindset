// src/app/api/cron/weekly-sms/route.ts

import { NextResponse } from "next/server";
import { listClerkUsers } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone } from "@/lib/timezone";
import { sendSMS, isTwilioReady } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const ENV_SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

/**
 * ======================================================
 * CRON AUTH (Same pattern as daily)
 * ======================================================
 *
 * Vercel sends CRON_SECRET as Authorization: Bearer <CRON_SECRET> when the env var is set.
 * We also accept x-vercel-cron, x-cron-secret, and ?secret= for compatibility and safe testing.
 */
function validateCronSecret(req: Request) {
  // 1) Vercel cron header (truthy values; no CRON_SECRET required)
  const vercelCronHeader = req.headers.get("x-vercel-cron");
  const isVercelCron =
    vercelCronHeader === "1" ||
    vercelCronHeader === "true" ||
    vercelCronHeader === "True" ||
    vercelCronHeader === "yes" ||
    vercelCronHeader === "on";

  if (isVercelCron) return true;

  // 2) Authorization: Bearer <CRON_SECRET> (Vercel's documented method)
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) return true;

  // 3) Manual secret (header or query param) for compatibility and safe testing
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
 * Sunday 5PM Local Logic
 * ======================================================
 */
function shouldSendNow(local: Date) {
  return (
    local.getDay() === 0 && // Sunday
    local.getHours() === 17 &&
    local.getMinutes() < 5
  );
}

/**
 * Deterministic week key (YYYY-WW)
 */
function getWeekKey(local: Date) {
  const year = local.getFullYear();
  const firstJan = new Date(year, 0, 1);
  const pastDays = Math.floor(
    (local.getTime() - firstJan.getTime()) / 86400000
  );
  const weekNumber = Math.ceil((pastDays + firstJan.getDay() + 1) / 7);
  return `${year}-W${weekNumber}`;
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
    scanned: 0,
    eligible: 0,
    reserved: 0,
    sent: 0,
    dryRun: 0,
    skippedNotTime: 0,
    skippedOptedOut: 0,
    skippedMissingIdentity: 0,
    skippedMissingTwilio: 0,
    failed: 0,
  };

  const pageLimit = 200;
  let offset = 0;

  while (true) {
    const users = await listClerkUsers({ limit: pageLimit, offset });
    if (!users || users.length === 0) break;

    for (const user of users) {
      stats.scanned++;

      const md = user.public_metadata || {};

      if (md.summittSubscribed !== true) continue;
      if (md.smsEnabled !== true) continue;

      const { data: identity } = await supabaseServer
        .from("sms_identities")
        .select("phone_number, sms_enabled, stopped_at")
        .eq("clerk_user_id", user.id)
        .maybeSingle();

      if (!identity?.phone_number) {
        stats.skippedMissingIdentity++;
        continue;
      }

      if (identity.sms_enabled !== true || identity.stopped_at) {
        stats.skippedOptedOut++;
        continue;
      }

      const timezone = resolveUserTimezone(md.timezone);
      const now = new Date();

      const localNow = new Date(
        now.toLocaleString("en-US", { timeZone: timezone })
      );

      if (!force && !shouldSendNow(localNow)) {
        stats.skippedNotTime++;
        continue;
      }

      stats.eligible++;

      const weekKey = getWeekKey(localNow);

      const { error: reservationError } = await supabaseServer
        .from("sms_weekly_send_events")
        .insert({
          clerk_user_id: user.id,
          week_key: weekKey,
          status: "reserved",
        });

      if (reservationError) continue;

      stats.reserved++;

      /**
       * Pull latest weekly summary
       */
      const { data: summary } = await supabaseServer
        .from("weekly_summaries")
        .select("weekly_summary")
        .eq("clerk_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const summaryText =
        summary?.weekly_summary ||
        "You showed up this week. That matters.";

      const smsBody =
        `WEEKLY REFLECTION\n\n` +
        `${summaryText}\n\n` +
        `Keep building. Reply anytime to keep training.\n\n` +
        `Reply STOP to opt out. Reply HELP for help.`;

      if (!isTwilioReady() || SMS_DRY_RUN) {
        await supabaseServer
          .from("sms_weekly_send_events")
          .update({
            status: SMS_DRY_RUN ? "dry_run" : "skipped_missing_twilio",
          })
          .eq("clerk_user_id", user.id)
          .eq("week_key", weekKey);

        if (SMS_DRY_RUN) stats.dryRun++;
        else stats.skippedMissingTwilio++;

        continue;
      }

      try {
        const message = await sendSMS({
          to: identity.phone_number,
          body: smsBody,
        });

        await supabaseServer
          .from("sms_weekly_send_events")
          .update({
            message_sid: message.sid,
            status: message.status,
          })
          .eq("clerk_user_id", user.id)
          .eq("week_key", weekKey);

        stats.sent++;
      } catch (err) {
        await supabaseServer
          .from("sms_weekly_send_events")
          .update({
            status: "send_failed",
            metadata: { error: String(err) },
          })
          .eq("clerk_user_id", user.id)
          .eq("week_key", weekKey);

        stats.failed++;
      }
    }

    offset += users.length;
    if (users.length < pageLimit) break;
  }

  return NextResponse.json(stats);
}