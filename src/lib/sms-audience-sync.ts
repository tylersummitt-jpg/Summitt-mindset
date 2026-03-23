import { supabaseServer } from "./supabase-server";

type SyncParams = {
  userId: string;
  phoneNumber?: string | null;
  smsEnabled?: boolean | null;
  stoppedAt?: string | null;
  timezone?: string | null;
  smsTimePreference?: string | null;
  summittSubscribed?: boolean | null;
};

export async function syncSmsAudience(params: SyncParams): Promise<void> {
  const {
    userId,
    phoneNumber,
    smsEnabled,
    stoppedAt,
    timezone,
    smsTimePreference,
    summittSubscribed,
  } = params;

  // 🚨 CRITICAL: cannot insert without phone_number
  if (!phoneNumber) {
    return;
  }

  const payload: Record<string, unknown> = {
    clerk_user_id: userId,
    phone_number: phoneNumber,
  };

  if (smsEnabled != null) payload.sms_enabled = smsEnabled;
  if (stoppedAt != null) payload.stopped_at = stoppedAt;
  if (timezone != null) payload.timezone = timezone;
  if (smsTimePreference != null) payload.sms_time_preference = smsTimePreference;
  if (summittSubscribed != null) payload.summitt_subscribed = summittSubscribed;

  const { error } = await supabaseServer
    .from("sms_audience")
    .upsert(payload, { onConflict: "clerk_user_id" });

  if (error) {
    console.error("[syncSmsAudience]", error);
  }
}
