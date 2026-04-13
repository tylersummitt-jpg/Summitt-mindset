// src/app/api/cron/weekly-sms/route.ts

import crypto from "crypto";
import { NextResponse } from "next/server";
import { listClerkUsers } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone } from "@/lib/timezone";
import { generateWeeklySmsReflection } from "@/lib/weekly-sms-reflection-shadow";
import { getWeekKey } from "@/lib/weekly-sms-week-key";
import { sendSMS, isTwilioReady } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const ENV_SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

const PAT_PAUSE_INTROS = [
  "Time for a Pat Pause.",
  "Let’s take a Pat Pause.",
  "It’s your weekly Pat Pause.",
  "Time for our Sunday Pat Pause.",
] as const;

const WEEKLY_SMS_COMPLIANCE_FOOTER =
  "Reply STOP to opt out. Reply HELP for help.";

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

/**
 * ======================================================
 * Sunday 12PM (noon) Local Logic
 * ======================================================
 */
function shouldSendNow(local: Date) {
  return (
    local.getDay() === 0 && // Sunday
    local.getHours() === 12 &&
    local.getMinutes() < 15
  );
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

      try {
        await generateWeeklySmsReflection(user.id, timezone, localNow);
      } catch (e) {
        console.error("[weekly-sms-shadow] failed", {
          userId: user.id,
          error: String(e),
        });
      }

      stats.eligible++;

      const weekKey = getWeekKey(localNow);

      const { data: reflectionRow } = await supabaseServer
        .from("weekly_sms_reflections")
        .select("sms_body, status")
        .eq("clerk_user_id", user.id)
        .eq("week_key", weekKey)
        .maybeSingle();

      const reflectionSmsBodyTrimmed =
        typeof reflectionRow?.sms_body === "string"
          ? reflectionRow.sms_body.trim()
          : "";
      const validSmsBody =
        reflectionRow != null &&
        reflectionSmsBodyTrimmed.length > 50 &&
        reflectionRow.status !== "generation_failed";

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
        `I’ve been thinking about your week.\n\n` +
        `${summaryText}\n\n` +
        `You showed up. That matters more than you think.\n` +
        `This is how momentum is built — one day at a time.\n\n` +
        `Keep going. I’m with you.\n\n` +
        `Reply anytime.\n\n` +
        `${WEEKLY_SMS_COMPLIANCE_FOOTER}`;

      const outgoingBody = validSmsBody
        ? reflectionSmsBodyTrimmed
        : smsBody;

      const intro =
        PAT_PAUSE_INTROS[
          Math.floor(Math.random() * PAT_PAUSE_INTROS.length)
        ];

      let bodyForWrap = outgoingBody.trim();
      if (bodyForWrap.endsWith(WEEKLY_SMS_COMPLIANCE_FOOTER)) {
        bodyForWrap = bodyForWrap
          .slice(0, -WEEKLY_SMS_COMPLIANCE_FOOTER.length)
          .replace(/\s+$/, "");
      }

      const finalBody =
        `${intro}\n\n${bodyForWrap}\n\n${WEEKLY_SMS_COMPLIANCE_FOOTER}`;

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
          body: finalBody,
          lastOutbound: {
            clerkUserId: user.id,
            messageKind: "weekly",
          },
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