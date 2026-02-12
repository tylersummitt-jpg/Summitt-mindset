import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { resolveUserTimezone } from "@/lib/timezone";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";

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

function safeSmsTimePreference(raw: unknown): "morning" | "afternoon" | "evening" | null {
  if (raw === "morning" || raw === "afternoon" || raw === "evening") return raw;
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
    const existingSmsEnabled = safeSmsEnabled(existing?.smsEnabled);
    const existingSmsTimePreference = safeSmsTimePreference(existing?.smsTimePreference);

    // ======================================================
    // ✅ Onboarding completion = habit begins
    // ======================================================
    await updateClerkPublicMetadata(userId, {
      onboardingCompleted: true,

      // progression: server decides
      currentDay: existingCurrentDay ?? 1,

      // timezone: always store sanitized/valid
      timezone,

      /**
       * SMS defaults:
       * - Only apply if missing, never overwrite a prior explicit choice.
       */
      ...(existingSmsEnabled === null ? { smsEnabled: true } : {}),
      ...(existingSmsTimePreference === null ? { smsTimePreference: "morning" } : {}),
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("ONBOARDING COMPLETE ERROR:", err);

    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
    });
  }
}
