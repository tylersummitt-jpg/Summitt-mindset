import { NextResponse } from "next/server";
import { validateCronSecretRequest } from "@/lib/cron-auth";
import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { createWinbackToken } from "@/lib/winback-token";
import { isTwilioReady, sendSMS } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ======================================================
 * Post-Churn Winback Intel Cron (CANONICAL)
 * ======================================================
 *
 * Runs daily.
 * Finds cancel_attempt events 7–10 days ago.
 * Sends 1 message with a signed link:
 * “If we rebuilt one thing so you’d come back, what would it be?”
 *
 * Guardrails:
 * - Never send twice (moment="post_churn_winback_sent")
 * - Private only (Stream C)
 *
 * Sends via canonical `sendSMS` (Messaging Service or fallback number). If Twilio is not
 * configured, we log `skipped_missing_twilio` for visibility.
 */

// Public base URL for link generation (required)
const APP_BASE_URL = process.env.APP_BASE_URL;

function daysAgoIso(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim();
  return t.length ? t : null;
}

function buildWinbackLink(clerk_user_id: string) {
  if (!APP_BASE_URL) {
    throw new Error("Missing APP_BASE_URL (used to build winback links)");
  }

  const token = createWinbackToken({ clerk_user_id, ttlDays: 21 });
  return `${APP_BASE_URL.replace(/\/$/, "")}/winback?t=${encodeURIComponent(
    token
  )}`;
}

export async function GET(req: Request) {
  if (!validateCronSecretRequest(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  // Window: 7–10 days after cancel
  const startIso = daysAgoIso(10);
  const endIso = daysAgoIso(7);

  // 1) Find cancel attempts in the window
  const { data: cancels, error: cancelErr } = await supabaseServer
    .from("feedback_events")
    .select("clerk_user_id, created_at")
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
    return NextResponse.json({ ok: true, sent: 0, reason: "none_in_window" });
  }

  let sentCount = 0;
  let skippedTwilio = 0;
  const errors: Array<{ clerk_user_id: string; error: string }> = [];

  for (const row of cancels) {
    const clerk_user_id = row.clerk_user_id;

    try {
      // 2) Never send twice
      const { data: alreadySent } = await supabaseServer
        .from("feedback_events")
        .select("id")
        .eq("clerk_user_id", clerk_user_id)
        .eq("moment", "post_churn_winback_sent")
        .limit(1);

      if (alreadySent && alreadySent.length > 0) continue;

      // 3) Build signed link (works even without Twilio)
      const link = buildWinbackLink(clerk_user_id);

      // 4) Pull phone from Clerk metadata (best-effort)
      const md = await getClerkPublicMetadata(clerk_user_id);

      const phone =
        normalizePhone(md?.phoneNumber) ||
        normalizePhone(md?.phone) ||
        normalizePhone(md?.smsNumber) ||
        normalizePhone(md?.mobile);

      if (!isTwilioReady()) {
        skippedTwilio += 1;

        await supabaseServer.from("feedback_events").insert({
          clerk_user_id,
          source: "sms",
          moment: "post_churn_winback_skipped",
          type: "churn",
          rating: null,
          sentiment: null,
          reason_code: "skipped_missing_twilio",
          message: link, // store link so you can email manually
          share_permission: false,
          metadata: { canonical: true, channel: "sms", link_included: true },
        });

        continue;
      }

      if (!phone) {
        await supabaseServer.from("feedback_events").insert({
          clerk_user_id,
          source: "sms",
          moment: "post_churn_winback_skipped",
          type: "churn",
          rating: null,
          sentiment: null,
          reason_code: "missing_phone",
          message: link, // still useful
          share_permission: false,
          metadata: { canonical: true, channel: "sms", link_included: true },
        });

        continue;
      }

      const smsBody =
        `One last question — if we rebuilt ONE thing so you’d come back, what would it be?\n` +
        `One sentence is enough.\n\n` +
        `${link}`;

      await sendSMS({
        to: phone,
        body: smsBody,
        lastOutbound: {
          clerkUserId: clerk_user_id,
          messageKind: "transactional",
        },
      });

      // 6) Log that we sent (Stream C)
      await supabaseServer.from("feedback_events").insert({
        clerk_user_id,
        source: "sms",
        moment: "post_churn_winback_sent",
        type: "churn",
        rating: null,
        sentiment: null,
        reason_code: "winback_prompt_sent",
        message: link,
        share_permission: false,
        metadata: {
          canonical: true,
          window: "7-10_days_post_cancel",
          channel: "sms",
          link_included: true,
        },
      });

      sentCount += 1;
    } catch (e: any) {
      errors.push({
        clerk_user_id,
        error: e?.message || "unknown_error",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    sent: sentCount,
    candidates: cancels.length,
    skippedTwilio,
    errors,
  });
}
