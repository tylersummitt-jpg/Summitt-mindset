import "server-only";

import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * The only permanent SMS stop writes.
 * Exact keyword STOP and Tyler "STOP TEXTS" both call this.
 */
export async function applyCanonicalSmsStop(args: {
  userId: string;
  phoneNumber: string;
}): Promise<void> {
  const userId = args.userId.trim();
  const phoneNumber = args.phoneNumber.trim();
  if (!userId || !phoneNumber) {
    throw new Error("canonical_stop_missing_target");
  }

  await supabaseServer
    .from("sms_identities")
    .update({
      sms_enabled: false,
      stopped_at: new Date().toISOString(),
    })
    .eq("phone_number", phoneNumber);

  await updateClerkPublicMetadata(userId, {
    smsEnabled: false,
    smsStoppedAt: new Date().toISOString(),
  });

  await syncSmsAudience({
    userId,
    phoneNumber,
    smsEnabled: false,
    stoppedAt: new Date().toISOString(),
    timezone: null,
    smsTimePreference: null,
    summittSubscribed: null,
  });
}
