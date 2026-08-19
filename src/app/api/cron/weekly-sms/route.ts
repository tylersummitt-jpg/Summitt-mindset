/**
 * /api/cron/weekly-sms
 *
 * weekly-sms is Weekly TTO draft-authoritative.
 * This route must not live-build weekly SMS bodies.
 *
 * No current weekly_review draft = no weekly text.
 * Blank body / missing generation / machine no-send without a Tyler edit = no weekly text.
 * A Tyler-saved nonempty edit can send even if machine_should_send=false.
 * Already reserved/sent in sms_weekly_send_events = no weekly text.
 * week_key is derived from the target Sunday (same helper as Weekly generate).
 * force=1 bypasses the Sunday noon window only — never TTO authority.
 * dryRun is side-effect free: no reserve, no Twilio, no draft finalize, no thread memory, no live-build.
 */

import crypto from "crypto";
import { NextResponse } from "next/server";
import { listClerkUsers } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone } from "@/lib/timezone";
import { resolveTylerTextOverviewWeeklyPeriod } from "@/lib/tyler-text-overview-weekly-period";
import { isTwilioReady } from "@/lib/twilio";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { isSmsInboundPendingResolutionActionable } from "@/lib/v2-guided-resolution";
import {
  fetchV2UserSmsCommsPreferences,
  shouldSkipWeeklyForCommsPrefs,
} from "@/lib/v2-sms-comms-preferences";
import {
  assertWeeklyTtoDraftAuthoritativeForCronSend,
  mapWeeklyTtoRefusalToCronSkipReason,
  sendWeeklyTtoDraftAuthoritative,
  WEEKLY_TTO_CRON_SEND_SOURCE,
} from "@/lib/tyler-text-overview-weekly-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

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

/** Sunday 12:00–12:14 user-local. */
function shouldSendNow(local: Date) {
  return (
    local.getDay() === 0 &&
    local.getHours() === 12 &&
    local.getMinutes() < 15
  );
}

export type WeeklySmsCronStats = {
  scanned: number;
  eligible: number;
  sent: number;
  failed: number;
  dryRunWouldSend: number;
  skippedOutsideSendWindow: number;
  skippedNotEligible: number;
  skippedOptedOut: number;
  skippedMissingIdentity: number;
  skippedTtoNoCurrentWeeklyDraft: number;
  skippedTtoBlankWeeklyBody: number;
  skippedTtoMissingGeneration: number;
  skippedTtoMachineShouldSendFalse: number;
  skippedTtoWeekKeyMismatch: number;
  skippedTtoAmbiguousWeeklyDraft: number;
  skippedTtoWrongSlot: number;
  skippedDuplicateWeeklySend: number;
  skippedMissingTwilio: number;
  skippedV2WeeklyPendingResolution: number;
  skippedV2WeeklyUserPause: number;
  skippedNotFullyOnV2: number;
  /** Retained for deploy continuity; always 0 after TTO cutover. */
  sentV2WeeklyProof: number;
  skippedV2WeeklyDuplicate: number;
  dryRun: number;
};

function emptyStats(): WeeklySmsCronStats {
  return {
    scanned: 0,
    eligible: 0,
    sent: 0,
    failed: 0,
    dryRunWouldSend: 0,
    skippedOutsideSendWindow: 0,
    skippedNotEligible: 0,
    skippedOptedOut: 0,
    skippedMissingIdentity: 0,
    skippedTtoNoCurrentWeeklyDraft: 0,
    skippedTtoBlankWeeklyBody: 0,
    skippedTtoMissingGeneration: 0,
    skippedTtoMachineShouldSendFalse: 0,
    skippedTtoWeekKeyMismatch: 0,
    skippedTtoAmbiguousWeeklyDraft: 0,
    skippedTtoWrongSlot: 0,
    skippedDuplicateWeeklySend: 0,
    skippedMissingTwilio: 0,
    skippedV2WeeklyPendingResolution: 0,
    skippedV2WeeklyUserPause: 0,
    skippedNotFullyOnV2: 0,
    sentV2WeeklyProof: 0,
    skippedV2WeeklyDuplicate: 0,
    dryRun: 0,
  };
}

function bumpAuthoritySkip(
  stats: WeeklySmsCronStats,
  refusalCode: string
): void {
  const mapped = mapWeeklyTtoRefusalToCronSkipReason(
    refusalCode as Parameters<typeof mapWeeklyTtoRefusalToCronSkipReason>[0]
  );
  switch (mapped) {
    case "skipped_tto_no_current_weekly_draft":
      stats.skippedTtoNoCurrentWeeklyDraft += 1;
      break;
    case "skipped_tto_blank_weekly_body":
      stats.skippedTtoBlankWeeklyBody += 1;
      break;
    case "skipped_tto_missing_generation":
      stats.skippedTtoMissingGeneration += 1;
      break;
    case "skipped_tto_machine_should_send_false":
      stats.skippedTtoMachineShouldSendFalse += 1;
      break;
    case "skipped_tto_week_key_mismatch":
      stats.skippedTtoWeekKeyMismatch += 1;
      break;
    case "skipped_tto_ambiguous_weekly_draft":
      stats.skippedTtoAmbiguousWeeklyDraft += 1;
      break;
    case "skipped_tto_wrong_slot":
      stats.skippedTtoWrongSlot += 1;
      break;
    case "skipped_duplicate_weekly_send":
      stats.skippedDuplicateWeeklySend += 1;
      stats.skippedV2WeeklyDuplicate += 1;
      break;
    case "skipped_missing_twilio":
      stats.skippedMissingTwilio += 1;
      break;
    case "failed":
      stats.failed += 1;
      break;
    default:
      stats.skippedNotEligible += 1;
  }
}

export async function GET(req: Request) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const dryRun = url.searchParams.get("dryRun") === "1";

  const stats = emptyStats();
  const pageLimit = 200;
  let offset = 0;
  const now = new Date();

  while (true) {
    const users = await listClerkUsers({ limit: pageLimit, offset });
    if (!users || users.length === 0) break;

    for (const user of users) {
      stats.scanned += 1;

      const md = user.public_metadata || {};

      if (md.summittSubscribed !== true) {
        stats.skippedNotEligible += 1;
        continue;
      }
      if (md.smsEnabled !== true) {
        stats.skippedNotEligible += 1;
        continue;
      }

      const { data: identity } = await supabaseServer
        .from("sms_identities")
        .select("phone_number, sms_enabled, stopped_at")
        .eq("clerk_user_id", user.id)
        .maybeSingle();

      if (!identity?.phone_number) {
        stats.skippedMissingIdentity += 1;
        continue;
      }

      if (identity.sms_enabled !== true || identity.stopped_at) {
        stats.skippedOptedOut += 1;
        continue;
      }

      const timezone = resolveUserTimezone(md.timezone);
      const localNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

      if (!force && !shouldSendNow(localNow)) {
        stats.skippedOutsideSendWindow += 1;
        continue;
      }

      const v2Gate = await resolveUserFullyOnV2ForCutoverMessaging(user.id);
      if (!v2Gate.fullyOnV2) {
        stats.skippedNotFullyOnV2 += 1;
        continue;
      }

      const commitment = await getActiveCommitment(user.id);
      if (!commitment?.id) {
        stats.skippedNotEligible += 1;
        continue;
      }
      if (isSmsInboundPendingResolutionActionable(commitment)) {
        stats.skippedV2WeeklyPendingResolution += 1;
        continue;
      }

      const weeklyCommsPrefs = await fetchV2UserSmsCommsPreferences(user.id);
      if (shouldSkipWeeklyForCommsPrefs(weeklyCommsPrefs, now)) {
        stats.skippedV2WeeklyUserPause += 1;
        continue;
      }

      stats.eligible += 1;
      const weekKey = resolveTylerTextOverviewWeeklyPeriod({
        now,
        timezone,
      }).weekKey;

      // dryRun: authority only — no reserve, Twilio, draft finalize, thread memory, or live-build.
      if (dryRun) {
        stats.dryRun += 1;
        const authority = await assertWeeklyTtoDraftAuthoritativeForCronSend({
          clerkUserId: user.id,
          weekKey,
        });
        if (!authority.ok) {
          const refusal = authority.result;
          if (!refusal.ok) {
            bumpAuthoritySkip(stats, refusal.refusalCode);
          } else {
            stats.skippedNotEligible += 1;
          }
          continue;
        }
        stats.dryRunWouldSend += 1;
        continue;
      }

      if (!isTwilioReady()) {
        stats.skippedMissingTwilio += 1;
        continue;
      }

      const authority = await assertWeeklyTtoDraftAuthoritativeForCronSend({
        clerkUserId: user.id,
        weekKey,
      });
      if (!authority.ok) {
        const refusal = authority.result;
        if (!refusal.ok) {
          bumpAuthoritySkip(stats, refusal.refusalCode);
        } else {
          stats.skippedNotEligible += 1;
        }
        continue;
      }

      const sendResult = await sendWeeklyTtoDraftAuthoritative({
        draft: authority.draft,
        sendSource: WEEKLY_TTO_CRON_SEND_SOURCE,
        phoneTo: identity.phone_number,
        now,
      });

      if (!sendResult.ok) {
        bumpAuthoritySkip(stats, sendResult.refusalCode);
        continue;
      }

      stats.sent += 1;
    }

    offset += users.length;
    if (users.length < pageLimit) break;
  }

  return NextResponse.json({
    ok: true,
    tto_draft_authoritative: true,
    force,
    dry_run: dryRun,
    ...stats,
  });
}
