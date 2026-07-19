/**
 * APP-041 deletion-aware guards.
 *
 * B2a: unresolved rows (status <> completed) block SMS re-enable.
 * B3b: any deletion row (including completed) blocks entitlement restoration
 * so late webhooks cannot unlock a user who still exists after deletion
 * finished or while deletion is in progress.
 *
 * B2b: outbound SMS uses the same any-row (incl. completed) semantics as B3b
 * entitlement restoration — late SMS after a completed deletion must not send.
 *
 * Completed rows intentionally block late restoration. Failed/stuck rows can
 * also block membership management and outbound SMS until a future admin
 * recovery/cleanup path exists (out of scope for B2b/B3b).
 *
 * Lookup failures are NOT evidence of deletion: transport fails closed (no
 * Twilio), but callers must keep existing retry paths — never treat
 * lookup_failed as intentional skipped_account_deletion / far-future cancel.
 *
 * Missing Clerk user id is a data-integrity fail-closed outcome (not a
 * deletion row); prefer terminal cancellation where identity cannot self-heal.
 *
 * TOCTOU honesty (B2b): Postgres deletion checks and Twilio acceptance are not
 * one atomic transaction. A final check immediately before messages.create is
 * the narrowest enforceable protection; a theoretical race remains between that
 * check and provider acceptance. Combined with B2a identity/audience removal,
 * practical send risk is very small — not mathematically zero.
 */

import "server-only";

import {
  getAnyAccountDeletionRequestForUser,
  getUnresolvedAccountDeletionRequestForUser,
} from "./repository";

export async function hasUnresolvedAccountDeletionRequest(
  clerkUserId: string
): Promise<boolean> {
  const trimmed = clerkUserId.trim();
  if (!trimmed) return false;
  const row = await getUnresolvedAccountDeletionRequestForUser(trimmed);
  return row != null;
}

/** Neutral user-facing conflict body for HTTP routes (no internals). */
export const ACCOUNT_DELETION_IN_PROGRESS_BODY = {
  error: "account_deletion_in_progress",
  message: "This action is unavailable.",
} as const;

export type EntitlementRestorationDecision =
  | { decision: "allowed" }
  | {
      decision: "blocked_due_to_deletion";
      /** unresolved includes failed_retryable / failed_terminal / in-flight steps */
      scope: "unresolved" | "completed";
    }
  | { decision: "lookup_failed" };

/**
 * Outbound SMS deletion gate (APP-041B2b).
 * Same three-way contract as entitlement restoration, plus explicit missing-id.
 * Completed rows block (aligned with B3b). Does not leak request IDs/statuses.
 */
export type OutboundSmsDeletionDecision =
  | EntitlementRestorationDecision
  | { decision: "missing_clerk_user_id" };

/**
 * Whether an outbound SMS tied to a Clerk user may proceed to Twilio.
 * Fail closed on lookup errors. Empty clerkUserId → missing_clerk_user_id.
 */
export async function evaluateOutboundSmsForAccountDeletion(
  clerkUserId: string
): Promise<OutboundSmsDeletionDecision> {
  const trimmed = clerkUserId.trim();
  if (!trimmed) {
    return { decision: "missing_clerk_user_id" };
  }
  return evaluateEntitlementRestorationForAccountDeletion(trimmed);
}

/** Safe operational codes for terminal non-sends (no internal deletion state). */
export type AccountDeletionOutboundSmsErrorCode =
  | "account_deletion_blocks_sms"
  | "deletion_lookup_failed"
  | "missing_clerk_user_id_for_outbound_sms";

/**
 * Thrown by transport when outbound SMS must not call Twilio.
 *
 * Callers MUST branch on `outcome` / classifiers — do not treat every instance
 * the same:
 * - blocked_due_to_deletion → intentional terminal non-send (no provider retry)
 * - lookup_failed → operational fail-closed; keep existing retry paths
 * - missing_clerk_user_id → data-integrity fail-closed (usually terminal)
 *
 * Never a Twilio/provider success. Never evidence of "sent".
 */
export class AccountDeletionOutboundSmsError extends Error {
  readonly code: AccountDeletionOutboundSmsErrorCode;
  readonly outcome:
    | "blocked_due_to_deletion"
    | "lookup_failed"
    | "missing_clerk_user_id";

  constructor(
    outcome:
      | "blocked_due_to_deletion"
      | "lookup_failed"
      | "missing_clerk_user_id"
  ) {
    const code: AccountDeletionOutboundSmsErrorCode =
      outcome === "lookup_failed"
        ? "deletion_lookup_failed"
        : outcome === "missing_clerk_user_id"
          ? "missing_clerk_user_id_for_outbound_sms"
          : "account_deletion_blocks_sms";
    super(code);
    this.name = "AccountDeletionOutboundSmsError";
    this.code = code;
    this.outcome = outcome;
  }
}

export function isAccountDeletionOutboundSmsError(
  err: unknown
): err is AccountDeletionOutboundSmsError {
  return err instanceof AccountDeletionOutboundSmsError;
}

/** Intentional deletion row present — terminal non-send at callers. */
export function isIntentionalDeletionSmsBlock(
  err: unknown
): err is AccountDeletionOutboundSmsError {
  return (
    isAccountDeletionOutboundSmsError(err) &&
    err.outcome === "blocked_due_to_deletion"
  );
}

/**
 * Deletion-table lookup failed — fail closed at transport, retryable at callers.
 * Not evidence the user is deleting.
 */
export function isDeletionLookupFailure(
  err: unknown
): err is AccountDeletionOutboundSmsError {
  return (
    isAccountDeletionOutboundSmsError(err) && err.outcome === "lookup_failed"
  );
}

/**
 * Missing/empty Clerk user id for a user-bound send — data-integrity fail-closed.
 * Prefer terminal cancellation where automatic retry cannot repair identity.
 */
export function isMissingOutboundSmsIdentity(
  err: unknown
): err is AccountDeletionOutboundSmsError {
  return (
    isAccountDeletionOutboundSmsError(err) &&
    err.outcome === "missing_clerk_user_id"
  );
}

/**
 * How inbound-coach send paths should treat a transport deletion refusal.
 * lookup_failed must remain retryable (do not far-future cancel).
 * missing_clerk_user_id is terminal: empty identity cannot self-heal on retry.
 */
export type InboundCoachDeletionSendDisposition =
  | { action: "terminal_cancel"; lastError: AccountDeletionOutboundSmsErrorCode }
  | { action: "retryable_rethrow"; error: AccountDeletionOutboundSmsError };

export function dispositionInboundCoachDeletionSendError(
  err: AccountDeletionOutboundSmsError
): InboundCoachDeletionSendDisposition {
  if (err.outcome === "lookup_failed") {
    return { action: "retryable_rethrow", error: err };
  }
  return { action: "terminal_cancel", lastError: err.code };
}

/**
 * Daily/evening/weekly event update after a reserved send is refused by transport.
 * lookup_failed → send_failed (existing retry/operator path); never skipped_account_deletion.
 */
export type ReservedSendDeletionEventPatch = {
  status: "skipped_account_deletion" | "send_failed";
  note: "blocked_due_to_deletion" | "deletion_lookup_failed" | "missing_clerk_user_id";
  /** Metrics / refuse recoverability */
  retryable: boolean;
  metricCategory:
    | "blocked_due_to_deletion"
    | "deletion_lookup_failed"
    | "missing_clerk_user_id";
};

export function reservedSendEventPatchForDeletionError(
  err: AccountDeletionOutboundSmsError
): ReservedSendDeletionEventPatch {
  if (isIntentionalDeletionSmsBlock(err)) {
    return {
      status: "skipped_account_deletion",
      note: "blocked_due_to_deletion",
      retryable: false,
      metricCategory: "blocked_due_to_deletion",
    };
  }
  if (isDeletionLookupFailure(err)) {
    return {
      status: "send_failed",
      note: "deletion_lookup_failed",
      retryable: true,
      metricCategory: "deletion_lookup_failed",
    };
  }
  // missing_clerk_user_id — data integrity; send_failed for operator visibility,
  // not retryable as a provider/transient failure.
  return {
    status: "send_failed",
    note: "missing_clerk_user_id",
    retryable: false,
    metricCategory: "missing_clerk_user_id",
  };
}

/**
 * Assert outbound SMS is allowed; throws AccountDeletionOutboundSmsError otherwise.
 */
export async function assertOutboundSmsAllowedForAccountDeletion(
  clerkUserId: string
): Promise<void> {
  const decision = await evaluateOutboundSmsForAccountDeletion(clerkUserId);
  if (decision.decision === "allowed") return;
  if (decision.decision === "lookup_failed") {
    throw new AccountDeletionOutboundSmsError("lookup_failed");
  }
  if (decision.decision === "missing_clerk_user_id") {
    throw new AccountDeletionOutboundSmsError("missing_clerk_user_id");
  }
  throw new AccountDeletionOutboundSmsError("blocked_due_to_deletion");
}

/**
 * Whether Clerk entitlement / checkout / resume unlock writes are allowed.
 * Fail closed on lookup errors (decision: lookup_failed).
 */
export async function evaluateEntitlementRestorationForAccountDeletion(
  clerkUserId: string
): Promise<EntitlementRestorationDecision> {
  const trimmed = clerkUserId.trim();
  if (!trimmed) {
    return { decision: "allowed" };
  }
  try {
    const row = await getAnyAccountDeletionRequestForUser(trimmed);
    if (!row) return { decision: "allowed" };
    if (row.status === "completed") {
      return { decision: "blocked_due_to_deletion", scope: "completed" };
    }
    return { decision: "blocked_due_to_deletion", scope: "unresolved" };
  } catch {
    return { decision: "lookup_failed" };
  }
}

/**
 * HTTP unlock paths (checkout / confirm / resume / pause / cancel):
 * - blocked → 409 account_deletion_in_progress
 * - lookup_failed → fail closed (caller maps to 500)
 */
export async function assertEntitlementMutationAllowedForAccountDeletion(
  clerkUserId: string
): Promise<
  | { ok: true }
  | { ok: false; code: "account_deletion_in_progress" | "lookup_failed" }
> {
  const result =
    await evaluateEntitlementRestorationForAccountDeletion(clerkUserId);
  if (result.decision === "allowed") return { ok: true };
  if (result.decision === "lookup_failed") {
    return { ok: false, code: "lookup_failed" };
  }
  return { ok: false, code: "account_deletion_in_progress" };
}

/**
 * Webhook entitlement-increasing writes.
 *
 * Three outcomes (do not collapse lookup_failed into deletion):
 * - allowed → proceed with unlock
 * - blocked_due_to_deletion → intentional no-op (caller keeps dedupe, returns 200)
 * - lookup_failed → retryable (caller must release current event dedupe and return 500)
 *
 * Postgres/Stripe/Clerk are not one atomic transaction; a second check may still
 * race with deletion. Fail closed on unlock paths.
 */
export async function evaluateEntitlementIncreasingWebhookWrite(
  clerkUserId: string
): Promise<EntitlementRestorationDecision> {
  return evaluateEntitlementRestorationForAccountDeletion(clerkUserId);
}

/**
 * @deprecated Prefer evaluateEntitlementIncreasingWebhookWrite for exhaustive
 * three-way handling. Kept for callers that only need skip vs proceed when they
 * already treat lookup_failed separately.
 */
export async function shouldSkipEntitlementIncreasingWrite(
  clerkUserId: string
): Promise<{ skip: boolean; reason: "none" | "deletion" | "lookup_failed" }> {
  const result =
    await evaluateEntitlementRestorationForAccountDeletion(clerkUserId);
  if (result.decision === "allowed") {
    return { skip: false, reason: "none" };
  }
  if (result.decision === "lookup_failed") {
    return { skip: true, reason: "lookup_failed" };
  }
  return { skip: true, reason: "deletion" };
}
