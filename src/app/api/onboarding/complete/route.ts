import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import { resolveUserTimezone } from "@/lib/timezone";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * ======================================================
 * POST /api/onboarding/complete (CANONICAL)
 * ======================================================
 *
 * Non-negotiables:
 * - Client can provide timezone (sanitized)
 * - Client can NOT set progression (currentDay)
 * - Onboarding completion must be idempotent
 *
 * Rules:
 * - If user already has a valid currentDay, we keep it.
 * - If user has no currentDay, we set it to 1.
 *
 * CRITICAL FIX:
 * - DO NOT overwrite SMS settings chosen earlier in onboarding.
 *   (smsEnabled / smsTimePreference / consent flags)
 */

function safeDayNumber(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.floor(n);
}

function safeSmsEnabled(raw: unknown): boolean | null {
  if (raw === true) return true;
  if (raw === false) return false;
  return null;
}

function safeSmsTimePreference(
  raw: unknown
):
  | "early_morning"
  | "morning"
  | "midday"
  | "evening"
  | "afternoon"
  | null {
  if (
    raw === "early_morning" ||
    raw === "morning" ||
    raw === "midday" ||
    raw === "evening" ||
    raw === "afternoon" // legacy
  )
    return raw;
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

    // Allow timezone from client, but sanitize it (and validate)
    const timezone = resolveUserTimezone(body?.timezone);

    // ======================================================
    // 🔑 Read existing metadata (fresh, canonical)
    // ======================================================
    const existing = await getClerkPublicMetadata(userId);

    const existingCurrentDay = safeDayNumber(existing?.currentDay);

    // Preserve any prior SMS choices (set during /onboarding/sms)
    const existingSmsTimePreference = safeSmsTimePreference(existing?.smsTimePreference);

    // Only set smsEnabled: true if user completed SMS step (phone + consent).
    // Prevents fake SMS-enabled users who skipped /onboarding/sms.
    const hasValidSmsConsent =
      existing?.smsEnabled === true &&
      typeof existing?.phoneNumber === "string" &&
      existing.phoneNumber.trim().length > 0 &&
      existing?.smsDisclosureAccepted === true;

    if (existing?.onboardingCompleted === true) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // V2: activate proposed commitment BEFORE Clerk completion (avoid onboarded-without-active)
    const { data: proposed } = await supabaseServer
      .from("v2_commitment")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (proposed?.id) {
      const nowIso = new Date().toISOString();
      const { error: actErr } = await supabaseServer
        .from("v2_commitment")
        .update({
          status: "active",
          started_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", proposed.id)
        .eq("status", "proposed");

      if (actErr) {
        console.error("[onboarding/complete] v2_commitment activate failed", actErr);
        return new Response(JSON.stringify({ error: "Failed to activate commitment" }), {
          status: 500,
        });
      }

      const { error: evErr } = await supabaseServer.from("v2_commitment_event").insert({
        commitment_id: proposed.id,
        clerk_user_id: userId,
        event_type: "activated",
        source: "onboarding_v2",
        payload_json: {},
        idempotency_key: `onboarding_activated:${proposed.id}`,
      });

      if (evErr) {
        const code = (evErr as { code?: string }).code;
        if (code !== "23505") {
          console.error("[onboarding/complete] v2_commitment_event activated failed", evErr);
          return new Response(JSON.stringify({ error: "Failed to record activation event" }), {
            status: 500,
          });
        }
      }
    } else {
      const { data: alreadyActive } = await supabaseServer
        .from("v2_commitment")
        .select("id")
        .eq("clerk_user_id", userId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (!alreadyActive?.id) {
        return new Response(
          JSON.stringify({ error: "Commitment must be saved before completing onboarding." }),
          { status: 400 }
        );
      }
    }

    // ======================================================
    // ✅ Onboarding completion = habit begins
    // ======================================================
    await updateClerkPublicMetadata(
      userId,
      {
        onboardingCompleted: true,

        // progression: server decides (Layer A structural truth; SMS sequencing is sms_delivery_state only)
        currentDay: existingCurrentDay ?? 1,

        // timezone: always store sanitized/valid
        timezone,

        smsEnabled: hasValidSmsConsent,

        /**
         * SMS time preference: only apply default if missing.
         */
        ...(existingSmsTimePreference === null ? { smsTimePreference: "morning" } : {}),
      },
      ["deliveryDay", "deliveryDayLastCronKey"]
    );

    await syncSmsAudience({
      userId: userId,
      phoneNumber: existing?.phoneNumber ?? null,
      smsEnabled: hasValidSmsConsent,
      stoppedAt: null,
      timezone: timezone,
      smsTimePreference: existingSmsTimePreference ?? "morning",
      summittSubscribed: null
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("ONBOARDING COMPLETE ERROR:", err);

    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
    });
  }
}
