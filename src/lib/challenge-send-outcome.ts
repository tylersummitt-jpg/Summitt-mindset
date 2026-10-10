/**
 * Pure challenge delivery rules: provider classification, eligibility, retries.
 * No database and no Resend client.
 */

import type {
  ChallengeParticipant,
  ChallengeProviderOutcome,
  ChallengeProviderResult,
  ChallengeSendAttention,
  ChallengeSendState,
} from "@/lib/challenge-types";
import {
  CHALLENGE_CLAIM_MS,
  CHALLENGE_MAX_PROVIDER_ATTEMPTS,
  CHALLENGE_PUBLIC_ALREADY,
  CHALLENGE_PUBLIC_FAILED,
  CHALLENGE_PUBLIC_INVALID_EMAIL,
  CHALLENGE_PUBLIC_STARTED,
  CHALLENGE_TEMPORARY_BACKOFF_MS,
  CHALLENGE_UNKNOWN_POLL_MS,
  CHALLENGE_UNKNOWN_RETRY_WINDOW_MS,
} from "@/lib/challenge-types";

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const TEMPORARY_ERROR_NAMES = new Set([
  "rate_limit_exceeded",
  "monthly_quota_exceeded",
  "daily_quota_exceeded",
  "application_error",
  "internal_server_error",
]);

const IDEMPOTENCY_CONFLICT_NAMES = new Set([
  "invalid_idempotent_request",
  "invalid_idempotency_key",
]);

export type ResendSendLike = {
  data?: { id?: string | null } | null;
  error?: {
    message?: string | null;
    statusCode?: number | null;
    name?: string | null;
  } | null;
};

export function sanitizeProviderError(input: unknown): string | null {
  const raw =
    input instanceof Error
      ? input.message
      : typeof input === "string"
        ? input
        : input == null
          ? ""
          : String(input);
  const cleaned = raw.replace(EMAIL_IN_TEXT, "[email]").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 240);
}

export function normalizeChallengeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (/\s/.test(email)) return null;
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+$/.test(email)) return null;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return null;
  const domain = email.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    return null;
  }
  if (domain.includes("..")) return null;
  return email;
}

export function isUnsubscribeTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{20,128}$/.test(token);
}

/**
 * Accepted requires a non-empty Resend message id and no error.
 * A thrown network error is unknown: the request may already have been accepted.
 */
export function classifyResendSend(args: {
  threw?: unknown;
  result?: ResendSendLike | null;
}): ChallengeProviderResult {
  if (args.threw !== undefined) {
    return {
      outcome: "unknown",
      providerMessageId: null,
      errorName: "exception",
      statusCode: null,
      errorMessage: sanitizeProviderError(args.threw),
    };
  }

  const result = args.result;
  if (!result) {
    return {
      outcome: "unknown",
      providerMessageId: null,
      errorName: "empty_result",
      statusCode: null,
      errorMessage: "Email provider returned no result",
    };
  }

  const error = result.error ?? null;
  const id = typeof result.data?.id === "string" ? result.data.id.trim() : "";

  if (!error && id) {
    return {
      outcome: "accepted",
      providerMessageId: id,
      errorName: null,
      statusCode: null,
      errorMessage: null,
    };
  }

  if (!error && !id) {
    return {
      outcome: "unknown",
      providerMessageId: null,
      errorName: "missing_message_id",
      statusCode: null,
      errorMessage: "Email provider returned no message id",
    };
  }

  const name = typeof error?.name === "string" ? error.name : "";
  const status = typeof error?.statusCode === "number" ? error.statusCode : null;
  const errorMessage =
    sanitizeProviderError(error?.message) ?? "Email provider rejected the request";

  if (name === "concurrent_idempotent_requests") {
    return {
      outcome: "unknown",
      providerMessageId: null,
      errorName: name,
      statusCode: status,
      errorMessage,
    };
  }

  if (IDEMPOTENCY_CONFLICT_NAMES.has(name)) {
    return {
      outcome: "permanent_failure",
      providerMessageId: null,
      errorName: name,
      statusCode: status,
      errorMessage,
    };
  }

  if (TEMPORARY_ERROR_NAMES.has(name) || status === 429 || (status != null && status >= 500)) {
    return {
      outcome: "temporary_failure",
      providerMessageId: null,
      errorName: name || null,
      statusCode: status,
      errorMessage,
    };
  }

  if (status == null || status === 408) {
    return {
      outcome: "unknown",
      providerMessageId: null,
      errorName: name || null,
      statusCode: status,
      errorMessage,
    };
  }

  const outcome: ChallengeProviderOutcome =
    status === 400 ||
    status === 422 ||
    name === "validation_error" ||
    name === "invalid_parameter"
      ? "provider_rejected"
      : "permanent_failure";

  return {
    outcome,
    providerMessageId: null,
    errorName: name || null,
    statusCode: status,
    errorMessage,
  };
}

export function providerNotConfiguredResult(): ChallengeProviderResult {
  return {
    outcome: "temporary_failure",
    providerMessageId: null,
    errorName: "missing_api_key",
    statusCode: null,
    errorMessage: "Email provider is not configured",
  };
}

export function missingLessonResult(): ChallengeProviderResult {
  return {
    outcome: "permanent_failure",
    providerMessageId: null,
    errorName: "missing_lesson",
    statusCode: null,
    errorMessage: "No lesson exists for this challenge day",
  };
}

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

export function unknownWindowExpired(row: ChallengeParticipant, now: Date): boolean {
  const created = ms(row.attemptKeyCreatedAt);
  if (created == null || !row.attemptIdempotencyKey) return false;
  return now.getTime() - created >= CHALLENGE_UNKNOWN_RETRY_WINDOW_MS;
}

export function claimIsActive(row: ChallengeParticipant, now: Date): boolean {
  const until = ms(row.sendClaimUntil);
  return until != null && until > now.getTime();
}

export type DeliveryDecision =
  | { kind: "send" }
  | { kind: "not_due" }
  | { kind: "unknown_expired" }
  | { kind: "advance_accepted" }
  | { kind: "inconsistent" }
  | { kind: "retry_exhausted" };

/**
 * Day 1 is due only for enrollments created under reliable tracking.
 * A lesson already confirmed accepted is never selected for another send.
 */
export function decideDelivery(row: ChallengeParticipant, now: Date): DeliveryDecision {
  if (row.completed || row.suppressedAt || row.sendAttention) return { kind: "not_due" };
  if (row.challengeDay < 1 || row.challengeDay > 7) return { kind: "not_due" };
  if (claimIsActive(row, now)) return { kind: "not_due" };

  if (row.lastAcceptedDay != null && row.lastAcceptedDay > row.challengeDay) {
    return { kind: "inconsistent" };
  }
  if (row.lastAcceptedDay != null && row.lastAcceptedDay === row.challengeDay) {
    return { kind: "advance_accepted" };
  }

  const retryAt = ms(row.nextRetryAt);
  if (retryAt != null && retryAt > now.getTime()) return { kind: "not_due" };

  const uncertain =
    row.sendState === "unknown" ||
    (row.sendState === "claimed" && row.attemptIdempotencyKey != null);
  if (uncertain && unknownWindowExpired(row, now)) return { kind: "unknown_expired" };

  if (
    row.sendState === "temporary_failure" &&
    row.attemptCount >= CHALLENGE_MAX_PROVIDER_ATTEMPTS
  ) {
    return { kind: "retry_exhausted" };
  }

  if (row.challengeDay === 1) {
    if (!row.reliableSendTracking) return { kind: "not_due" };
    return { kind: "send" };
  }

  // An in-flight or unknown lesson retries the same day even if the next slot was cleared.
  if (uncertain) return { kind: "send" };

  const due = ms(row.nextSendAt);
  if (due == null || due > now.getTime()) return { kind: "not_due" };
  return { kind: "send" };
}

export type ClaimArgs = {
  now: Date;
  claimToken: string;
  idempotencyKey: string;
  unsubscribeToken: string;
};

/** Returns the claimed row, or null when this worker must not send. */
export function planClaim(
  row: ChallengeParticipant,
  args: ClaimArgs
): ChallengeParticipant | null {
  if (decideDelivery(row, args.now).kind !== "send") return null;
  const nowIso = args.now.toISOString();
  const mintingKey = row.attemptIdempotencyKey == null;
  return {
    ...row,
    sendState: "claimed",
    sendClaimToken: args.claimToken,
    sendClaimUntil: new Date(args.now.getTime() + CHALLENGE_CLAIM_MS).toISOString(),
    attemptCount: mintingKey ? row.attemptCount + 1 : row.attemptCount,
    attemptIdempotencyKey: row.attemptIdempotencyKey ?? args.idempotencyKey,
    attemptKeyCreatedAt: row.attemptKeyCreatedAt ?? nowIso,
    unsubscribeToken: row.unsubscribeToken ?? args.unsubscribeToken,
    lastSendAttemptAt: nowIso,
  };
}

function clearedClaim(): Pick<ChallengeParticipant, "sendClaimToken" | "sendClaimUntil"> {
  return { sendClaimToken: null, sendClaimUntil: null };
}

export function planAdvanceAccepted(
  row: ChallengeParticipant,
  nextSendAt: string
): ChallengeParticipant | null {
  if (row.lastAcceptedDay == null || row.lastAcceptedDay !== row.challengeDay) return null;
  if (row.challengeDay < 1 || row.challengeDay > 7) return null;
  const nextDay = row.challengeDay + 1;
  const suppressed = row.suppressedAt != null;
  return {
    ...row,
    challengeDay: nextDay,
    completed: nextDay > 7,
    nextSendAt: suppressed || nextDay > 7 ? null : nextSendAt,
    sendState: suppressed ? "suppressed" : "accepted",
    attemptIdempotencyKey: null,
    attemptKeyCreatedAt: null,
    attemptCount: 0,
    nextRetryAt: null,
    lastSendError: null,
    sendAttention: null,
    ...clearedClaim(),
  };
}

export function planSendResult(
  row: ChallengeParticipant,
  result: ChallengeProviderResult,
  now: Date,
  nextSendAt: string
): ChallengeParticipant {
  const nowIso = now.toISOString();
  const base: ChallengeParticipant = {
    ...row,
    lastSendAttemptAt: nowIso,
    lastSendError: result.errorMessage,
    ...clearedClaim(),
  };

  if (result.outcome === "accepted" && result.providerMessageId) {
    const nextDay = row.challengeDay + 1;
    const suppressed = row.suppressedAt != null;
    return {
      ...base,
      challengeDay: nextDay,
      completed: nextDay > 7,
      nextSendAt: suppressed || nextDay > 7 ? null : nextSendAt,
      lastSentAt: nowIso,
      lastAcceptedDay: row.challengeDay,
      lastProviderMessageId: result.providerMessageId,
      lastAcceptedAt: nowIso,
      sendState: suppressed ? "suppressed" : "accepted",
      sendAttention: null,
      attemptIdempotencyKey: null,
      attemptKeyCreatedAt: null,
      attemptCount: 0,
      nextRetryAt: null,
      lastSendError: null,
    };
  }

  return planFailure(base, result.outcome === "accepted" ? "unknown" : result.outcome, result, now);
}

function attentionFor(
  outcome: ChallengeProviderOutcome,
  errorName: string | null
): ChallengeSendAttention | null {
  if (outcome === "provider_rejected") return "provider_rejected";
  if (outcome === "permanent_failure") {
    if (errorName && IDEMPOTENCY_CONFLICT_NAMES.has(errorName)) return "idempotency_conflict";
    return "permanent_failure";
  }
  return null;
}

function planFailure(
  row: ChallengeParticipant,
  outcome: ChallengeProviderOutcome,
  result: ChallengeProviderResult,
  now: Date
): ChallengeParticipant {
  const state = outcome as ChallengeSendState;
  const attention = attentionFor(outcome, result.errorName);
  if (attention) {
    return {
      ...row,
      sendState: state,
      sendAttention: attention,
      nextRetryAt: null,
    };
  }

  if (outcome === "unknown") {
    if (unknownWindowExpired(row, now)) {
      return {
        ...row,
        sendState: "unknown",
        sendAttention: "unknown_expired",
        nextRetryAt: null,
      };
    }
    return {
      ...row,
      sendState: "unknown",
      sendAttention: null,
      nextRetryAt: new Date(now.getTime() + CHALLENGE_UNKNOWN_POLL_MS).toISOString(),
    };
  }

  // Known rejection: the provider answered and did not accept. Drop the key so the
  // next try is a new request. Replaying the same key inside 24h returns the cached error.
  if (row.attemptCount >= CHALLENGE_MAX_PROVIDER_ATTEMPTS) {
    return {
      ...row,
      sendState: "temporary_failure",
      sendAttention: "retry_exhausted",
      nextRetryAt: null,
      attemptIdempotencyKey: null,
      attemptKeyCreatedAt: null,
    };
  }

  const delay =
    CHALLENGE_TEMPORARY_BACKOFF_MS[
      Math.min(Math.max(row.attemptCount - 1, 0), CHALLENGE_TEMPORARY_BACKOFF_MS.length - 1)
    ];
  return {
    ...row,
    sendState: "temporary_failure",
    sendAttention: null,
    nextRetryAt: new Date(now.getTime() + delay).toISOString(),
    attemptIdempotencyKey: null,
    attemptKeyCreatedAt: null,
  };
}

/**
 * Write-time rule, mirrored by apply_challenge_send_bookkeeping.
 * A live unsubscribe wins over a planned snapshot. Re-enrollment does not use this.
 * Accepted lessons still keep their provider message id and advanced day.
 */
export function keepLiveSuppression(
  live: ChallengeParticipant,
  planned: ChallengeParticipant
): ChallengeParticipant {
  const kept: ChallengeParticipant = {
    ...planned,
    attentionNotifiedAt: live.attentionNotifiedAt ?? planned.attentionNotifiedAt ?? null,
  };
  if (!live.suppressedAt) return kept;
  return {
    ...kept,
    suppressedAt: live.suppressedAt,
    nextSendAt: null,
    nextRetryAt: null,
    sendState: "suppressed",
    lastProviderMessageId: planned.lastProviderMessageId ?? live.lastProviderMessageId,
    lastAcceptedDay: planned.lastAcceptedDay ?? live.lastAcceptedDay,
    lastAcceptedAt: planned.lastAcceptedAt ?? live.lastAcceptedAt,
    lastSentAt: planned.lastSentAt ?? live.lastSentAt,
  };
}

export type ChallengeAttentionFailure = ChallengeSendAttention;

export type ChallengeAttentionAlert = {
  participantId: string;
  challengeDay: number;
  failureType: ChallengeAttentionFailure;
  error: string | null;
  retrySafe: false;
  retryReason: string;
};

const ALERT_FAILURES = new Set<string>([
  "retry_exhausted",
  "provider_rejected",
  "unknown_expired",
  "permanent_failure",
  "idempotency_conflict",
  "sequence_inconsistent",
]);

function isAlertFailure(value: string | null): value is ChallengeAttentionFailure {
  return value != null && ALERT_FAILURES.has(value);
}

function challengeRetryReason(failure: ChallengeAttentionFailure): string {
  if (failure === "unknown_expired") {
    return "No. The provider result is unknown and the idempotency window has closed. Another send could deliver this lesson twice.";
  }
  if (failure === "provider_rejected") {
    return "No. The provider rejected this lesson. Do not send it again automatically.";
  }
  if (failure === "permanent_failure") {
    return "No. The provider permanently rejected this request. Do not send it again automatically.";
  }
  if (failure === "idempotency_conflict") {
    return "No. The idempotency key conflicts with an earlier request. Another send could deliver this lesson twice.";
  }
  if (failure === "sequence_inconsistent") {
    return "No. The lesson sequence is inconsistent. Do not send another lesson automatically.";
  }
  return "No. The send cap was reached. Do not send this lesson again automatically.";
}

/** Alert while a terminal attention state has not been confirmed. A later cron retries until it is. */
export function challengeAttentionAlert(saved: ChallengeParticipant): ChallengeAttentionAlert | null {
  if (saved.attentionNotifiedAt) return null;
  if (!isAlertFailure(saved.sendAttention)) return null;
  return {
    participantId: saved.id,
    challengeDay: saved.challengeDay,
    failureType: saved.sendAttention,
    error: sanitizeProviderError(saved.lastSendError),
    retrySafe: false,
    retryReason: challengeRetryReason(saved.sendAttention),
  };
}

export function planSuppress(row: ChallengeParticipant, now: Date): ChallengeParticipant {
  if (row.suppressedAt) return row;
  const activeClaim = claimIsActive(row, now);
  return {
    ...row,
    suppressedAt: now.toISOString(),
    nextSendAt: null,
    nextRetryAt: null,
    sendState: activeClaim ? row.sendState : "suppressed",
  };
}

export type ReenrollPlan =
  | { kind: "completed"; row: ChallengeParticipant }
  | { kind: "already_active"; row: ChallengeParticipant }
  | { kind: "paused"; row: ChallengeParticipant }
  | { kind: "resume_later"; row: ChallengeParticipant }
  | { kind: "resume_day1"; row: ChallengeParticipant };

export function planReenroll(
  row: ChallengeParticipant,
  now: Date,
  nextSendAt: string
): ReenrollPlan {
  if (row.completed || row.challengeDay > 7) return { kind: "completed", row };
  if (row.sendAttention) return { kind: "paused", row };
  if (!row.suppressedAt) return { kind: "already_active", row };

  const uncertain = row.sendState === "unknown" || row.sendState === "claimed";
  const resumed: ChallengeParticipant = {
    ...row,
    suppressedAt: null,
    reenrolledAt: now.toISOString(),
    sendState: uncertain ? row.sendState : row.challengeDay === 1 ? "pending" : row.sendState,
  };

  if (uncertain && row.attemptIdempotencyKey) {
    return {
      kind: "resume_later",
      row: {
        ...resumed,
        nextRetryAt: now.toISOString(),
        nextSendAt: row.challengeDay === 1 ? null : nextSendAt,
      },
    };
  }

  if (row.challengeDay === 1) {
    return {
      kind: "resume_day1",
      row: {
        ...resumed,
        nextRetryAt: now.toISOString(),
        nextSendAt: null,
        sendState: "pending",
      },
    };
  }

  const existingDue = ms(row.nextSendAt);
  const keepFuture = existingDue != null && existingDue > now.getTime();
  return {
    kind: "resume_later",
    row: {
      ...resumed,
      nextSendAt: keepFuture ? row.nextSendAt : nextSendAt,
      nextRetryAt: null,
      sendState: resumed.sendState === "suppressed" ? "legacy" : resumed.sendState,
    },
  };
}

export function challengeIdempotencyKey(
  participantId: string,
  day: number,
  nonce: string
): string {
  const cleanId = participantId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  const cleanNonce = nonce.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return `ch_${cleanId}_d${day}_${cleanNonce}`.slice(0, 256);
}

export function publicSignupBody(kind: "started" | "already" | "failed" | "invalid"): {
  ok: boolean;
  status: number;
  message: string;
} {
  if (kind === "started") {
    return { ok: true, status: 200, message: CHALLENGE_PUBLIC_STARTED };
  }
  if (kind === "already") {
    return { ok: true, status: 200, message: CHALLENGE_PUBLIC_ALREADY };
  }
  if (kind === "invalid") {
    return { ok: false, status: 400, message: CHALLENGE_PUBLIC_INVALID_EMAIL };
  }
  return { ok: false, status: 503, message: CHALLENGE_PUBLIC_FAILED };
}
