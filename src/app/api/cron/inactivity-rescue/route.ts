import { NextResponse } from "next/server";
import { validateCronSecretRequest } from "@/lib/cron-auth";
import { supabaseServer } from "@/lib/supabase-server";
import { listClerkUsers } from "@/lib/clerk-rest";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ======================================================
 * Inactivity Rescue Cron — Phase 4.4 deprecated / no-send
 * ======================================================
 *
 * Default: `INACTIVITY_RESCUE_SMS_ENABLED` is not "true" → early return (no Clerk scan, no DB, no sends).
 *
 * When enabled: identifies legacy candidates (3+ days since Clerk `lastCompletedAt`) but does **not**
 * send SMS, refine, North Star, FVG, or signed rescue links. Records a single `feedback_events` row per user
 * (`moment: inactivity_rescue_deprecated`). Canonical reactivation is daily SMS V3.
 *
 * Legacy guard: `moment: inactivity_rescue_sent` still suppresses processing for users who received the
 * pre–4.4 SMS path.
 */

const DEPRECATED_FEEDBACK_MESSAGE = "inactivity rescue deprecated; no SMS sent";

function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export async function GET(req: Request) {
  if (!validateCronSecretRequest(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  if (process.env.INACTIVITY_RESCUE_SMS_ENABLED !== "true") {
    return NextResponse.json({
      ok: true,
      disabled: true,
      reason:
        "inactivity_rescue_cron_disabled_default: legacy trigger uses lastCompletedAt (not V2 spine). When INACTIVITY_RESCUE_SMS_ENABLED=true, the route only records deprecation in feedback_events — no SMS (Phase 4.4). Canonical reactivation is daily SMS V3.",
    });
  }

  const pageLimit = 200;
  let offset = 0;

  let candidates = 0;
  let deprecatedInactivityRescue = 0;
  let skippedAlreadyDeprecated = 0;
  let skippedFullyOnV2DailyReactivation = 0;
  const errors: Array<{ clerk_user_id: string; error: string }> = [];

  while (true) {
    const users = await listClerkUsers({ limit: pageLimit, offset });
    if (!users || users.length === 0) break;

    for (const u of users) {
      const clerk_user_id = u.id;
      const md = u.public_metadata || {};

      try {
        if (md.summittSubscribed !== true) continue;
        if (md.smsEnabled !== true) continue;
        if (typeof md.lastCompletedAt !== "string") continue;

        const inactiveDays = daysSince(md.lastCompletedAt);
        if (inactiveDays < 3) continue;

        candidates += 1;

        const { data: alreadySent } = await supabaseServer
          .from("feedback_events")
          .select("id")
          .eq("clerk_user_id", clerk_user_id)
          .eq("moment", "inactivity_rescue_sent")
          .limit(1);

        if (alreadySent && alreadySent.length > 0) continue;

        const { data: alreadyDeprecated } = await supabaseServer
          .from("feedback_events")
          .select("id")
          .eq("clerk_user_id", clerk_user_id)
          .eq("moment", "inactivity_rescue_deprecated")
          .limit(1);

        if (alreadyDeprecated && alreadyDeprecated.length > 0) {
          skippedAlreadyDeprecated += 1;
          continue;
        }

        const { data: identity } = await supabaseServer
          .from("sms_identities")
          .select("phone_number, sms_enabled, stopped_at")
          .eq("clerk_user_id", clerk_user_id)
          .maybeSingle();

        if (!identity?.phone_number) continue;
        if (identity.sms_enabled !== true) continue;
        if (typeof identity.stopped_at === "string") continue;

        const v2Gate = await resolveUserFullyOnV2ForCutoverMessaging(clerk_user_id);
        const fullyOnV2 = v2Gate.fullyOnV2;

        const baseMeta = {
          route_deprecated: true,
          legacy_route: true,
          old_outbound_writer_used_as_voice: false,
          twilio_send_attempted: false,
          secondary_v3_lane_used: false,
          relationship_lane_policy: "inactivity_rescue_sms_disabled_until_v3_redesign",
          inactivity_rescue_enabled_flag: true,
          canonical_reactivation_surface: "daily_sms_v3_reactivation",
          signed_link_generated: false,
          inactive_days: inactiveDays,
        } as const;

        const metadata = fullyOnV2
          ? {
              ...baseMeta,
              no_send_tag: "inactivity_rescue_skipped_fully_on_v2_daily_reactivation_canonical",
              skip_reason: "fully_on_v2_users_use_daily_reactivation",
              fully_on_v2: true,
            }
          : {
              ...baseMeta,
              no_send_tag: "inactivity_rescue_deprecated_use_daily_reactivation",
              skip_reason: "daily_v3_reactivation_is_canonical",
              fully_on_v2: false,
            };

        const reason_code = fullyOnV2
          ? "inactivity_rescue_skipped_fully_on_v2_daily_reactivation"
          : "inactivity_rescue_deprecated_use_daily_reactivation";

        const { error: insErr } = await supabaseServer.from("feedback_events").insert({
          clerk_user_id,
          source: "sms",
          moment: "inactivity_rescue_deprecated",
          type: "friction",
          rating: null,
          sentiment: null,
          reason_code,
          message: DEPRECATED_FEEDBACK_MESSAGE,
          share_permission: false,
          metadata: {
            ...metadata,
          },
        });

        if (insErr) {
          errors.push({ clerk_user_id, error: insErr.message });
          continue;
        }

        deprecatedInactivityRescue += 1;
        if (fullyOnV2) skippedFullyOnV2DailyReactivation += 1;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "unknown_error";
        errors.push({ clerk_user_id, error: msg });
      }
    }

    offset += users.length;
    if (users.length < pageLimit) break;
  }

  return NextResponse.json({
    ok: true,
    disabled: false,
    scannedOffset: offset,
    candidates,
    deprecatedInactivityRescue,
    skippedAlreadyDeprecated,
    skippedFullyOnV2DailyReactivation,
    queued: 0,
    skippedTwilio: 0,
    skippedNoSafeV3Voice: 0,
    errors,
  });
}
