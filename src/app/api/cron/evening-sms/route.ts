/**
 * /api/cron/evening-sms
 *
 * Evening TTO draft-authoritative auto-send for user-local [19:00, 21:00).
 * Does not generate drafts. Does not call OpenAI.
 * Does not branch into Morning daily-sms.
 */

import crypto from "crypto";
import { NextResponse } from "next/server";
import { getClerkUser } from "@/lib/clerk-rest";
import {
  evaluateEveningLaneTiming,
} from "@/lib/daily-sms-scheduling";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveSmsUserTimezone } from "@/lib/timezone";
import { isTwilioReady } from "@/lib/twilio";
import {
  evaluateOutboundSmsForAccountDeletion,
} from "@/lib/account-deletion/deletion-guards";
import {
  sendEveningTtoAuthoritativeCronSend,
  type TylerTextOverviewEveningSendRefusalCode,
} from "@/lib/tyler-text-overview-evening-send";
import { SMS_DAILY_EVENING_PREVIEW_SEND_SLOT } from "@/lib/tyler-text-overview-types";
import {
  fetchV2UserSmsCommsPreferences,
  shouldSkipDailyForCommsPrefs,
} from "@/lib/v2-sms-comms-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const ENV_SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

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

type SmsAudienceCronRow = {
  clerk_user_id: string;
  phone_number: string;
  sms_enabled: boolean;
  stopped_at: string | null;
  timezone: string | null;
  summitt_subscribed: boolean;
};

function bumpSkip(
  stats: {
    skippedTtoNoCurrentEveningDraft: number;
    skippedTtoBlankEveningBody: number;
    skippedTtoMissingGeneration: number;
    skippedTtoMachineShouldSendFalse: number;
    skippedOutsideEveningWindow: number;
    alreadyReservedOrSentToday: number;
    skippedOptedOut: number;
    skippedMissingIdentity: number;
    skippedUserPause: number;
    skippedNotFullyOnV2: number;
    skippedUserCompletedToday: number;
    skippedMissingTwilio: number;
    dryRunWouldSend: number;
    failed: number;
    skippedOther: number;
  },
  code: TylerTextOverviewEveningSendRefusalCode | string
): void {
  switch (code) {
    case "tto_no_current_evening_draft":
      stats.skippedTtoNoCurrentEveningDraft += 1;
      break;
    case "tto_blank_evening_body":
    case "body_empty":
      stats.skippedTtoBlankEveningBody += 1;
      break;
    case "tto_missing_generation":
    case "preview_body_missing":
      stats.skippedTtoMissingGeneration += 1;
      break;
    case "tto_machine_should_send_false":
    case "machine_should_send_false":
      stats.skippedTtoMachineShouldSendFalse += 1;
      break;
    case "outside_evening_window":
      stats.skippedOutsideEveningWindow += 1;
      break;
    case "already_sent_evening_today":
    case "already_reserved_evening_today":
      stats.alreadyReservedOrSentToday += 1;
      break;
    case "stopped_or_unsubscribed":
    case "sms_disabled":
      stats.skippedOptedOut += 1;
      break;
    case "no_phone":
      stats.skippedMissingIdentity += 1;
      break;
    case "paused_or_canceled":
      stats.skippedUserPause += 1;
      break;
    case "not_fully_on_v2":
      stats.skippedNotFullyOnV2 += 1;
      break;
    case "user_completed_today":
      stats.skippedUserCompletedToday += 1;
      break;
    case "twilio_not_configured":
      stats.skippedMissingTwilio += 1;
      break;
    case "dry_run":
      stats.dryRunWouldSend += 1;
      break;
    case "twilio_failed":
      stats.failed += 1;
      break;
    default:
      stats.skippedOther += 1;
      break;
  }
}

export async function GET(req: Request) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRunOverride = url.searchParams.get("dryRun") === "1";
  const dryRun = ENV_SMS_DRY_RUN || dryRunOverride;

  const stats = {
    ok: true as const,
    send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    scanned: 0,
    eligible: 0,
    sent: 0,
    failed: 0,
    dryRun: 0,
    dryRunWouldSend: 0,
    skippedOutsideEveningWindow: 0,
    skippedNotTime: 0,
    skippedMissingIdentity: 0,
    skippedOptedOut: 0,
    skippedUserPause: 0,
    skippedUserWeekendPolicy: 0,
    skippedNotFullyOnV2: 0,
    skippedUserCompletedToday: 0,
    skippedTtoNoCurrentEveningDraft: 0,
    skippedTtoBlankEveningBody: 0,
    skippedTtoMissingGeneration: 0,
    skippedTtoMachineShouldSendFalse: 0,
    alreadyReservedOrSentToday: 0,
    skippedMissingTwilio: 0,
    skippedOther: 0,
    skippedDeletionBlocked: 0,
  };

  const { data: audienceRows, error: audienceError } = await supabaseServer
    .from("sms_audience")
    .select("clerk_user_id, phone_number, sms_enabled, stopped_at, timezone, summitt_subscribed")
    .eq("sms_enabled", true)
    .eq("summitt_subscribed", true)
    .is("stopped_at", null);

  if (audienceError) {
    console.error("[evening-sms] sms_audience load failed", audienceError.message);
    return NextResponse.json(
      { ok: false, error: `sms_audience_load_failed:${audienceError.message}` },
      { status: 500 }
    );
  }

  const rows = (audienceRows ?? []).filter(
    (r): r is SmsAudienceCronRow =>
      typeof r.clerk_user_id === "string" &&
      typeof r.phone_number === "string" &&
      r.phone_number.trim().length > 0 &&
      r.sms_enabled === true &&
      r.summitt_subscribed === true &&
      (r.stopped_at == null || r.stopped_at === "")
  );

  for (const audienceUser of rows) {
    stats.scanned += 1;

    const deletion = await evaluateOutboundSmsForAccountDeletion(audienceUser.clerk_user_id);
    if (deletion.decision === "blocked_due_to_deletion") {
      stats.skippedDeletionBlocked += 1;
      continue;
    }
    if (deletion.decision === "lookup_failed" || deletion.decision === "missing_clerk_user_id") {
      stats.skippedOther += 1;
      continue;
    }

    let md: Record<string, unknown> = {};
    try {
      const user = await getClerkUser(audienceUser.clerk_user_id);
      md = (user.public_metadata || {}) as Record<string, unknown>;
    } catch (e) {
      console.error("[evening-sms] getClerkUser failed", audienceUser.clerk_user_id, e);
      stats.skippedOther += 1;
      continue;
    }

    const tzResolved = resolveSmsUserTimezone({
      clerkMetadataTimezone: md.timezone,
      audienceTimezone: audienceUser.timezone,
    });
    const timezone = tzResolved.timezone;
    const now = new Date();
    const localNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

    const commsPrefs = await fetchV2UserSmsCommsPreferences(audienceUser.clerk_user_id);
    const commsSkip = shouldSkipDailyForCommsPrefs(commsPrefs, localNow, now);
    if (commsSkip.skip && commsSkip.reason === "user_pause") {
      stats.skippedUserPause += 1;
      continue;
    }
    if (commsSkip.skip && commsSkip.reason === "weekend_policy") {
      stats.skippedUserWeekendPolicy += 1;
      continue;
    }

    const timing = evaluateEveningLaneTiming({ now, timezone });
    if (!timing.allowed) {
      stats.skippedOutsideEveningWindow += 1;
      stats.skippedNotTime += 1;
      continue;
    }

    stats.eligible += 1;

    if (!isTwilioReady() && !dryRun) {
      stats.skippedMissingTwilio += 1;
      continue;
    }

    const result = await sendEveningTtoAuthoritativeCronSend({
      clerkUserId: audienceUser.clerk_user_id,
      phoneNumber: audienceUser.phone_number.trim(),
      timezone,
      now,
      dryRun,
    });

    if (dryRun) {
      stats.dryRun += 1;
    }

    if (result.ok) {
      stats.sent += 1;
      continue;
    }

    bumpSkip(stats, result.refusalCode);
  }

  return NextResponse.json({
    ...stats,
    dry_run: dryRun,
  });
}
