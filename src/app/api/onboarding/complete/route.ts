import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import { resolveUserTimezone } from "@/lib/timezone";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { hasValidSmsConsent } from "@/lib/onboarding-sms-consent";
import { runSobCompleteOnboardingActivation } from "@/lib/onboarding-complete-activation";

function safeDayNumber(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.floor(n);
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
    raw === "afternoon"
  )
    return raw;
  return null;
}

async function healSmsAudience(
  userId: string,
  existing: Record<string, unknown>,
  timezone: string
): Promise<{ ok: true } | { ok: false }> {
  const existingSmsTimePreference = safeSmsTimePreference(existing?.smsTimePreference);
  const hasValidSms = hasValidSmsConsent(existing);

  try {
    await syncSmsAudience({
      userId,
      phoneNumber: (existing?.phoneNumber as string) ?? null,
      smsEnabled: hasValidSms,
      timezone,
      smsTimePreference: existingSmsTimePreference ?? "morning",
      summittSubscribed: null,
    });
    return { ok: true };
  } catch (err) {
    console.error("[onboarding/complete] sms_audience heal failed", err);
    return { ok: false };
  }
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
    const timezone = resolveUserTimezone(body?.timezone);
    const existing = await getClerkPublicMetadata(userId);
    const existingCurrentDay = safeDayNumber(existing?.currentDay);
    const existingSmsTimePreference = safeSmsTimePreference(existing?.smsTimePreference);
    const hasValidSms = hasValidSmsConsent(existing);

    if (existing?.onboardingCompleted === true) {
      const heal = await healSmsAudience(userId, existing, timezone);
      if (!heal.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to sync SMS audience. Please try again." }),
          { status: 500 }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (!hasValidSms) {
      return new Response(
        JSON.stringify({
          error: "SMS consent is required before finishing onboarding.",
        }),
        { status: 400 }
      );
    }

    const activation = await runSobCompleteOnboardingActivation(userId);
    if (!activation.ok) {
      const status =
        activation.code === "conflict"
          ? 409
          : activation.code === "no_commitment" || activation.code === "no_identity"
            ? 400
            : 500;
      return new Response(JSON.stringify({ error: activation.message }), { status });
    }

    await updateClerkPublicMetadata(
      userId,
      {
        onboardingCompleted: true,
        currentDay: existingCurrentDay ?? 1,
        timezone,
        smsEnabled: hasValidSms,
        ...(existingSmsTimePreference === null ? { smsTimePreference: "morning" } : {}),
      },
      ["deliveryDay", "deliveryDayLastCronKey"]
    );

    const audience = await healSmsAudience(userId, existing, timezone);
    if (!audience.ok) {
      return new Response(
        JSON.stringify({
          error: "Onboarding activated but SMS audience sync failed. Please try again.",
        }),
        { status: 500 }
      );
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("ONBOARDING COMPLETE ERROR:", err);

    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
    });
  }
}
