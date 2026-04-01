/**
 * Aligns Supabase `sms_delivery_state` after structural day completion (Layer A),
 * matching the post-`completeDay` behavior previously inlined in sms-inbound-coach.
 * Does not touch question_position, quote_position, or flex_cadence_index.
 */
import { supabaseServer } from "@/lib/supabase-server";

export type ReconcileSmsDeliveryStateResult =
  | { ok: true }
  | { ok: false; error: string };

export async function reconcileSmsDeliveryStateAfterCompletion(
  clerkUserId: string
): Promise<ReconcileSmsDeliveryStateResult> {
  const { data: row, error: selErr } = await supabaseServer
    .from("sms_delivery_state")
    .select(
      "clerk_user_id, current_content_type, question_attempt_count, sms_bucket, daily_nonresponse_cycle_count"
    )
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (selErr) {
    return { ok: false, error: selErr.message };
  }

  const preserveBucket: "daily" | "flex" =
    row?.sms_bucket === "flex" ? "flex" : "daily";

  const completionStatePatch =
    row?.current_content_type === "respond"
      ? {
          current_content_type: "respond" as const,
          question_attempt_count: 3,
        }
      : {
          current_content_type: "non_response" as const,
          question_attempt_count: 0,
        };

  const { error: upsertErr } = await supabaseServer
    .from("sms_delivery_state")
    .upsert(
      {
        clerk_user_id: clerkUserId,
        ...completionStatePatch,
        sms_bucket: preserveBucket,
        daily_nonresponse_cycle_count: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_user_id" }
    );

  if (upsertErr) {
    return { ok: false, error: upsertErr.message };
  }

  return { ok: true };
}
