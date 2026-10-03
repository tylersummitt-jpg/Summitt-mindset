import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { isTwilioReady, sendSMSChunked } from "@/lib/twilio";

/**
 * Durable "Tyler has not reviewed this likely full-SMS opt-out yet" hold.
 * One row in this status blocks Morning / Evening / Weekly.
 * It is not canonical STOP, and it is not a Pat-answer park.
 */
export const AWAITING_SMS_OPT_OUT_REVIEW_STATUS = "awaiting_sms_opt_out_review";

export const AWAITING_SMS_OPT_OUT_REVIEW_SKIP_REASON = "awaiting_sms_opt_out_review";

/** Fixed acknowledgment. Must not claim texts are off. */
export const SMS_OPT_OUT_REVIEW_ACK_BODY =
  "I hear you. I’m making sure this gets handled.";

const HOLD_TAG = "inbound_sol_awaiting_sms_opt_out_review";

function farFutureIso(): string {
  return new Date(Date.now() + 86400 * 365 * 10 * 1000).toISOString();
}

/**
 * True when this member has an open opt-out review.
 * Lookup error fails closed (returns true) so a scheduled text does not send.
 * A blank user id returns false: there is no member to hold.
 */
export async function hasAwaitingSmsOptOutReview(clerkUserId: string): Promise<boolean> {
  const id = clerkUserId.trim();
  if (!id) return false;

  const { data, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("message_sid")
    .eq("clerk_user_id", id)
    .eq("status", AWAITING_SMS_OPT_OUT_REVIEW_STATUS)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[sms-opt-out-review] lookup_failed", {
      clerk_user_id: id,
      error: error.message,
    });
    return true;
  }

  return typeof data?.message_sid === "string" && data.message_sid.trim().length > 0;
}

/**
 * Message sid of an open review, or null when none exists.
 * Lookup error returns null so the caller can still park the current job
 * (fail closed for scheduled sends) rather than silently dropping the hold.
 */
export async function findOpenSmsOptOutReviewMessageSid(
  clerkUserId: string
): Promise<string | null> {
  const id = clerkUserId.trim();
  if (!id) return null;

  const { data, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("message_sid")
    .eq("clerk_user_id", id)
    .eq("status", AWAITING_SMS_OPT_OUT_REVIEW_STATUS)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[sms-opt-out-review] open_lookup_failed", {
      clerk_user_id: id,
      error: error.message,
    });
    return null;
  }

  return typeof data?.message_sid === "string" && data.message_sid.trim()
    ? data.message_sid.trim()
    : null;
}

export type SmsOptOutReviewAckResult =
  | { ok: true; outcome: "acknowledged" | "already_held" }
  | { ok: false; outcome: "already_open_other" | "ack_failed"; error: string };

/**
 * Park this job as the review hold, then send the fixed acknowledgment
 * without the reply_ready → sending → sent machine.
 * Status stays awaiting_sms_opt_out_review.
 * Outbound sid and sent_at are written in one update.
 * Failures do not throw and do not move the row to failed or sent.
 */
export async function sendSmsOptOutReviewAcknowledgment(args: {
  messageSid: string;
  clerkUserId: string;
  toPhone: string;
}): Promise<SmsOptOutReviewAckResult> {
  const messageSid = args.messageSid.trim();
  const clerkUserId = args.clerkUserId.trim();
  const toPhone = args.toPhone.trim();
  if (!messageSid || !clerkUserId || !toPhone) {
    return { ok: false, outcome: "ack_failed", error: "missing_ack_target" };
  }

  const openSid = await findOpenSmsOptOutReviewMessageSid(clerkUserId);
  if (openSid && openSid !== messageSid) {
    return {
      ok: false,
      outcome: "already_open_other",
      error: "sms_opt_out_review_already_open",
    };
  }

  const parkedAt = new Date().toISOString();
  const { data: parked, error: parkError } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: AWAITING_SMS_OPT_OUT_REVIEW_STATUS,
      reply_body: SMS_OPT_OUT_REVIEW_ACK_BODY,
      next_retry_at: farFutureIso(),
      last_error: JSON.stringify({ tag: HOLD_TAG }).slice(0, 1900),
      updated_at: parkedAt,
    })
    .eq("message_sid", messageSid)
    .eq("status", "processing")
    .select("message_sid")
    .maybeSingle();

  if (parkError) {
    console.warn("[sms-opt-out-review] park_failed", {
      message_sid: messageSid,
      error: parkError.message,
    });
    return { ok: false, outcome: "ack_failed", error: parkError.message };
  }

  if (!parked) {
    const { data: existing } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .select("status")
      .eq("message_sid", messageSid)
      .maybeSingle();
    if (existing?.status === AWAITING_SMS_OPT_OUT_REVIEW_STATUS) {
      return { ok: true, outcome: "already_held" };
    }
    return { ok: false, outcome: "ack_failed", error: "park_claim_lost" };
  }

  if (!isTwilioReady()) {
    await noteAckFailure(messageSid, "twilio_not_configured");
    return { ok: false, outcome: "ack_failed", error: "twilio_not_configured" };
  }

  let outboundSid: string | null = null;
  try {
    const sendResult = await sendSMSChunked({
      to: toPhone,
      body: SMS_OPT_OUT_REVIEW_ACK_BODY,
      lastOutbound: {
        clerkUserId,
        messageKind: "coach",
      },
    });
    outboundSid =
      sendResult.firstSid && sendResult.firstSid.length > 0 ? sendResult.firstSid : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "ack_send_failed";
    console.warn("[sms-opt-out-review] ack_send_failed", {
      message_sid: messageSid,
      error: message.slice(0, 200),
    });
    await noteAckFailure(messageSid, message.slice(0, 400));
    return { ok: false, outcome: "ack_failed", error: message };
  }

  const sentAt = new Date().toISOString();
  const deliveryPatch: Record<string, unknown> = {
    status: AWAITING_SMS_OPT_OUT_REVIEW_STATUS,
    reply_body: SMS_OPT_OUT_REVIEW_ACK_BODY,
    sent_at: sentAt,
    updated_at: sentAt,
    last_error: null,
  };
  if (outboundSid) {
    deliveryPatch.outbound_message_sid = outboundSid;
  }

  const { error: deliverError } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update(deliveryPatch)
    .eq("message_sid", messageSid)
    .eq("status", AWAITING_SMS_OPT_OUT_REVIEW_STATUS);

  if (deliverError) {
    console.warn("[sms-opt-out-review] delivery_stamp_failed", {
      message_sid: messageSid,
      error: deliverError.message,
    });
    return { ok: false, outcome: "ack_failed", error: deliverError.message };
  }

  return { ok: true, outcome: "acknowledged" };
}

async function noteAckFailure(messageSid: string, error: string): Promise<void> {
  await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: AWAITING_SMS_OPT_OUT_REVIEW_STATUS,
      last_error: JSON.stringify({
        tag: HOLD_TAG,
        ack_error: error,
      }).slice(0, 1900),
      updated_at: new Date().toISOString(),
    })
    .eq("message_sid", messageSid)
    .eq("status", AWAITING_SMS_OPT_OUT_REVIEW_STATUS);
}
