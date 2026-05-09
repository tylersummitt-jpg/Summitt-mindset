import { NextResponse } from "next/server";
import { validateCronSecretRequest } from "@/lib/cron-auth";
import { supabaseServer } from "@/lib/supabase-server";
import { listClerkUsers } from "@/lib/clerk-rest";
import { createRescueToken } from "@/lib/rescue-token";
import { isTwilioReady, sendSMS } from "@/lib/twilio";
import { finalizeNorthStarCoachSmsAsync } from "@/lib/north-star-coach-sms-openai";
import {
  NORTH_STAR_SMS_LONG_FORM_MAX_LEN,
} from "@/lib/north-star-coach-sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ======================================================
 * Inactivity Rescue Cron
 * ======================================================
 *
 * Trigger (when enabled): 3+ days since Clerk `lastCompletedAt` — legacy completion signal;
 * not yet aligned with V2 spine. **Cron is off by default** so we never record "sent" without
 * a real Twilio delivery or silently no-op.
 *
 * Enable only after V2-safe inactivity signals + copy review:
 *   INACTIVITY_RESCUE_SMS_ENABLED=true
 *
 * Guardrails when live:
 * - never send twice (moment="inactivity_rescue_sent")
 */

const APP_BASE_URL = process.env.APP_BASE_URL;

function buildRescueLink(clerk_user_id: string) {
  if (!APP_BASE_URL) {
    throw new Error("Missing APP_BASE_URL (used to build rescue links)");
  }
  const token = createRescueToken({ clerk_user_id, ttlDays: 14 });
  return `${APP_BASE_URL.replace(/\/$/, "")}/rescue?t=${encodeURIComponent(token)}`;
}

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
        "inactivity_rescue_cron_disabled_default: legacy trigger uses lastCompletedAt (not V2 spine). Set INACTIVITY_RESCUE_SMS_ENABLED=true only after V2-aligned signals and copy are implemented. Sends use canonical sendSMS when enabled.",
    });
  }

  const pageLimit = 200;
  let offset = 0;

  let candidates = 0;
  let queued = 0;
  let skippedTwilio = 0;
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

        const { data: identity } = await supabaseServer
          .from("sms_identities")
          .select("phone_number, sms_enabled, stopped_at")
          .eq("clerk_user_id", clerk_user_id)
          .maybeSingle();

        if (!identity?.phone_number) continue;
        if (identity.sms_enabled !== true) continue;
        if (typeof identity.stopped_at === "string") continue;

        const link = buildRescueLink(clerk_user_id);

        if (!isTwilioReady()) {
          skippedTwilio += 1;
          await supabaseServer.from("feedback_events").insert({
            clerk_user_id,
            source: "sms",
            moment: "inactivity_rescue_skipped",
            type: "friction",
            rating: null,
            sentiment: null,
            reason_code: "skipped_missing_twilio",
            message: link,
            share_permission: false,
            metadata: {
              canonical: true,
              inactive_days: inactiveDays,
            },
          });
          continue;
        }

        const rawBody =
          `Quick check-in — want a smaller version tomorrow?\n\n` + `Tap here: ${link}`;
        const gatedRescue = await finalizeNorthStarCoachSmsAsync({
          proposedBody: rawBody,
          channel: "inactivity_rescue",
          preserveNewlines: true,
          maxLen: NORTH_STAR_SMS_LONG_FORM_MAX_LEN,
          contextPacket: { source: "inactivity_rescue" },
        });

        await sendSMS({
          to: identity.phone_number,
          body: gatedRescue.visibleBody,
          lastOutbound: {
            clerkUserId: clerk_user_id,
            messageKind: "nudge",
          },
        });

        await supabaseServer.from("feedback_events").insert({
          clerk_user_id,
          source: "sms",
          moment: "inactivity_rescue_sent",
          type: "friction",
          rating: null,
          sentiment: null,
          reason_code: "rescue_prompt_sent",
          message: link,
          share_permission: false,
          metadata: {
            canonical: true,
            inactive_days: inactiveDays,
            north_star_gate: {
              original_body: gatedRescue.meta.originalBody,
              final_body: gatedRescue.visibleBody,
              north_star_gate_source: gatedRescue.meta.source,
              north_star_gate_reasons: gatedRescue.meta.blockedReasons,
            },
          },
        });

        queued += 1;
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
    queued,
    skippedTwilio,
    errors,
  });
}
