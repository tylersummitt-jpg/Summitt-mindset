/**
 * APP-041B2a — final pre-Twilio eligibility for inbound-coach sends.
 * Shared by commitAndSendInboundCoachReply and processInboundSmsSafetyShortCircuit.
 * Never returns or logs destination phone numbers.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

import { hasUnresolvedAccountDeletionRequest } from "./deletion-guards";

export type InboundCoachSmsEligibilityReason =
  | "eligible"
  | "account_deleting"
  | "identity_missing"
  | "sms_disabled"
  | "sms_stopped"
  | "phone_mismatch"
  | "job_not_sendable";

export type InboundCoachSmsEligibilityResult =
  | { ok: true; reason: "eligible" }
  | {
      ok: false;
      reason: Exclude<InboundCoachSmsEligibilityReason, "eligible">;
      /** Stable job last_error value — never includes a phone number. */
      lastErrorCode: "account_deleting" | "sms_not_eligible";
    };

export type CheckInboundCoachSmsEligibilityInput = {
  clerkUserId: string;
  destinationPhone: string;
  messageSid: string;
  /** Job must currently be one of these statuses (reloaded from DB). */
  expectedJobStatuses: readonly string[];
};

function phonesMatch(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/**
 * Immediate pre-Twilio gate. Does not send. Does not mutate rows.
 */
export async function checkInboundCoachSmsEligibility(
  input: CheckInboundCoachSmsEligibilityInput
): Promise<InboundCoachSmsEligibilityResult> {
  const clerkUserId = input.clerkUserId.trim();
  if (!clerkUserId || !input.messageSid.trim()) {
    return {
      ok: false,
      reason: "job_not_sendable",
      lastErrorCode: "sms_not_eligible",
    };
  }

  const { data: job, error: jobErr } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("message_sid, status, clerk_user_id")
    .eq("message_sid", input.messageSid)
    .maybeSingle();

  if (
    jobErr ||
    !job?.message_sid ||
    typeof job.status !== "string" ||
    !input.expectedJobStatuses.includes(job.status) ||
    (typeof job.clerk_user_id === "string" &&
      job.clerk_user_id.trim() !== clerkUserId)
  ) {
    return {
      ok: false,
      reason: "job_not_sendable",
      lastErrorCode: "sms_not_eligible",
    };
  }

  if (await hasUnresolvedAccountDeletionRequest(clerkUserId)) {
    return {
      ok: false,
      reason: "account_deleting",
      lastErrorCode: "account_deleting",
    };
  }

  const { data: identity, error: idErr } = await supabaseServer
    .from("sms_identities")
    .select("phone_number, clerk_user_id, sms_enabled, stopped_at")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (idErr || !identity?.clerk_user_id) {
    return {
      ok: false,
      reason: "identity_missing",
      lastErrorCode: "sms_not_eligible",
    };
  }

  if (identity.sms_enabled !== true) {
    return {
      ok: false,
      reason: "sms_disabled",
      lastErrorCode: "sms_not_eligible",
    };
  }

  if (identity.stopped_at != null && String(identity.stopped_at).length > 0) {
    return {
      ok: false,
      reason: "sms_stopped",
      lastErrorCode: "sms_not_eligible",
    };
  }

  const boundPhone =
    typeof identity.phone_number === "string" ? identity.phone_number : "";
  if (
    !boundPhone ||
    !phonesMatch(boundPhone, String(input.destinationPhone || ""))
  ) {
    return {
      ok: false,
      reason: "phone_mismatch",
      lastErrorCode: "sms_not_eligible",
    };
  }

  return { ok: true, reason: "eligible" };
}
