import { supabaseServer } from "./supabase-server";
import { getClerkPublicMetadata } from "./clerk-rest";

type SyncParams = {
  userId: string;
  phoneNumber?: string | null;
  smsEnabled?: boolean | null;
  stoppedAt?: string | null;
  timezone?: string | null;
  smsTimePreference?: string | null;
  summittSubscribed?: boolean | null;
};

function isTruthySubscribed(raw: unknown): boolean {
  return raw === true || raw === "true";
}

async function resolveSummittSubscribedFlag(
  userId: string,
  summittSubscribed: boolean | null | undefined
): Promise<boolean> {
  if (summittSubscribed === true || summittSubscribed === false) {
    return summittSubscribed;
  }
  try {
    const md = await getClerkPublicMetadata(userId);
    return isTruthySubscribed(md?.summittSubscribed);
  } catch (e) {
    console.error(
      "[syncSmsAudience] could not read Clerk for summittSubscribed",
      e
    );
    return false;
  }
}

/** E.164 or null; prefers explicit param, then sms_identities. */
async function resolveAudiencePhoneNumber(
  userId: string,
  explicit: string | null | undefined
): Promise<string | null> {
  const trimmed =
    typeof explicit === "string" && explicit.trim().length > 0
      ? explicit.trim()
      : null;
  if (trimmed) return trimmed;

  const { data, error } = await supabaseServer
    .from("sms_identities")
    .select("phone_number")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[syncSmsAudience] phone lookup failed", userId, error);
    return null;
  }

  const p = data?.phone_number;
  return typeof p === "string" && p.trim().length > 0 ? p.trim() : null;
}

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

  const resolvedSubscribed = await resolveSummittSubscribedFlag(
    userId,
    summittSubscribed
  );

  const resolvedPhone = await resolveAudiencePhoneNumber(userId, phoneNumber);

  if (!resolvedPhone) {
    const updatePayload: Record<string, unknown> = {
      summitt_subscribed: resolvedSubscribed,
    };
    if (smsEnabled != null) updatePayload.sms_enabled = smsEnabled;
    if (stoppedAt != null) updatePayload.stopped_at = stoppedAt;
    if (timezone != null) updatePayload.timezone = timezone;
    if (smsTimePreference != null)
      updatePayload.sms_time_preference = smsTimePreference;

    const { error } = await supabaseServer
      .from("sms_audience")
      .update(updatePayload)
      .eq("clerk_user_id", userId);

    if (error) {
      console.error("[syncSmsAudience]", error);
    }
    return;
  }

  const payload: Record<string, unknown> = {
    clerk_user_id: userId,
    phone_number: resolvedPhone,
    summitt_subscribed: resolvedSubscribed,
  };

  if (smsEnabled != null) payload.sms_enabled = smsEnabled;
  if (stoppedAt != null) payload.stopped_at = stoppedAt;
  if (timezone != null) payload.timezone = timezone;
  if (smsTimePreference != null)
    payload.sms_time_preference = smsTimePreference;

  const { error } = await supabaseServer
    .from("sms_audience")
    .upsert(payload, { onConflict: "clerk_user_id" });

  if (error) {
    console.error("[syncSmsAudience]", error);
  }
}
