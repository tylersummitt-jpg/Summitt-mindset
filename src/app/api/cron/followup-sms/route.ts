import { NextResponse } from "next/server";
import { validateCronSecretRequest } from "@/lib/cron-auth";
import { getClerkUser } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { getUserStalenessLevel } from "@/lib/get-user-staleness";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { sendSMS, isTwilioReady } from "@/lib/twilio";
import { finalizeNorthStarCoachSmsAsync } from "@/lib/north-star-coach-sms-openai";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENV_SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

function isInFollowupWindow(local: Date): boolean {
  const hour = local.getHours();
  return hour >= 17 && hour < 20;
}

function getFollowupMessage(level: string): string {
  if (level === "short_idle") return "Let's just step back in today. That's enough.";
  if (level === "medium_idle") return "No need to overthink it. Just start again today.";
  if (level === "long_idle") return "I've missed you. Let's jump back in when you're ready.";
  return "You still have time today. Let's get a win.";
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

    const user = await getClerkUser(audienceUser.clerk_user_id);
    const md = user.public_metadata || {};

    const timezone = resolveUserTimezone(audienceUser.timezone);
    const todayKey = getDateKeyInTimezone(now, timezone);

    const localNow = new Date(
      now.toLocaleString("en-US", { timeZone: timezone })
    );

    const { level } = getUserStalenessLevel({
      timezoneFromMetadata: md.timezone,
      lastCompletedAt: md.lastCompletedAt,
    });

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

    if (!isTwilioReady() || SMS_DRY_RUN) {
      if (SMS_DRY_RUN) stats.dryRun += 1;
      else stats.skippedMissingTwilio += 1;
      continue;
    }

    try {
      const rawFollowup = getFollowupMessage(level);
      const gatedFollowup = await finalizeNorthStarCoachSmsAsync({
        proposedBody: rawFollowup,
        channel: "followup_sms",
        contextPacket: { source: "followup_sms" },
      });
      await sendSMS({
        to: audienceUser.phone_number,
        body: gatedFollowup.visibleBody,
        lastOutbound: {
          clerkUserId: audienceUser.clerk_user_id,
          messageKind: "nudge",
        },
      });

      if (existingEvent) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            metadata: {
              ...meta,
              followup_sent: true,
              north_star_gate: {
                original_body: gatedFollowup.meta.originalBody,
                final_body: gatedFollowup.visibleBody,
                north_star_gate_source: gatedFollowup.meta.source,
                north_star_gate_reasons: gatedFollowup.meta.blockedReasons,
                openai_attempted: gatedFollowup.meta.openaiAttempted,
                openai_failed_reason: gatedFollowup.meta.openaiFailedReason ?? null,
                context_packet_used: gatedFollowup.meta.contextPacketUsed,
                finalizer_version: gatedFollowup.meta.finalizerVersion,
              },
            },
          })
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);
      } else {
        await supabaseServer.from("sms_send_events").insert({
          clerk_user_id: audienceUser.clerk_user_id,
          day_key: todayKey,
          status: "followup_sent",
          metadata: {
            followup_sent: true,
            note: "followup_cron",
            north_star_gate: {
              original_body: gatedFollowup.meta.originalBody,
              final_body: gatedFollowup.visibleBody,
              north_star_gate_source: gatedFollowup.meta.source,
              north_star_gate_reasons: gatedFollowup.meta.blockedReasons,
              openai_attempted: gatedFollowup.meta.openaiAttempted,
              openai_failed_reason: gatedFollowup.meta.openaiFailedReason ?? null,
              context_packet_used: gatedFollowup.meta.contextPacketUsed,
              finalizer_version: gatedFollowup.meta.finalizerVersion,
            },
          },
        });
      }

      stats.sent += 1;
    } catch (err) {
      console.error("[followup-sms] send failed:", audienceUser.clerk_user_id, err);
      stats.failed += 1;
    }
  }

  return NextResponse.json(stats);
}
