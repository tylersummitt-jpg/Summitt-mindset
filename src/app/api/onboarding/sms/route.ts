// src/app/api/onboarding/sms/route.ts

import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import {
  ACCOUNT_DELETION_IN_PROGRESS_BODY,
  evaluateOutboundSmsForAccountDeletion,
  hasUnresolvedAccountDeletionRequest,
  isAccountDeletionOutboundSmsError,
} from "@/lib/account-deletion/deletion-guards";
import { loadOrCreateSmsDeliveryState } from "@/lib/sms-daily-delivery-body";

/**
 * ======================================================
 * POST /api/onboarding/sms (CANONICAL)
 * ======================================================
 *
 * PURPOSE:
 * - Capture SMS consent
 * - Normalize + store phone
 * - Sync sms_identities (Supabase)
 * - Initialize sms_delivery_state
 * - Sync sms_audience so scheduled Morning/Evening/Weekly texts can send
 *
 * This route does not send an onboarding confirmation or welcome SMS.
 * The first outbound is a scheduled Coach Pat TTO (or another existing outbound path).
 *
 * NON-NEGOTIABLES:
 * - smsTimePreference: early_morning | morning | midday | evening (default: morning)
 * - Consent is stored in Clerk from the on-screen disclosure; this route does not emit SMS
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

    if (await hasUnresolvedAccountDeletionRequest(userId)) {
      return new Response(
        JSON.stringify({ error: "Account deletion in progress." }),
        { status: 409 }
      );
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

    // APP-041B2b: second check after identity/phone work.
    // Previously ran immediately before the onboarding confirmation send.
    // Send is removed; this check remains so deletion safety is not weakened.
    if (smsEnabled && normalizedPhone) {
      try {
        const postIdentityDeletion = await evaluateOutboundSmsForAccountDeletion(
          userId
        );
        if (postIdentityDeletion.decision === "blocked_due_to_deletion") {
          return new Response(
            JSON.stringify(ACCOUNT_DELETION_IN_PROGRESS_BODY),
            { status: 409 }
          );
        }
        if (
          postIdentityDeletion.decision === "lookup_failed" ||
          postIdentityDeletion.decision === "missing_clerk_user_id"
        ) {
          // Neutral retryable server error — do not claim deletion is in progress.
          return new Response(
            JSON.stringify({
              error: "sms_temporarily_unavailable",
              message: "Please try again.",
            }),
            { status: 500 }
          );
        }
      } catch (e) {
        if (isAccountDeletionOutboundSmsError(e)) {
          if (e.outcome === "blocked_due_to_deletion") {
            return new Response(
              JSON.stringify(ACCOUNT_DELETION_IN_PROGRESS_BODY),
              { status: 409 }
            );
          }
          return new Response(
            JSON.stringify({
              error: "sms_temporarily_unavailable",
              message: "Please try again.",
            }),
            { status: 500 }
          );
        }
        throw e;
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
