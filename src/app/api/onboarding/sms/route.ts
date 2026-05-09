// src/app/api/onboarding/sms/route.ts

import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import { loadOrCreateSmsDeliveryState } from "@/lib/sms-daily-delivery-body";
import { sendSMS, isTwilioReady } from "@/lib/twilio";

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
 * - smsTimePreference: early_morning | morning | midday | evening (default: morning)
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

    const publicMd = await getClerkPublicMetadata(userId);
    if (publicMd?.onboardingCompleted === true) {
      return new Response(JSON.stringify({ error: "Onboarding already completed." }), {
        status: 403,
      });
    }

    const { data: commitmentGate } = await supabaseServer
      .from("v2_commitment")
      .select("id")
      .eq("clerk_user_id", userId)
      .in("status", ["proposed", "active"])
      .limit(1)
      .maybeSingle();

    if (!commitmentGate?.id) {
      return new Response(
        JSON.stringify({ error: "Save your commitment before SMS setup." }),
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const smsEnabled = body?.smsEnabled === true;

    /** Onboarding no longer asks for send time; legacy cron expects a preference bucket. */
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
      smsTimePreference,
      phoneNumber: normalizedPhone,
      smsDisclosureAccepted: smsEnabled ? true : false,
      smsStopHelpDisclosureShownAt: new Date().toISOString(),
    });

    try {
      const stateRes = await loadOrCreateSmsDeliveryState(userId);
      if (stateRes.error) {
        console.error("[onboarding/sms] sms_delivery_state init failed", {
          userId,
          error: stateRes.error,
        });
      }
    } catch (e) {
      console.error("[onboarding/sms] sms_delivery_state init threw", userId, e);
    }

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
    if (!smsEnabled && !normalizedPhone) {
      await supabaseServer
        .from("sms_identities")
        .update({ sms_enabled: false })
        .eq("clerk_user_id", userId);
    }

    // ---------------------------------------
    // Confirmation SMS (Identity + Compliance)
    // ---------------------------------------
    if (smsEnabled && normalizedPhone && isTwilioReady()) {
      /**
       * IMPORTANT:
       * - Must include STOP + HELP language
       * - Must include frequency disclosure
       * - Align with SMS-first commitment accountability (not progression / “daily practice” core)
       * - Avoid promising outcomes or guarantees
       *
       * Intentionally bypasses finalizeNorthStarCoachSms: this is mandatory consent / frequency /
       * STOP / HELP transactional onboarding copy, not discretionary coaching SMS.
       */

      const confirm =
        "Summitt Mindset: You’re in. Pat will text you about one commitment you name—reply honestly to those check-ins.\n\n" +
        "Use the app for depth, identity context, and your Victory Room when you want proof.\n\n" +
        "Message frequency varies. Msg & data rates may apply. Reply STOP to opt out. Reply HELP for help.";

      try {
        await sendSMS({
          to: normalizedPhone,
          body: confirm,
          lastOutbound: {
            clerkUserId: userId,
            messageKind: "transactional",
            timeOfDay: "morning",
          },
        });
      } catch (e) {
        // Never block onboarding if Twilio fails.
        console.error("Onboarding confirmation SMS failed:", e);
      }
    }

    let phoneForSync = normalizedPhone;
    if (!smsEnabled && !normalizedPhone) {
      const existing = await getClerkPublicMetadata(userId);
      let existingPhone = existing?.phoneNumber ?? null;
      if (!existingPhone) {
        const { data: identity } = await supabaseServer
          .from("sms_identities")
          .select("phone_number")
          .eq("clerk_user_id", userId)
          .maybeSingle();
        existingPhone = identity?.phone_number ?? null;
      }
      phoneForSync = existingPhone;
    }

    await syncSmsAudience({
      userId: userId,
      phoneNumber: phoneForSync,
      smsEnabled: smsEnabled,
      stoppedAt: null,
      timezone: null,
      smsTimePreference: smsTimePreference,
      summittSubscribed: null
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("ONBOARDING SMS ERROR:", err);

    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
    });
  }
}