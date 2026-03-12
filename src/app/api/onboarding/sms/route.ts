// src/app/api/onboarding/sms/route.ts

import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { supabaseServer } from "@/lib/supabase-server";
import { sendSMSChunked, isTwilioReady } from "@/lib/twilio";

/**
 * ======================================================
 * POST /api/onboarding/sms (CANONICAL)
 * ======================================================
 *
 * PURPOSE:
 * - Capture SMS consent
 * - Normalize + store phone
 * - Sync sms_identities (Supabase)
 * - Send ONE onboarding confirmation text (compliance required)
 *
 * NON-NEGOTIABLES:
 * - smsTimePreference is hard-locked to "morning"
 * - Confirmation SMS must include STOP + HELP language
 * - Never fail onboarding if SMS send fails
 *
 * TONE STRATEGY (March 2026):
 * - Legal compliance retained
 * - Identity-based momentum added ("You're in. Coach Pat...")
 * - Avoid guaranteed outcome claims
 * - Avoid hype language that could trigger A2P filtering
 */

/**
 * Normalize to E.164 (US-focused for now).
 */
function normalizeToE164(input: string): string | null {
  if (!input) return null;

  const digits = input.replace(/\D/g, "");

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (input.startsWith("+") && digits.length >= 11) return `+${digits}`;

  return null;
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const body = await req.json().catch(() => ({}));
    const smsEnabled = body?.smsEnabled === true;

    // ✅ HARD LOCK: Morning only (8AM local)
    const smsTimePreference = "morning" as const;

    if (smsEnabled && body?.smsDisclosureAccepted !== true) {
      return new Response(JSON.stringify({ error: "Consent required." }), {
        status: 400,
      });
    }

    let normalizedPhone: string | null = null;

    if (smsEnabled) {
      normalizedPhone = normalizeToE164(body?.phoneNumber || "");

      if (!normalizedPhone) {
        return new Response(JSON.stringify({ error: "Invalid phone number." }), {
          status: 400,
        });
      }

      // Prevent one phone being attached to two users
      const { data: existing } = await supabaseServer
        .from("sms_identities")
        .select("clerk_user_id")
        .eq("phone_number", normalizedPhone)
        .maybeSingle();

      if (existing && existing.clerk_user_id !== userId) {
        return new Response(
          JSON.stringify({ error: "Phone number already in use." }),
          { status: 400 }
        );
      }
    }

    // ---------------------------------------
    // Update Clerk metadata (source of truth)
    // ---------------------------------------
    await updateClerkPublicMetadata(userId, {
      smsEnabled,
      smsTimePreference, // always "morning"
      phoneNumber: normalizedPhone,
      smsDisclosureAccepted: smsEnabled ? true : false,
      smsStopHelpDisclosureShownAt: new Date().toISOString(),
    });

    // ---------------------------------------
    // Sync Supabase sms_identities
    // ---------------------------------------
    if (smsEnabled && normalizedPhone) {
      await supabaseServer.from("sms_identities").upsert({
        phone_number: normalizedPhone,
        clerk_user_id: userId,
        sms_enabled: true,
        stopped_at: null,
      });
    }

    if (!smsEnabled && normalizedPhone) {
      await supabaseServer
        .from("sms_identities")
        .update({ sms_enabled: false })
        .eq("phone_number", normalizedPhone);
    }

    // ---------------------------------------
    // Confirmation SMS (Identity + Compliance)
    // ---------------------------------------
    if (smsEnabled && normalizedPhone && isTwilioReady()) {
      /**
       * IMPORTANT:
       * - Must include STOP + HELP language
       * - Must include frequency disclosure
       * - Use "around 8:00 AM" for safety buffer (Twilio delays, cron drift, etc.)
       * - Avoid promising outcomes or guarantees
       */

      const confirm =
        "Summitt Mindset: You’re in. Coach Pat Summitt is now your daily life coach.\n\n" +
        "Expect a short note and one focused practice every morning around 8:00 AM local time. Show up consistently — and watch what changes.\n\n" +
        "Message frequency varies. Msg & data rates may apply. Reply STOP to opt out. Reply HELP for help.";

      try {
        await sendSMSChunked({ to: normalizedPhone, body: confirm });
      } catch (e) {
        // Never block onboarding if Twilio fails.
        console.error("Onboarding confirmation SMS failed:", e);
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("ONBOARDING SMS ERROR:", err);

    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
    });
  }
}