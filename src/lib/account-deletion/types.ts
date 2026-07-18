/**
 * APP-041 account-deletion foundation types (B1).
 *
 * Future HTTP routes MUST obtain clerkUserId from auth().userId only.
 * Repository functions accept a server-supplied clerkUserId for unit tests
 * and future trusted orchestrators — never from an untrusted client body.
 *
 * status = overall machine state (including failed_retryable, failed_terminal, completed).
 * current_step = processing step to execute or resume next.
 * They intentionally differ when status is failed_retryable (and may for
 * failed_terminal); do not assume they always mirror each other.
 *
 * Idempotency: unique (clerk_user_id, idempotency_key) is permanent.
 * Same key after completion returns that historical completed request.
 * A genuinely new deletion attempt requires a new idempotency key.
 */

export const ACCOUNT_DELETION_ORCHESTRATION_VERSION = 1 as const;

export const ACCOUNT_DELETION_SUPPORTED_ORCHESTRATION_VERSIONS = [
  ACCOUNT_DELETION_ORCHESTRATION_VERSION,
] as const;

export type AccountDeletionStatus =
  | "requested"
  | "suppressing_sms"
  | "sms_suppressed"
  | "canceling_subscription"
  | "subscription_canceled"
  | "purging_app_data"
  | "app_data_purged"
  | "deleting_clerk"
  | "completed"
  | "failed_retryable"
  | "failed_terminal";

/** Step labels share the status vocabulary; see status vs current_step notes above. */
export type AccountDeletionStep = AccountDeletionStatus;

export type AccountDeletionStepResult =
  | "pending"
  | "ok"
  | "skipped"
  | "already_done"
  | "failed";

export type AccountDeletionErrorCode =
  | "conflict_unresolved_exists"
  | "not_found"
  | "illegal_transition"
  | "unsupported_orchestration_version"
  | "lease_held"
  | "lease_not_held"
  | "cas_conflict"
  | "invalid_argument"
  | "internal_error";

export type AccountDeletionStepsJson = Record<
  string,
  {
    at?: string;
    ok?: boolean;
    code?: string;
    from?: string;
    to?: string;
    /** Optional sanitized freeform note (may include Stripe object ids; never secrets). */
    detail?: string;
  }
>;

export type AccountDeletionRequestRow = {
  id: string;
  clerk_user_id: string;
  orchestration_version: number;
  status: AccountDeletionStatus;
  current_step: AccountDeletionStep;
  steps: AccountDeletionStepsJson;
  attempt_count: number;
  locked_at: string | null;
  lock_owner: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  last_retry_at: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  sms_result: AccountDeletionStepResult | null;
  stripe_result: AccountDeletionStepResult | null;
  purge_result: AccountDeletionStepResult | null;
  clerk_result: AccountDeletionStepResult | null;
  idempotency_key: string;
};

/**
 * Safe projection for a future authenticated status endpoint.
 * Excludes clerk_user_id, lock owner, raw error detail, and any external IDs.
 */
export type AccountDeletionSafeStatusProjection = {
  requestId: string;
  status: AccountDeletionStatus;
  currentStep: AccountDeletionStep;
  orchestrationVersion: number;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastRetryAt: string | null;
  lastErrorCode: string | null;
  smsResult: AccountDeletionStepResult | null;
  stripeResult: AccountDeletionStepResult | null;
  purgeResult: AccountDeletionStepResult | null;
  clerkResult: AccountDeletionStepResult | null;
};

export const ACCOUNT_DELETION_STATUSES: readonly AccountDeletionStatus[] = [
  "requested",
  "suppressing_sms",
  "sms_suppressed",
  "canceling_subscription",
  "subscription_canceled",
  "purging_app_data",
  "app_data_purged",
  "deleting_clerk",
  "completed",
  "failed_retryable",
  "failed_terminal",
] as const;

export const ACCOUNT_DELETION_STEP_RESULTS: readonly AccountDeletionStepResult[] =
  ["pending", "ok", "skipped", "already_done", "failed"] as const;

export function isAccountDeletionStatus(
  value: unknown
): value is AccountDeletionStatus {
  return (
    typeof value === "string" &&
    (ACCOUNT_DELETION_STATUSES as readonly string[]).includes(value)
  );
}

export function toAccountDeletionSafeStatusProjection(
  row: AccountDeletionRequestRow
): AccountDeletionSafeStatusProjection {
  return {
    requestId: row.id,
    status: row.status,
    currentStep: row.current_step,
    orchestrationVersion: row.orchestration_version,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    lastRetryAt: row.last_retry_at,
    lastErrorCode: row.last_error_code,
    smsResult: row.sms_result,
    stripeResult: row.stripe_result,
    purgeResult: row.purge_result,
    clerkResult: row.clerk_result,
  };
}
