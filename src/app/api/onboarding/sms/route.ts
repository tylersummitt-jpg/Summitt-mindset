// src/app/api/onboarding/sms/route.ts

import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import { loadOrCreateSmsDeliveryState } from "@/lib/sms-daily-delivery-body";
import {
  onboardingTransactionalConsentLatchFields,
  phoneE164Last4,
  shouldSkipOnboardingTransactionalConsentSms,
} from "@/lib/onboarding-sms-consent";
import { sendSMS, isTwilioReady } from "@/lib/twilio";

/** Phase 4.7 — persisted on `sms_last_outbound_context.delivery_snapshot` for hammer/audit (transactional exception; not relationship voice). */
function buildOnboardingTransactionalSmsDeliverySnapshot(): Record<string, unknown> {
  return {
    relationship_lane_bypass_kind: "onboarding_consent_transactional",
    relationship_lane_policy: "transactional_onboarding_consent_sms_bypasses_v3_relationship_voice",
    transactional_sms: true,
    message_kind: "transactional",
    old_outbound_writer_used_as_voice: false,
    v3_relationship_voice_used: false,
    north_star_used: false,
    final_voice_gate_used: false,
    consent_disclosure_accepted: true,
    stop_help_language_included: true,
    frequency_language_included: true,
    twilio_send_attempted: true,
  };
}

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
 * TRANSACTIONAL SMS (Phase 4.7): deterministic consent copy only — intentionally bypasses V3,
 * North Star, and Final Voice Gate. Same user + same normalized E.164 duplicate sends are
 * latched in Clerk (`onboardingTransactionalConsentSmsSentAt` / Phone) for 24h after a
 * successful sendSMS. Different phone and Twilio failure retries are allowed.
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

    const { data: proposed } = await supabaseServer
      .from("v2_commitment")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: active } = await supabaseServer
      .from("v2_commitment")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!proposed?.id && !active?.id) {
      return new Response(
        JSON.stringify({ error: "Save your commitment before SMS setup." }),
        { status: 400 }
      );
    }

    if (proposed?.id && !active?.id) {
      const { data: intake } = await supabaseServer
        .from("v2_commitment_intake")
        .select("commitment_id, review_acknowledged_at")
        .eq("commitment_id", proposed.id)
        .eq("clerk_user_id", userId)
        .maybeSingle();

      if (!intake?.commitment_id) {
        return new Response(
          JSON.stringify({
            error: "Goal intake is missing. Please save your current goal again.",
          }),
          { status: 400 }
        );
      }

      const reviewAcknowledged =
        intake.review_acknowledged_at != null &&
        String(intake.review_acknowledged_at).trim().length > 0;

      if (!reviewAcknowledged) {
        return new Response(
          JSON.stringify({
            error:
              "Please review your Identity and Current Goal before connecting SMS.",
          }),
          { status: 400 }
        );
      }
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
    let onboardingConsentSmsDeduped = false;

    if (smsEnabled && normalizedPhone && isTwilioReady()) {
      /**
       * IMPORTANT:
       * - Must include STOP + HELP language
       * - Must include frequency disclosure
       * - Align with SMS-first commitment accountability (not progression / “daily practice” core)
       * - Avoid promising outcomes or guarantees
       *
       * Intentionally bypasses V3 SMS Brain and the North Star SMS finalizer: mandatory consent,
       * frequency, STOP / HELP transactional onboarding copy — not discretionary coaching SMS.
       */

      const dedupe = shouldSkipOnboardingTransactionalConsentSms({
        clerkMetadata: publicMd,
        normalizedPhoneE164: normalizedPhone,
      });

      if (dedupe.skip) {
        onboardingConsentSmsDeduped = true;
        console.info("[onboarding/sms] onboarding_consent_sms_deduped", {
          clerk_user_id: userId,
          reason: dedupe.reason ?? "same_phone_within_latch_window",
          prior_sent_at: dedupe.priorSentAt ?? null,
          phone_last4: phoneE164Last4(normalizedPhone),
        });
      } else {
        const confirm =
          "So awesome to meet you!\n\n" +
          "I will text you about your current goal — all you have to do is reply honestly to the check-ins.\n\n" +
          "Message frequency varies. Msg & data rates may apply. Reply STOP to opt out. Reply HELP for help.\n\n" +
          "Summitt Mindset";

        try {
          const twilioMessage = await sendSMS({
            to: normalizedPhone,
            body: confirm,
            lastOutbound: {
              clerkUserId: userId,
              messageKind: "transactional",
              timeOfDay: "morning",
              deliverySnapshot: buildOnboardingTransactionalSmsDeliverySnapshot(),
            },
          });

          await updateClerkPublicMetadata(
            userId,
            onboardingTransactionalConsentLatchFields(normalizedPhone)
          );

          console.info("[onboarding/sms] onboarding_consent_sms_sent", {
            clerk_user_id: userId,
            phone_last4: phoneE164Last4(normalizedPhone),
            message_sid:
              twilioMessage && typeof twilioMessage.sid === "string"
                ? twilioMessage.sid
                : null,
          });
        } catch (e) {
          // Never block onboarding if Twilio fails; do not latch so retry can send again.
          console.warn("[onboarding/sms] transactional_confirmation_send_failed", {
            transactional_sms: true,
            twilio_send_attempted: true,
            relationship_lane_bypass_kind: "onboarding_consent_transactional",
            error: e instanceof Error ? e.message : String(e),
          });
          console.error("Onboarding confirmation SMS failed:", e);
        }
      }
    } else if (smsEnabled && normalizedPhone && !isTwilioReady()) {
      console.info("[onboarding/sms] transactional_confirmation_skipped_twilio_not_ready", {
        transactional_sms: true,
        twilio_send_attempted: false,
        relationship_lane_bypass_kind: "onboarding_consent_transactional",
      });
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
      timezone: null,
      smsTimePreference: smsTimePreference,
      summittSubscribed: null
    });

    return new Response(
      JSON.stringify({
        ok: true,
        ...(onboardingConsentSmsDeduped ? { onboardingConsentSmsDeduped: true } : {}),
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("ONBOARDING SMS ERROR:", err);

    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
    });
  }
}