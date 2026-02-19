// src/app/api/onboarding/sms/route.ts

import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { supabaseServer } from "@/lib/supabase-server";
import { sendSMS, isTwilioReady } from "@/lib/twilio";

type SmsTimePreference = "morning" | "afternoon" | "evening";

/**
 * Normalize to E.164
 * US-focused for now.
 */
function normalizeToE164(input: string): string | null {
  if (!input) return null;

  const digits = input.replace(/\D/g, "");

  // 10-digit US
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // 11-digit starting with 1
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  // Already includes +
  if (input.startsWith("+") && digits.length >= 11) {
    return `+${digits}`;
  }

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

    const allowed: SmsTimePreference[] = ["morning", "afternoon", "evening"];
    const smsTimePreference: SmsTimePreference = allowed.includes(
      body?.smsTimePreference
    )
      ? body.smsTimePreference
      : "morning";

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
        .update({
          sms_enabled: false,
        })
        .eq("phone_number", normalizedPhone);
    }

    // ---------------------------------------
    // OPTIONAL (RECOMMENDED): Confirmation SMS
    // ---------------------------------------
    if (smsEnabled && normalizedPhone && isTwilioReady()) {
      // NOTE TO FUTURE ME (ChatGPT):
      // This message is a big Twilio compliance win: brand + STOP/HELP.
      const confirm =
        "Summitt Mindset: You’re subscribed to daily training texts (membership coaching + practice reminders). Message frequency varies. Msg & data rates may apply. Reply STOP to opt out. Reply HELP for help.";

      try {
        await sendSMS({ to: normalizedPhone, body: confirm });
      } catch (e) {
        // We do NOT fail onboarding if confirmation send fails.
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
