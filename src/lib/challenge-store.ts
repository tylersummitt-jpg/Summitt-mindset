import type { ChallengeParticipant, ChallengeSendAttention, ChallengeSendState } from "@/lib/challenge-types";
import type { ClaimArgs, ReenrollPlan } from "@/lib/challenge-send-outcome";

export type ChallengeStore = {
  findByEmail(normalizedEmail: string): Promise<ChallengeParticipant | null>;
  findByToken(token: string): Promise<ChallengeParticipant | null>;
  getById(id: string): Promise<ChallengeParticipant | null>;
  insert(row: ChallengeParticipant): Promise<"inserted" | "duplicate" | "error">;
  listCandidates(): Promise<ChallengeParticipant[]>;
  countLegacyDay1Held(): Promise<number>;
  countNeedsAttention(): Promise<number>;
  claim(previous: ChallengeParticipant, args: ClaimArgs): Promise<ChallengeParticipant | null>;
  commitSendResult(
    claimed: ChallengeParticipant,
    next: ChallengeParticipant
  ): Promise<ChallengeParticipant | null>;
  commitBookkeeping(
    previous: ChallengeParticipant,
    next: ChallengeParticipant
  ): Promise<ChallengeParticipant | null>;
  suppressByToken(
    token: string,
    now: Date
  ): Promise<"suppressed" | "already" | "missing">;
  reenrollByToken(
    token: string,
    now: Date,
    nextSendAt: string
  ): Promise<ReenrollPlan | "missing">;
  /** Records a successful attention alert. False when another write already recorded it. */
  markAttentionNotified(
    id: string,
    attention: ChallengeSendAttention
  ): Promise<boolean>;
};

const SEND_STATES: readonly ChallengeSendState[] = [
  "legacy",
  "pending",
  "claimed",
  "accepted",
  "provider_rejected",
  "temporary_failure",
  "permanent_failure",
  "unknown",
  "suppressed",
];

const ATTENTION: readonly ChallengeSendAttention[] = [
  "provider_rejected",
  "permanent_failure",
  "unknown_expired",
  "retry_exhausted",
  "idempotency_conflict",
  "sequence_inconsistent",
];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return null;
}

export function participantFromDbRow(raw: Record<string, unknown>): ChallengeParticipant {
  const id = asString(raw.id);
  const email = asString(raw.email);
  const challengeDay = asInt(raw.challenge_day);
  const startedAt = asString(raw.started_at);
  if (!id || !email || challengeDay == null || !startedAt) {
    throw new Error("challenge_participant_row_incomplete");
  }
  const sendStateRaw = asString(raw.send_state) ?? "legacy";
  const sendState = SEND_STATES.includes(sendStateRaw as ChallengeSendState)
    ? (sendStateRaw as ChallengeSendState)
    : "legacy";
  const attentionRaw = asString(raw.send_attention);
  const sendAttention =
    attentionRaw && ATTENTION.includes(attentionRaw as ChallengeSendAttention)
      ? (attentionRaw as ChallengeSendAttention)
      : null;
  return {
    id,
    email,
    challengeDay,
    startedAt,
    completed: raw.completed === true,
    nextSendAt: asString(raw.next_send_at),
    lastSentAt: asString(raw.last_sent_at),
    suppressedAt: asString(raw.suppressed_at),
    unsubscribeToken: asString(raw.unsubscribe_token),
    reliableSendTracking: raw.reliable_send_tracking === true,
    sendTrackingCutoverAt: asString(raw.send_tracking_cutover_at),
    sendState,
    sendAttention,
    attemptIdempotencyKey: asString(raw.attempt_idempotency_key),
    attemptKeyCreatedAt: asString(raw.attempt_key_created_at),
    attemptCount: asInt(raw.attempt_count) ?? 0,
    nextRetryAt: asString(raw.next_retry_at),
    lastSendError: asString(raw.last_send_error),
    lastSendAttemptAt: asString(raw.last_send_attempt_at),
    lastAcceptedDay: asInt(raw.last_accepted_day),
    lastProviderMessageId: asString(raw.last_provider_message_id),
    lastAcceptedAt: asString(raw.last_accepted_at),
    sendClaimToken: asString(raw.send_claim_token),
    sendClaimUntil: asString(raw.send_claim_until),
    reenrolledAt: asString(raw.reenrolled_at),
    attentionNotifiedAt: asString(raw.attention_notified_at),
  };
}

/** Delivery columns only. Never writes email or clerk_user_id. */
export function participantDeliveryPatch(row: ChallengeParticipant): Record<string, unknown> {
  return {
    challenge_day: row.challengeDay,
    completed: row.completed,
    next_send_at: row.nextSendAt,
    last_sent_at: row.lastSentAt,
    suppressed_at: row.suppressedAt,
    unsubscribe_token: row.unsubscribeToken,
    reliable_send_tracking: row.reliableSendTracking,
    send_tracking_cutover_at: row.sendTrackingCutoverAt,
    send_state: row.sendState,
    send_attention: row.sendAttention,
    attempt_idempotency_key: row.attemptIdempotencyKey,
    attempt_key_created_at: row.attemptKeyCreatedAt,
    attempt_count: row.attemptCount,
    next_retry_at: row.nextRetryAt,
    last_send_error: row.lastSendError,
    last_send_attempt_at: row.lastSendAttemptAt,
    last_accepted_day: row.lastAcceptedDay,
    last_provider_message_id: row.lastProviderMessageId,
    last_accepted_at: row.lastAcceptedAt,
    send_claim_token: row.sendClaimToken,
    send_claim_until: row.sendClaimUntil,
    reenrolled_at: row.reenrolledAt,
  };
}
