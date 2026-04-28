/**
 * SMS delivery state bootstrap + Clerk SMS time preference helpers.
 *
 * Layer B curriculum / daily outbound body builders were removed in cutover PR7; V2-only SMS
 * does not use `buildSmsBodyFromDeliveryState`. Onboarding still initializes `sms_delivery_state`
 * for users who may have legacy rows in the DB (`loadOrCreateSmsDeliveryState`).
 */
import { supabaseServer } from "@/lib/supabase-server";

function normalizeDeliveryStateRow(row: Record<string, unknown>): SmsDeliveryStateRow {
  const bucketRaw = row.sms_bucket;
  const bucket: "daily" | "flex" =
    bucketRaw === "flex" ? "flex" : "daily";
  const cycle =
    typeof row.daily_nonresponse_cycle_count === "number" &&
    Number.isFinite(row.daily_nonresponse_cycle_count)
      ? Math.max(0, Math.floor(row.daily_nonresponse_cycle_count))
      : 0;

  const fi = row.flex_cadence_index;
  const flexCadenceIndex =
    typeof fi === "number" && Number.isFinite(fi)
      ? Math.max(0, Math.floor(fi)) % 7
      : 0;

  const d2 = row.day2_special_sent_at;
  const day2SpecialSentAt =
    typeof d2 === "string" && d2.trim().length > 0 ? d2.trim() : null;

  return {
    clerk_user_id: String(row.clerk_user_id ?? ""),
    question_position:
      typeof row.question_position === "number"
        ? row.question_position
        : 1,
    quote_position:
      typeof row.quote_position === "number" ? row.quote_position : 0,
    current_content_type:
      row.current_content_type === "non_response" ? "non_response" : "respond",
    question_attempt_count:
      typeof row.question_attempt_count === "number"
        ? row.question_attempt_count
        : 0,
    daily_nonresponse_cycle_count: cycle,
    sms_bucket: bucket,
    flex_cadence_index: flexCadenceIndex,
    day2_special_sent_at: day2SpecialSentAt,
  };
}

export type SmsDeliveryStateRow = {
  clerk_user_id: string;
  question_position: number;
  quote_position: number;
  current_content_type: "respond" | "non_response";
  question_attempt_count: number;
  daily_nonresponse_cycle_count: number;
  sms_bucket: "daily" | "flex";
  flex_cadence_index: number;
  day2_special_sent_at: string | null;
};

const SMS_DELIVERY_STATE_SELECT =
  "clerk_user_id, question_position, quote_position, current_content_type, question_attempt_count, daily_nonresponse_cycle_count, sms_bucket, flex_cadence_index, day2_special_sent_at";

function buildSanityPatch(row: Record<string, unknown>): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const ct = row.current_content_type;
  if (ct !== "respond" && ct !== "non_response") {
    patch.current_content_type = "respond";
  }
  const sb = row.sms_bucket;
  if (sb !== "daily" && sb !== "flex") {
    patch.sms_bucket = "daily";
  }
  const qa = row.question_attempt_count;
  if (typeof qa !== "number" || !Number.isFinite(qa) || qa < 0) {
    patch.question_attempt_count = 0;
  }
  const cy = row.daily_nonresponse_cycle_count;
  if (typeof cy !== "number" || !Number.isFinite(cy) || cy < 0) {
    patch.daily_nonresponse_cycle_count = 0;
  }
  if (Object.keys(patch).length === 0) return null;
  patch.updated_at = new Date().toISOString();
  return patch;
}

async function selfHealDeliveryStateAfterLoad(
  clerkUserId: string,
  rowRecord: Record<string, unknown>
): Promise<SmsDeliveryStateRow> {
  let record = rowRecord;

  const sanityPatch = buildSanityPatch(record);
  if (sanityPatch) {
    const { error: sanErr } = await supabaseServer
      .from("sms_delivery_state")
      .update(sanityPatch)
      .eq("clerk_user_id", clerkUserId);

    if (sanErr) {
      console.error("[sms_delivery_state] self-heal sanity patch failed", {
        clerkUserId,
        error: sanErr.message,
      });
    } else {
      const { data: refreshed, error: reErr } = await supabaseServer
        .from("sms_delivery_state")
        .select(SMS_DELIVERY_STATE_SELECT)
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle();

      if (reErr) {
        console.error("[sms_delivery_state] self-heal refresh after sanity failed", {
          clerkUserId,
          error: reErr.message,
        });
      } else if (refreshed) {
        record = refreshed as Record<string, unknown>;
      }
    }
  }

  return normalizeDeliveryStateRow(record);
}

export async function loadOrCreateSmsDeliveryState(
  clerkUserId: string
): Promise<{ data: SmsDeliveryStateRow | null; error: string | null }> {
  const { data: existing, error: selErr } = await supabaseServer
    .from("sms_delivery_state")
    .select(SMS_DELIVERY_STATE_SELECT)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (selErr) {
    return { data: null, error: selErr.message };
  }

  if (existing) {
    const healed = await selfHealDeliveryStateAfterLoad(
      clerkUserId,
      existing as Record<string, unknown>
    );
    return { data: healed, error: null };
  }

  const insert = {
    clerk_user_id: clerkUserId,
    question_position: 1,
    quote_position: 0,
    current_content_type: "respond" as const,
    question_attempt_count: 0,
    daily_nonresponse_cycle_count: 0,
    sms_bucket: "daily" as const,
    flex_cadence_index: 0,
  };

  const { data: created, error: insErr } = await supabaseServer
    .from("sms_delivery_state")
    .insert(insert)
    .select(SMS_DELIVERY_STATE_SELECT)
    .maybeSingle();

  if (!insErr && created) {
    const healed = await selfHealDeliveryStateAfterLoad(
      clerkUserId,
      created as Record<string, unknown>
    );
    return { data: healed, error: null };
  }

  const code = (insErr as { code?: string })?.code;
  if (code === "23505") {
    const { data: raced } = await supabaseServer
      .from("sms_delivery_state")
      .select(SMS_DELIVERY_STATE_SELECT)
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();
    if (raced) {
      const healed = await selfHealDeliveryStateAfterLoad(
        clerkUserId,
        raced as Record<string, unknown>
      );
      return { data: healed, error: null };
    }
  }

  return { data: null, error: insErr?.message ?? "sms_delivery_state insert failed" };
}

export function smsTimePreferenceFromClerkMetadata(
  md: Record<string, unknown>
): string {
  const v = md.smsTimePreference;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : "morning";
}
