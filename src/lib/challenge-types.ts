/**
 * Seven-day challenge delivery types.
 * Provider acceptance is not inbox delivery.
 */

/** New enrollments stamp this. Preexisting rows keep send_tracking_cutover_at NULL. */
export const CHALLENGE_SEND_TRACKING_CUTOVER_ISO = "2026-10-10T00:00:00.000Z";

export const CHALLENGE_ORIGIN = "https://summittmindset.com";

export const CHALLENGE_CLAIM_MS = 5 * 60 * 1000;

/** Resend retains idempotency keys for 24h. Stop unknown retries inside that window. */
export const CHALLENGE_UNKNOWN_RETRY_WINDOW_MS = 22 * 60 * 60 * 1000;

export const CHALLENGE_MAX_PROVIDER_ATTEMPTS = 5;

export const CHALLENGE_TEMPORARY_BACKOFF_MS = [
  15 * 60 * 1000,
  60 * 60 * 1000,
  4 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
] as const;

export const CHALLENGE_UNKNOWN_POLL_MS = 15 * 60 * 1000;

export const CHALLENGE_PUBLIC_STARTED =
  "You're signed up. Your first lesson is on its way.";

export const CHALLENGE_PUBLIC_ALREADY =
  "You're already signed up for this challenge. If you previously unsubscribed, this form will not turn emails back on.";

export const CHALLENGE_PUBLIC_FAILED =
  "We couldn't start your challenge. Please try again.";

export const CHALLENGE_PUBLIC_INVALID_EMAIL = "Enter a valid email address.";

export type ChallengeSendState =
  | "legacy"
  | "pending"
  | "claimed"
  | "accepted"
  | "provider_rejected"
  | "temporary_failure"
  | "permanent_failure"
  | "unknown"
  | "suppressed";

export type ChallengeSendAttention =
  | "provider_rejected"
  | "permanent_failure"
  | "unknown_expired"
  | "retry_exhausted"
  | "idempotency_conflict"
  | "sequence_inconsistent";

export type ChallengeProviderOutcome =
  | "accepted"
  | "provider_rejected"
  | "temporary_failure"
  | "permanent_failure"
  | "unknown";

export type ChallengeParticipant = {
  id: string;
  email: string;
  challengeDay: number;
  startedAt: string;
  completed: boolean;
  nextSendAt: string | null;
  lastSentAt: string | null;
  suppressedAt: string | null;
  unsubscribeToken: string | null;
  reliableSendTracking: boolean;
  sendTrackingCutoverAt: string | null;
  sendState: ChallengeSendState;
  sendAttention: ChallengeSendAttention | null;
  attemptIdempotencyKey: string | null;
  attemptKeyCreatedAt: string | null;
  attemptCount: number;
  nextRetryAt: string | null;
  lastSendError: string | null;
  lastSendAttemptAt: string | null;
  lastAcceptedDay: number | null;
  lastProviderMessageId: string | null;
  lastAcceptedAt: string | null;
  sendClaimToken: string | null;
  sendClaimUntil: string | null;
  reenrolledAt: string | null;
  /** Set only after the internal attention alert is accepted. Null means it still needs to be sent. */
  attentionNotifiedAt: string | null;
};

export type ChallengeProviderResult = {
  outcome: ChallengeProviderOutcome;
  providerMessageId: string | null;
  errorName: string | null;
  statusCode: number | null;
  errorMessage: string | null;
};

export type ChallengeSender = (args: {
  to: string;
  day: number;
  idempotencyKey: string;
  unsubscribeToken: string;
}) => Promise<ChallengeProviderResult>;

export type PublicSignupResult = {
  ok: boolean;
  status: number;
  message: string;
};
