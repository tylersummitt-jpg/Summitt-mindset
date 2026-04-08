/**
 * Advances `sms_delivery_state` after a valid daily inbound reply (Layer B).
 * Not wired to routes; call sites own when this runs.
 */
import { supabaseServer } from "@/lib/supabase-server";
import type { SmsDeliveryStateRow } from "@/lib/sms-daily-delivery-body";

const SMS_DELIVERY_STATE_SELECT =
  "clerk_user_id, question_position, quote_position, current_content_type, question_attempt_count, daily_nonresponse_cycle_count, sms_bucket, flex_cadence_index, day2_special_sent_at";

function coerceDeliveryStateRow(row: Record<string, unknown>): SmsDeliveryStateRow {
  const bucketRaw = row.sms_bucket;
  const bucket: "daily" | "flex" = bucketRaw === "flex" ? "flex" : "daily";
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
      typeof row.question_position === "number" && Number.isFinite(row.question_position)
        ? row.question_position
        : 1,
    quote_position:
      typeof row.quote_position === "number" && Number.isFinite(row.quote_position)
        ? row.quote_position
        : 0,
    current_content_type:
      row.current_content_type === "non_response" ? "non_response" : "respond",
    question_attempt_count:
      typeof row.question_attempt_count === "number" && Number.isFinite(row.question_attempt_count)
        ? row.question_attempt_count
        : 0,
    daily_nonresponse_cycle_count: cycle,
    sms_bucket: bucket,
    flex_cadence_index: flexCadenceIndex,
    day2_special_sent_at: day2SpecialSentAt,
  };
}

function deliverySnapshotIsDay2Freeform(snapshot: unknown): boolean {
  if (
    snapshot == null ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot)
  ) {
    return false;
  }
  return (snapshot as Record<string, unknown>).is_day2_freeform === true;
}

function snapshotQuestionQuotePositions(snapshot: unknown): {
  question_position: number;
  quote_position: number;
} | null {
  if (
    snapshot == null ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot)
  ) {
    return null;
  }
  const o = snapshot as Record<string, unknown>;
  const qp = o.question_position;
  const quoteP = o.quote_position;
  if (typeof qp !== "number" || !Number.isFinite(qp)) return null;
  if (typeof quoteP !== "number" || !Number.isFinite(quoteP)) return null;
  return { question_position: qp, quote_position: quoteP };
}

export async function advanceSmsDeliveryStateOnInboundReply(
  clerkUserId: string
): Promise<
  | { ok: true; action: "noop" | "question_to_quote_ready" | "quote_to_next_question" }
  | { ok: false; error: string }
> {
  const { data: rawState, error: stateErr } = await supabaseServer
    .from("sms_delivery_state")
    .select(SMS_DELIVERY_STATE_SELECT)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (stateErr) {
    return { ok: false, error: stateErr.message };
  }
  if (!rawState) {
    return { ok: false, error: "sms_delivery_state missing" };
  }

  const base = coerceDeliveryStateRow(rawState as Record<string, unknown>);

  const { data: lastOutbound } = await supabaseServer
    .from("sms_last_outbound_context")
    .select("message_kind, delivery_snapshot")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (deliverySnapshotIsDay2Freeform(lastOutbound?.delivery_snapshot)) {
    return { ok: true, action: "noop" };
  }

  const kind = lastOutbound?.message_kind;

  if (kind === "quote" && lastOutbound) {
    const targetQuestionPosition = base.question_position + 1;
    const targetQuotePosition = base.quote_position + 1;
    const targetAttempts = 0;
    const targetContent: "respond" = "respond";

    const snapPos = snapshotQuestionQuotePositions(lastOutbound.delivery_snapshot);

    /**
     * Effect-based idempotency for quote replies: `delivery_snapshot` on the last
     * outbound row is pre-send; after the quote send, apply advances positions by +1.
     * This inbound advance adds another +1. Duplicate jobs should noop when the row
     * already reflects that second increment (snapshot + 2 on both positions).
     */
    if (snapPos) {
      const alreadyAtEffect =
        base.question_position === snapPos.question_position + 2 &&
        base.quote_position === snapPos.quote_position + 2 &&
        base.question_attempt_count === targetAttempts &&
        base.current_content_type === targetContent;

      if (alreadyAtEffect) {
        return { ok: true, action: "noop" };
      }
    }

    const { error: quoteErr } = await supabaseServer
      .from("sms_delivery_state")
      .update({
        question_position: targetQuestionPosition,
        quote_position: targetQuotePosition,
        question_attempt_count: targetAttempts,
        current_content_type: targetContent,
      })
      .eq("clerk_user_id", clerkUserId);

    if (quoteErr) {
      return { ok: false, error: quoteErr.message };
    }
    return { ok: true, action: "quote_to_next_question" };
  }

  if (base.sms_bucket === "flex") {
    return { ok: true, action: "noop" };
  }

  if (kind === "question") {
    const targetAttempts = 3;
    const targetContent: "respond" = "respond";

    const alreadyAtTarget =
      base.question_attempt_count === targetAttempts &&
      base.current_content_type === targetContent;

    if (alreadyAtTarget) {
      return { ok: true, action: "noop" };
    }

    const { error: upErr } = await supabaseServer
      .from("sms_delivery_state")
      .update({
        question_attempt_count: targetAttempts,
        current_content_type: targetContent,
      })
      .eq("clerk_user_id", clerkUserId);

    if (upErr) {
      return { ok: false, error: upErr.message };
    }
    return { ok: true, action: "question_to_quote_ready" };
  }

  return { ok: true, action: "noop" };
}
