import { NextResponse } from "next/server";
import { validateCronSecretRequest } from "@/lib/cron-auth";
import { supabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ======================================================
 * Post-Churn Winback Cron — Phase 4.5 deprecated / no-send
 * ======================================================
 *
 * Auth + cancel_attempt scan (7–10 day window) unchanged.
 * Does not send SMS, refine, North Star, FVG, or signed winback links.
 * Records one `post_churn_winback_deprecated` feedback row per user (deduped).
 * Legacy `post_churn_winback_sent` rows still suppress processing.
 */

const DEPRECATED_MESSAGE = "post-churn winback deprecated; no SMS sent";

function daysAgoIso(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export async function GET(req: Request) {
  if (!validateCronSecretRequest(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const startIso = daysAgoIso(10);
  const endIso = daysAgoIso(7);

  const { data: cancels, error: cancelErr } = await supabaseServer
    .from("feedback_events")
    .select("id, clerk_user_id, created_at")
    .eq("moment", "cancel_attempt")
    .eq("type", "churn")
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (cancelErr) {
    return NextResponse.json(
      { ok: false, reason: "db_cancel_query_failed", error: cancelErr.message },
      { status: 500 }
    );
  }

  if (!cancels || cancels.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      reason: "none_in_window",
      candidates: 0,
      deprecatedPostChurnWinback: 0,
      skippedAlreadyDeprecated: 0,
      skippedAlreadySent: 0,
      skippedTwilio: 0,
      skippedNoSafeV3Voice: 0,
      errors: [],
    });
  }

  let deprecatedPostChurnWinback = 0;
  let skippedAlreadyDeprecated = 0;
  let skippedAlreadySent = 0;
  const errors: Array<{ clerk_user_id: string; error: string }> = [];

  for (const row of cancels) {
    const clerk_user_id = row.clerk_user_id;

    try {
      const { data: alreadySent } = await supabaseServer
        .from("feedback_events")
        .select("id")
        .eq("clerk_user_id", clerk_user_id)
        .eq("moment", "post_churn_winback_sent")
        .limit(1);

      if (alreadySent && alreadySent.length > 0) {
        skippedAlreadySent += 1;
        continue;
      }

      const { data: alreadyDeprecated } = await supabaseServer
        .from("feedback_events")
        .select("id")
        .eq("clerk_user_id", clerk_user_id)
        .eq("moment", "post_churn_winback_deprecated")
        .limit(1);

      if (alreadyDeprecated && alreadyDeprecated.length > 0) {
        skippedAlreadyDeprecated += 1;
        continue;
      }

      const { error: insErr } = await supabaseServer.from("feedback_events").insert({
        clerk_user_id,
        source: "sms",
        moment: "post_churn_winback_deprecated",
        type: "churn",
        rating: null,
        sentiment: null,
        reason_code: "post_churn_winback_deprecated_no_sms",
        message: DEPRECATED_MESSAGE,
        share_permission: false,
        metadata: {
          route_deprecated: true,
          legacy_route: true,
          no_send_tag: "post_churn_winback_deprecated_no_sms",
          skip_reason: "post_churn_sms_disabled_until_safe_research_spec",
          old_outbound_writer_used_as_voice: false,
          twilio_send_attempted: false,
          secondary_v3_lane_used: false,
          relationship_lane_policy: "post_churn_winback_sms_disabled_until_safe_research_spec",
          product_research_sms_disabled: true,
          signed_link_generated: false,
          signed_url_stored: false,
          source_cancel_event_id: row.id,
          cancel_event_created_at: row.created_at,
        },
      });

      if (insErr) {
        errors.push({ clerk_user_id, error: insErr.message });
        continue;
      }

      deprecatedPostChurnWinback += 1;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown_error";
      errors.push({ clerk_user_id, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    sent: 0,
    candidates: cancels.length,
    deprecatedPostChurnWinback,
    skippedAlreadyDeprecated,
    skippedAlreadySent,
    skippedTwilio: 0,
    skippedNoSafeV3Voice: 0,
    errors,
  });
}
