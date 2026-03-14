import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { listClerkUsers } from "@/lib/clerk-rest";
import { createRescueToken } from "@/lib/rescue-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ======================================================
 * Inactivity Rescue Cron (CANONICAL)
 * ======================================================
 *
 * Trigger: 3 days no completion
 * Outreach: “Want a smaller version tomorrow?”
 *
 * Guardrails:
 * - never send twice (moment="inactivity_rescue_sent")
 * - calm + optional link to activate micro-practice mode
 *
 * Twilio not required yet:
 * - if Twilio not configured, we log skip with the link
 */

const CRON_SECRET = process.env.CRON_SECRET;
const APP_BASE_URL = process.env.APP_BASE_URL;

// Twilio (optional until live)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

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

async function sendSms(_to: string, _body: string) {
  // We intentionally do not implement Twilio send here yet
  // because you said Twilio isn’t ready. This will be enabled later.
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error("Twilio env missing");
  }
  // When Twilio is ready, we’ll drop in the same sendSms function you used elsewhere.
}

export async function GET(req: Request) {
  // ✅ Protect cron endpoint
  const secret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  // Scan users in pages
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
        // Only consider active subscribers (best-effort)
        if (md.summittSubscribed !== true) continue;

        // SMS must be enabled (same as daily-sms)
        if (md.smsEnabled !== true) continue;

        // Need lastCompletedAt to evaluate inactivity
        if (typeof md.lastCompletedAt !== "string") continue;

        const inactiveDays = daysSince(md.lastCompletedAt);

        // Trigger: 3+ full days since last completion
        if (inactiveDays < 3) continue;

        candidates += 1;

        // Never send twice (or repeatedly spam)
        const { data: alreadySent } = await supabaseServer
          .from("feedback_events")
          .select("id")
          .eq("clerk_user_id", clerk_user_id)
          .eq("moment", "inactivity_rescue_sent")
          .limit(1);

        if (alreadySent && alreadySent.length > 0) continue;

        // Identity record (canonical opt-out) — same pattern as daily-sms
        const { data: identity } = await supabaseServer
          .from("sms_identities")
          .select("phone_number, sms_enabled, stopped_at")
          .eq("clerk_user_id", clerk_user_id)
          .maybeSingle();

        if (!identity?.phone_number) continue;
        if (identity.sms_enabled !== true) continue;
        if (typeof identity.stopped_at === "string") continue;

        const link = buildRescueLink(clerk_user_id);

        const twilioReady = Boolean(
          TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER
        );

        if (!twilioReady) {
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

        // When Twilio is ready we’ll send:
        // "Want a smaller version tomorrow? Tap yes: <link>"
        const body =
          `Quick check-in — want a smaller version tomorrow?\n\n` +
          `Tap here: ${link}`;

        await sendSms(identity.phone_number, body);

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
          },
        });

        queued += 1;
      } catch (e: any) {
        errors.push({ clerk_user_id, error: e?.message || "unknown_error" });
      }
    }

    offset += users.length;
    if (users.length < pageLimit) break;
  }

  return NextResponse.json({
    ok: true,
    scannedOffset: offset,
    candidates,
    queued,
    skippedTwilio,
    errors,
  });
}
