import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { listClerkUsers } from "@/lib/clerk-rest";
import { createPulseToken } from "@/lib/pulse-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ======================================================
 * Day 4–5 SMS Pulse Cron (CANONICAL)
 * ======================================================
 *
 * Once total.
 * Trigger: user is on Day 4 or Day 5 (currentDay in Clerk).
 * Message: “Reply with ONE word for how this is fitting into your day.”
 *
 * Twilio not ready:
 * - We do NOT send
 * - We log a single "skipped_twilio_not_ready" row with the link
 * - This enables end-to-end testing now
 */

const CRON_SECRET = process.env.CRON_SECRET;
const APP_BASE_URL = process.env.APP_BASE_URL;

function buildPulseLink(clerk_user_id: string, day_number: number) {
  if (!APP_BASE_URL) throw new Error("Missing APP_BASE_URL");

  const token = createPulseToken({ clerk_user_id, day_number, ttlDays: 14 });

  // ✅ IMPORTANT: route is /sms/pulse (not /pulse)
  return `${APP_BASE_URL.replace(/\/$/, "")}/sms/pulse?t=${encodeURIComponent(
    token
  )}`;
}

export async function GET(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json(
      { ok: false, reason: "unauthorized" },
      { status: 401 }
    );
  }

  const pageLimit = 200;
  let offset = 0;

  let candidates = 0;
  let logged = 0;
  const errors: Array<{ clerk_user_id: string; error: string }> = [];

  while (true) {
    const users = await listClerkUsers({ limit: pageLimit, offset });
    if (!users || users.length === 0) break;

    for (const u of users) {
      const clerk_user_id = u.id;
      const md = u.public_metadata || {};

      try {
        // Only subscribed users
        if (md.summittSubscribed !== true) continue;

        // SMS enabled
        if (md.smsEnabled !== true) continue;

        // Only Day 4 or Day 5
        const currentDay =
          typeof md.currentDay === "number" && md.currentDay > 0
            ? md.currentDay
            : null;

        if (currentDay !== 4 && currentDay !== 5) continue;

        candidates += 1;

        // Once total guard: if we already logged *anything* for this pulse, skip.
        const { data: existing } = await supabaseServer
          .from("feedback_events")
          .select("id")
          .eq("clerk_user_id", clerk_user_id)
          .in("moment", [
            "day4_5_sms_pulse_sent",
            "day4_5_sms_pulse_skipped",
            "day4_5_sms_pulse_reply",
          ])
          .limit(1);

        if (existing && existing.length > 0) continue;

        const link = buildPulseLink(clerk_user_id, currentDay);

        // Twilio not ready → log one “skipped” row (still gives us a testable link)
        await supabaseServer.from("feedback_events").insert({
          clerk_user_id,
          source: "sms",
          moment: "day4_5_sms_pulse_skipped",
          type: "friction",
          day_number: currentDay,
          rating: null,
          sentiment: null,
          reason_code: "skipped_twilio_not_ready",
          message: link,
          share_permission: false,
          metadata: {
            canonical: true,
            intended_copy:
              "Reply with ONE word for how this is fitting into your day.",
          },
        });

        logged += 1;
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
    logged,
    note:
      "Twilio not ready: logged day4_5_sms_pulse_skipped once per eligible user with a secure /sms/pulse link in message.",
    errors,
  });
}
