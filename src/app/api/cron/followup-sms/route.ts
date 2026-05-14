import { NextResponse } from "next/server";
import { validateCronSecretRequest } from "@/lib/cron-auth";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENV_SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

function isInFollowupWindow(local: Date): boolean {
  const hour = local.getHours();
  return hour >= 17 && hour < 20;
}

export async function GET(req: Request) {
  if (!validateCronSecretRequest(req)) {
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
    skippedCompleted: 0,
    skippedNotInWindow: 0,
    skippedAlreadySent: 0,
    /** V2 cutover PR1: legacy follow-up nudge not sent to V2 accountability users. */
    skippedFullyOnV2Cutover: 0,
    skippedMissingTwilio: 0,
    dryRun: 0,
    failed: 0,
    skippedLegacyFollowupDeprecated: 0,
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

  for (const audienceUser of audienceUsers) {
    stats.scanned += 1;

    const v2Cutover = await resolveUserFullyOnV2ForCutoverMessaging(audienceUser.clerk_user_id);
    if (v2Cutover.fullyOnV2) {
      stats.skippedFullyOnV2Cutover += 1;
      continue;
    }

    const timezone = resolveUserTimezone(audienceUser.timezone);
    const todayKey = getDateKeyInTimezone(now, timezone);

    const localNow = new Date(
      now.toLocaleString("en-US", { timeZone: timezone })
    );

    if (!isInFollowupWindow(localNow)) {
      stats.skippedNotInWindow += 1;
      continue;
    }

    const { data: completed } = await supabaseServer
      .from("daily_completion_events")
      .select("id")
      .eq("clerk_user_id", audienceUser.clerk_user_id)
      .eq("day_key", todayKey)
      .limit(1);

    if (completed && completed.length > 0) {
      stats.skippedCompleted += 1;
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
    if (meta.followup_sent === true) {
      stats.skippedAlreadySent += 1;
      continue;
    }

    stats.eligible += 1;

    const { error: depErr } = await supabaseServer
      .from("sms_send_events")
      .update({
        status: "skipped_legacy_followup_deprecated",
        metadata: {
          ...meta,
          followup_sent: true,
          followup_deprecated: true,
          followup_withheld_legacy_deprecated: true,
          twilio_send_attempted: false,
          no_send_tag: "legacy_followup_deprecated_until_v2",
          skip_reason: "user_not_fully_on_v2_legacy_followup_deprecated",
          legacy_route: true,
          route_deprecated: true,
          old_outbound_writer_used_as_voice: false,
          relationship_lane_policy: "legacy_followup_sms_deprecated_until_v2_cutover",
          secondary_v3_lane_used: false,
          ...(SMS_DRY_RUN ? { sms_dry_run: true } : {}),
        },
      })
      .eq("clerk_user_id", audienceUser.clerk_user_id)
      .eq("day_key", todayKey);

    if (depErr) {
      console.error("[followup-sms] deprecated_metadata_update_failed", {
        clerk_user_id: audienceUser.clerk_user_id,
        day_key: todayKey,
        message: depErr.message,
      });
      stats.failed += 1;
      continue;
    }

    stats.skippedLegacyFollowupDeprecated += 1;
    if (SMS_DRY_RUN) stats.dryRun += 1;
  }

  return NextResponse.json(stats);
}
