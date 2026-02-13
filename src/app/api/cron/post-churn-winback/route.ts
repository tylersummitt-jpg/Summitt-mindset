import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { createWinbackToken } from "@/lib/winback-token";

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
 * Note: Twilio not required to ship this logic. If Twilio env is missing,
 * we still log "skipped_missing_twilio" for visibility.
 */

const CRON_SECRET = process.env.CRON_SECRET;

// Public base URL for link generation (required)
const APP_BASE_URL = process.env.APP_BASE_URL;

// Twilio (optional until live)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

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

async function sendSms(to: string, body: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error("Twilio env missing (TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM)");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const form = new URLSearchParams();
  form.set("From", TWILIO_FROM_NUMBER);
  form.set("To", to);
  form.set("Body", body);

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString(
    "base64"
  );

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio send failed: ${text}`);
  }
}

export async function GET(req: Request) {
  // ✅ Protect cron endpoint
  const secret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
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

      // If Twilio isn't configured yet, we still log a visible skip
      const twilioReady = Boolean(
        TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER
      );

      if (!twilioReady) {
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

      // 5) Send SMS
      await sendSms(phone, smsBody);

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
